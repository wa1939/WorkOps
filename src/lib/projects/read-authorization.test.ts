import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { GET as searchGET } from "../../app/api/search/route";
import { GET as projectGET } from "../../app/api/projects/[id]/route";
import { getProjectForActor, listProjectsForActor } from "./commands";
import type { SabahActor } from "@/lib/sabah/auth/actor";

type SearchPayload = {
  hits: Array<{ type: string; id: string; title: string }>;
};

const actor = (id: string, departmentIds: string[] = [], role: SabahActor["role"] = "MEMBER"): SabahActor => ({
  id,
  role,
  departmentIds,
});

async function createUser(prisma: PrismaClient, id: string, role: "ADMIN" | "MEMBER" = "MEMBER") {
  return prisma.user.create({
    data: { id, email: `${id}@example.test`, name: id, role, isActive: true },
  });
}

function projectRouteParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe.runIf(databaseEnabled)("S02 read authorization parity", () => {
  it("search cannot discover another users private note", async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const authorId = `s02-note-author-${suffix}`;
    const readerId = `s02-note-reader-${suffix}`;
    const adminId = `s02-note-admin-${suffix}`;
    const noteId = `s02-note-${suffix}`;
    const marker = `s02-private-note-${suffix}`;

    try {
      await createUser(prisma, authorId);
      await createUser(prisma, readerId);
      await createUser(prisma, adminId, "ADMIN");
      await prisma.notePage.create({
        data: {
          id: noteId,
          title: marker,
          body: marker,
          isShared: false,
          authorId,
        },
      });

      auth.mockResolvedValue({ user: { id: readerId } });
      const readerResponse = await searchGET(new Request(`http://localhost/api/search?q=${encodeURIComponent(marker)}`));
      expect(readerResponse.status).toBe(200);
      const readerText = await readerResponse.text();
      expect(readerText).not.toContain(marker);
      expect(readerText).not.toContain(noteId);

      auth.mockResolvedValue({ user: { id: authorId } });
      const authorResponse = await searchGET(new Request(`http://localhost/api/search?q=${encodeURIComponent(marker)}`));
      expect(authorResponse.status).toBe(200);
      const authorPayload = JSON.parse(await authorResponse.text()) as SearchPayload;
      expect(authorPayload.hits).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "note", id: noteId, title: marker })]),
      );

      auth.mockResolvedValue({ user: { id: adminId } });
      const adminResponse = await searchGET(new Request(`http://localhost/api/search?q=${encodeURIComponent(marker)}`));
      expect(adminResponse.status).toBe(200);
      const adminPayload = JSON.parse(await adminResponse.text()) as SearchPayload;
      expect(adminPayload.hits).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "note", id: noteId, title: marker })]),
      );
    } finally {
      await prisma.notePage.deleteMany({ where: { id: noteId } });
      await prisma.user.deleteMany({ where: { id: { in: [authorId, readerId, adminId] } } });
      await prisma.$disconnect();
      auth.mockReset();
    }
  });

  it("project reads use the same scope as Sabah search", async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const ownerId = `s02-project-owner-${suffix}`;
    const readerId = `s02-project-reader-${suffix}`;
    const ownerDepartmentId = `s02-owner-department-${suffix}`;
    const readerDepartmentId = `s02-reader-department-${suffix}`;
    const ownedProjectId = `s02-owned-project-${suffix}`;
    const floatingProjectId = `s02-floating-project-${suffix}`;
    const ownedProjectName = `s02-owned-project-name-${suffix}`;
    const floatingProjectName = `s02-floating-project-name-${suffix}`;

    try {
      await createUser(prisma, ownerId);
      await createUser(prisma, readerId);
      await prisma.department.create({ data: { id: ownerDepartmentId, name: ownerDepartmentId } });
      await prisma.department.create({ data: { id: readerDepartmentId, name: readerDepartmentId } });
      await prisma.userDepartment.createMany({
        data: [
          { userId: ownerId, departmentId: ownerDepartmentId },
          { userId: readerId, departmentId: readerDepartmentId },
        ],
      });
      await prisma.project.create({
        data: {
          id: ownedProjectId,
          name: ownedProjectName,
          ownerId,
          responsibleDepartmentId: ownerDepartmentId,
          status: "Active",
        },
      });
      await prisma.project.create({
        data: {
          id: floatingProjectId,
          name: floatingProjectName,
          ownerId: null,
          status: "Active",
        },
      });

      const ownerActor = actor(ownerId, [ownerDepartmentId]);
      const readerActor = actor(readerId, [readerDepartmentId]);

      await expect(getProjectForActor(ownedProjectId, readerActor)).resolves.toBeNull();
      const readerProjects = await listProjectsForActor({}, readerActor);
      expect(readerProjects.some((project) => project.id === ownedProjectId)).toBe(false);
      expect(readerProjects.some((project) => project.id === floatingProjectId)).toBe(true);

      auth.mockResolvedValue({ user: { id: readerId } });
      const readerSearchResponse = await searchGET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(ownedProjectName)}`),
      );
      expect(readerSearchResponse.status).toBe(200);
      const readerSearchText = await readerSearchResponse.text();
      expect(readerSearchText).not.toContain(ownedProjectId);
      expect(readerSearchText).not.toContain(ownedProjectName);

      const readerFloatingProject = await getProjectForActor(floatingProjectId, readerActor);
      expect(readerFloatingProject?.id).toBe(floatingProjectId);
      auth.mockResolvedValue({ user: { id: readerId } });
      const readerFloatingSearchResponse = await searchGET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(floatingProjectName)}`),
      );
      expect(readerFloatingSearchResponse.status).toBe(200);
      const readerFloatingPayload = await readerFloatingSearchResponse.json();
      const readerFloatingProjects = (readerFloatingPayload.groups ?? []).find((group: { type: string }) => group.type === "project")?.results ?? [];
      expect(readerFloatingProjects).toEqual(expect.arrayContaining([expect.objectContaining({ id: floatingProjectId, title: floatingProjectName })]));

      await expect(getProjectForActor(ownedProjectId, ownerActor)).resolves.toMatchObject({ id: ownedProjectId });
      const ownerProjects = await listProjectsForActor({ search: ownedProjectName }, ownerActor);
      expect(ownerProjects.some((project) => project.id === ownedProjectId)).toBe(true);
      auth.mockResolvedValue({ user: { id: ownerId } });
      const ownerSearchResponse = await searchGET(
        new Request(`http://localhost/api/search?q=${encodeURIComponent(ownedProjectName)}`),
      );
      expect(ownerSearchResponse.status).toBe(200);
      const ownerPayload = await ownerSearchResponse.json();
      const ownerSearchProjects = (ownerPayload.groups ?? []).find((group: { type: string }) => group.type === "project")?.results ?? [];
      expect(ownerSearchProjects).toEqual(expect.arrayContaining([expect.objectContaining({ id: ownedProjectId, title: ownedProjectName })]));
    } finally {
      await prisma.project.deleteMany({ where: { id: { in: [ownedProjectId, floatingProjectId] } } });
      await prisma.userDepartment.deleteMany({ where: { userId: { in: [ownerId, readerId] } } });
      await prisma.department.deleteMany({ where: { id: { in: [ownerDepartmentId, readerDepartmentId] } } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, readerId] } } });
      await prisma.$disconnect();
      auth.mockReset();
    }
  });

  it("unknown project is indistinguishable from forbidden project", async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const ownerId = `s02-forbidden-owner-${suffix}`;
    const readerId = `s02-forbidden-reader-${suffix}`;
    const forbiddenProjectId = `s02-forbidden-project-${suffix}`;
    const unknownProjectId = `s02-unknown-project-${suffix}`;

    try {
      await createUser(prisma, ownerId);
      await createUser(prisma, readerId);
      await prisma.project.create({
        data: { id: forbiddenProjectId, name: `s02-forbidden-name-${suffix}`, ownerId, status: "Active" },
      });

      const readerActor = actor(readerId);
      const unknownRead = await getProjectForActor(unknownProjectId, readerActor);
      const forbiddenRead = await getProjectForActor(forbiddenProjectId, readerActor);
      expect(unknownRead).toBeNull();
      expect(forbiddenRead).toBeNull();

      auth.mockResolvedValue({ user: { id: readerId } });
      const unknownResponse = await projectGET(new Request("http://localhost"), projectRouteParams(unknownProjectId));
      const forbiddenResponse = await projectGET(new Request("http://localhost"), projectRouteParams(forbiddenProjectId));
      expect(unknownResponse.status).toBe(404);
      expect(forbiddenResponse.status).toBe(unknownResponse.status);
    } finally {
      await prisma.project.deleteMany({ where: { id: forbiddenProjectId } });
      await prisma.user.deleteMany({ where: { id: { in: [ownerId, readerId] } } });
      await prisma.$disconnect();
      auth.mockReset();
    }
  });
});
