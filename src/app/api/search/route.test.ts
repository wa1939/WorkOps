import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../scripts/assert-local-database";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { GET } from "./route";

type SearchPayload = {
  hits: Array<{ type: string; id: string; title: string }>;
  groups: Array<{
    type: string;
    label: string;
    results: Array<{ type: string; id: string; title: string; href: string; subtitle?: string | null }>;
  }>;
};

describe.runIf(databaseEnabled)("GET /api/search task privacy", () => {
  it("hides a private task from an unrelated member", async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const creatorId = `s01-creator-${suffix}`;
    const memberId = `s01-member-${suffix}`;
    const adminId = `s01-admin-${suffix}`;
    const taskId = `s01-task-${suffix}`;
    const marker = `s01-private-task-${suffix}`;

    try {
      await prisma.user.create({
        data: { id: creatorId, email: `${creatorId}@example.test`, name: creatorId, role: "MEMBER", isActive: true },
      });
      await prisma.user.create({
        data: { id: memberId, email: `${memberId}@example.test`, name: memberId, role: "MEMBER", isActive: true },
      });
      await prisma.user.create({
        data: { id: adminId, email: `${adminId}@example.test`, name: adminId, role: "ADMIN", isActive: true },
      });
      await prisma.task.create({
        data: {
          id: taskId,
          title: marker,
          createdById: creatorId,
          isPrivate: true,
          assignments: { create: [{ userId: creatorId }] },
        },
      });

      auth.mockResolvedValue({ user: { id: memberId } });
      const unrelatedResponse = await GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(marker)}`));
      expect(unrelatedResponse.status).toBe(200);
      const unrelatedText = await unrelatedResponse.text();
      const unrelatedPayload = JSON.parse(unrelatedText) as SearchPayload;
      expect(unrelatedPayload.hits.some((hit) => hit.type === "task" && hit.id === taskId)).toBe(false);
      expect(unrelatedText).not.toContain(marker);
      expect(unrelatedText).not.toContain(taskId);

      auth.mockResolvedValue({ user: { id: creatorId } });
      const creatorResponse = await GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(marker)}`));
      expect(creatorResponse.status).toBe(200);
      await expect(creatorResponse.json()).resolves.toEqual(expect.objectContaining({
        hits: expect.arrayContaining([expect.objectContaining({ type: "task", id: taskId, title: marker })]),
      }));

      auth.mockResolvedValue({ user: { id: adminId } });
      const adminResponse = await GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(marker)}`));
      expect(adminResponse.status).toBe(200);
      await expect(adminResponse.json()).resolves.toEqual(expect.objectContaining({
        hits: expect.arrayContaining([expect.objectContaining({ type: "task", id: taskId, title: marker })]),
      }));
    } finally {
      await prisma.task.deleteMany({ where: { id: taskId } });
      await prisma.user.deleteMany({ where: { id: { in: [creatorId, memberId, adminId] } } });
      await prisma.$disconnect();
      auth.mockReset();
    }
  });

  it("returns grouped task, project, and note matches within the actor workspace", async () => {
    const prisma = new PrismaClient();
    const suffix = randomUUID();
    const workspaceAId = `t42-workspace-a-${suffix}`;
    const workspaceBId = `t42-workspace-b-${suffix}`;
    const actorId = `t42-actor-${suffix}`;
    const visibleTaskId = `t42-task-visible-${suffix}`;
    const hiddenTaskId = `t42-task-hidden-${suffix}`;
    const projectId = `t42-project-${suffix}`;
    const noteId = `t42-note-${suffix}`;

    try {
      await prisma.workspace.createMany({
        data: [
          { id: workspaceAId, slug: `t42-a-${suffix}`, name: "T42 Workspace A", timezone: "UTC" },
          { id: workspaceBId, slug: `t42-b-${suffix}`, name: "T42 Workspace B", timezone: "UTC" },
        ],
      });
      await prisma.user.create({
        data: {
          id: actorId,
          email: `${actorId}@example.test`,
          name: `T42 Alpha Member ${suffix}`,
          role: "MEMBER",
          isActive: true,
        },
      });
      await prisma.workspaceMember.create({
        data: { workspaceId: workspaceBId, userId: actorId, role: "MEMBER" },
      });
      await prisma.project.create({
        data: {
          id: projectId,
          name: `Alpha project ${suffix}`,
          workspaceId: workspaceBId,
          ownerId: actorId,
        },
      });
      await prisma.task.createMany({
        data: [
          {
            id: visibleTaskId,
            taskKey: `ALPHA-${suffix}`,
            title: `Alpha task ${suffix}`,
            workspaceId: workspaceBId,
            projectId,
            createdById: actorId,
            isPrivate: false,
          },
          {
            id: hiddenTaskId,
            title: `Alpha hidden task ${suffix}`,
            workspaceId: workspaceAId,
            createdById: actorId,
            isPrivate: false,
          },
        ],
      });
      await prisma.notePage.create({
        data: {
          id: noteId,
          title: `Alpha note ${suffix}`,
          body: "T42 note body",
          authorId: actorId,
          workspaceId: workspaceBId,
          isShared: false,
        },
      });

      auth.mockResolvedValue({ user: { id: actorId } });
      const response = await GET(new Request("http://localhost/api/search?q=alpha"));
      expect(response.status).toBe(200);
      const payload = JSON.parse(await response.text()) as SearchPayload;

      expect(payload.groups.map((group) => group.type)).toEqual(["task", "project", "member", "note"]);
      expect(payload.groups.find((group) => group.type === "task")?.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "task", id: visibleTaskId, href: `/tasks?task=${visibleTaskId}` }),
        ]),
      );
      expect(payload.groups.find((group) => group.type === "project")?.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "project", id: projectId, href: `/projects/${projectId}` }),
        ]),
      );
      expect(payload.groups.find((group) => group.type === "note")?.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "note", id: noteId, href: `/notes/${noteId}` }),
        ]),
      );
      expect(payload.hits.map((hit) => hit.type)).toEqual(expect.arrayContaining(["task", "project", "member", "note"]));
      expect(payload.hits.some((hit) => hit.id === hiddenTaskId)).toBe(false);
      expect(JSON.stringify(payload)).not.toContain(hiddenTaskId);
    } finally {
      await prisma.notePage.deleteMany({ where: { id: noteId } });
      await prisma.task.deleteMany({ where: { id: { in: [visibleTaskId, hiddenTaskId] } } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
      await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
      await prisma.user.deleteMany({ where: { id: actorId } });
      await prisma.$disconnect();
      auth.mockReset();
    }
  });
});
