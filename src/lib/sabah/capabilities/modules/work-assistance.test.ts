import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";
import { workHelpCandidatesCapability, workPoolCapability, workPrepareTaskCapability } from "./work-assistance";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);
const NOW = new Date("2026-09-08T00:00:00.000Z");

type Fixture = {
  workspaceId: string;
  actorId: string;
  ownerId: string;
  secondOwnerId: string;
  delegateId: string;
  taskIds: string[];
  projectIds: string[];
  leaveIds: string[];
  snapshotUserIds: string[];
};

async function createFixture(db: PrismaClient): Promise<Fixture> {
  const suffix = randomUUID();
  const fixture: Fixture = {
    workspaceId: `q02-workspace-${suffix}`,
    actorId: `q02-actor-${suffix}`,
    ownerId: `q02-owner-${suffix}`,
    secondOwnerId: `q02-owner-2-${suffix}`,
    delegateId: `q02-delegate-${suffix}`,
    taskIds: [],
    projectIds: [],
    leaveIds: [],
    snapshotUserIds: [],
  };
  await db.workspace.create({ data: { id: fixture.workspaceId, slug: `q02-${suffix}`, name: "Q02 work assistance workspace", timezone: "Asia/Riyadh" } });
  await db.user.createMany({
    data: [fixture.actorId, fixture.ownerId, fixture.secondOwnerId, fixture.delegateId].map((id, index) => ({
      id, email: `${id}@example.test`, name: `Q02 User ${index + 1}`, role: "MEMBER" as const, isActive: true,
    })),
  });
  await db.workspaceMember.createMany({ data: [fixture.actorId, fixture.ownerId, fixture.secondOwnerId, fixture.delegateId].map((userId) => ({
    workspaceId: fixture.workspaceId, userId, role: "MEMBER" as const, active: true,
  })) });
  return fixture;
}

async function createTask(db: PrismaClient, fixture: Fixture, data: Record<string, unknown>) {
  const task = await db.task.create({ data: {
    id: `q02-task-${randomUUID()}`, title: "Q02 task", workspaceId: fixture.workspaceId,
    createdById: fixture.ownerId, isPrivate: false, status: "TODO", priority: "MEDIUM", ...data,
  } as any });
  fixture.taskIds.push(task.id);
  return task;
}

async function createSnapshot(db: PrismaClient, fixture: Fixture, userId: string, loadPercent: number) {
  await db.teamLoadSnapshot.create({ data: {
    id: `q02-snapshot-${randomUUID()}`, userId, weekStart: new Date("2026-09-06T00:00:00.000Z"),
    loadHours: loadPercent, loadPercent, computedAt: NOW,
  } });
  if (!fixture.snapshotUserIds.includes(userId)) fixture.snapshotUserIds.push(userId);
}

async function cleanupFixture(db: PrismaClient, fixture: Fixture): Promise<void> {
  if (fixture.leaveIds.length) await db.leaveRequest.deleteMany({ where: { id: { in: fixture.leaveIds } } });
  if (fixture.snapshotUserIds.length) await db.teamLoadSnapshot.deleteMany({ where: { userId: { in: fixture.snapshotUserIds } } });
  if (fixture.taskIds.length) await db.task.deleteMany({ where: { id: { in: fixture.taskIds } } });
  if (fixture.projectIds.length) await db.project.deleteMany({ where: { id: { in: fixture.projectIds } } });
  await db.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await db.workspace.deleteMany({ where: { id: fixture.workspaceId } });
  await db.user.deleteMany({ where: { id: { in: [fixture.actorId, fixture.ownerId, fixture.secondOwnerId, fixture.delegateId] } } });
}

function context(fixture: Fixture) {
  return {
    actor: { id: fixture.actorId, role: "MEMBER" as const, departmentIds: [] },
    requestId: `q02-request-${randomUUID()}`, conversationId: null, workflowId: null, now: NOW,
  };
}

describe.runIf(databaseEnabled)("Q02 work assistance capabilities", () => {
  it("no assigned tasks does not imply inactivity", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    try {
      const task = await createTask(db, fixture, { title: "Unassigned visible work", createdById: fixture.ownerId, dueAt: new Date("2026-09-10T00:00:00.000Z"), priority: "HIGH" });
      await createSnapshot(db, fixture, fixture.ownerId, 42);
      const ctx = context(fixture);
      const pool = await workPoolCapability.execute({ limit: 10, workspaceId: fixture.workspaceId }, ctx);
      const help = await workHelpCandidatesCapability.execute({ userId: fixture.actorId, workspaceId: fixture.workspaceId }, ctx);
      expect(pool.map((row) => row.taskId)).toContain(task.id);
      expect(help).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: task.id, ownerLoadPercent: 42, priority: "HIGH" })]));
      expect(JSON.stringify({ pool, help })).not.toMatch(/inactivity|inactive/i);
    } finally {
      try { await cleanupFixture(db, fixture); } finally { await db.$disconnect(); }
    }
  });

  it("blocked or private work not falsely recommended", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    try {
      const privateTask = await createTask(db, fixture, { title: "Private owner work", createdById: fixture.ownerId, isPrivate: true });
      // TaskDependency is modeled in this schema; use an unmet dependency for the blocked fixture.
      const blocker = await createTask(db, fixture, { title: "Unmet dependency", createdById: fixture.secondOwnerId, status: "TODO" });
      const dependencyBlocked = await createTask(db, fixture, { title: "Dependency blocked work", createdById: fixture.secondOwnerId, status: "TODO" });
      await db.taskDependency.create({ data: { id: `q02-dependency-${randomUUID()}`, taskId: dependencyBlocked.id, dependsOnId: blocker.id } });
      const statusBlocked = await createTask(db, fixture, { title: "Status blocked work", createdById: fixture.secondOwnerId, status: "BLOCKED" });
      await createSnapshot(db, fixture, fixture.ownerId, 20);
      await createSnapshot(db, fixture, fixture.secondOwnerId, 30);
      const ctx = context(fixture);
      const pool = await workPoolCapability.execute({ limit: 20, workspaceId: fixture.workspaceId }, ctx);
      const help = await workHelpCandidatesCapability.execute({ userId: fixture.actorId, workspaceId: fixture.workspaceId }, ctx);
      const privateError = await workPrepareTaskCapability.execute({ taskId: privateTask.id }, ctx).catch((error) => error);
      const missingError = await workPrepareTaskCapability.execute({ taskId: `q02-missing-${randomUUID()}` }, ctx).catch((error) => error);
      expect(pool.map((row) => row.taskId)).not.toEqual(expect.arrayContaining([privateTask.id, dependencyBlocked.id, statusBlocked.id]));
      expect(help.map((row) => row.taskId)).not.toContain(privateTask.id);
      expect(privateError).toMatchObject({ status: 404, code: "NOT_FOUND" });
      expect(privateError.message).toBe(missingError.message);
    } finally {
      try { await cleanupFixture(db, fixture); } finally { await db.$disconnect(); }
    }
  });

  it("preparation writes no task", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    try {
      const project = await db.project.create({ data: { id: `q02-project-${randomUUID()}`, name: "Q02 source project", description: "Project source description", workspaceId: fixture.workspaceId } });
      fixture.projectIds.push(project.id);
      const task = await createTask(db, fixture, { title: "Prepare source-linked brief", description: "Use the source material to prepare the brief.", projectId: project.id, createdById: fixture.actorId });
      await db.link.createMany({ data: [
        { id: `q02-task-link-${randomUUID()}`, taskId: task.id, label: "Task source", url: "https://example.test/task-source" },
        { id: `q02-project-link-${randomUUID()}`, projectId: project.id, label: "Project source", url: "https://example.test/project-source" },
      ] });
      const beforeCount = await db.task.count({ where: { id: task.id } });
      const before = await db.task.findUnique({ where: { id: task.id }, select: { updatedAt: true } });
      const prepared = await workPrepareTaskCapability.execute({ taskId: task.id }, context(fixture));
      const afterCount = await db.task.count({ where: { id: task.id } });
      const after = await db.task.findUnique({ where: { id: task.id }, select: { updatedAt: true } });
      expect(prepared.brief).toContain(task.title);
      expect(prepared.brief).toContain("Use the source material");
      expect(prepared.checklist.length).toBeGreaterThan(0);
      expect(prepared.sourceLinks).toEqual(expect.arrayContaining(["https://example.test/task-source", "https://example.test/project-source"]));
      expect(afterCount).toBe(beforeCount);
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    } finally {
      try { await cleanupFixture(db, fixture); } finally { await db.$disconnect(); }
    }
  });

  it("claim requires preview approval and readback", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    try {
      const task = await createTask(db, fixture, { title: "Explicitly claimable work", createdById: fixture.ownerId, priority: "URGENT" });
      await createSnapshot(db, fixture, fixture.ownerId, 15);
      const before = await db.task.findUnique({ where: { id: task.id }, select: { updatedAt: true } });
      const pool = await workPoolCapability.execute({ limit: 10, workspaceId: fixture.workspaceId }, context(fixture));
      const after = await db.task.findUnique({ where: { id: task.id }, include: { assignments: true } });
      expect(pool).toEqual(expect.arrayContaining([expect.objectContaining({ taskId: task.id })]));
      expect(after?.assignments).toHaveLength(0);
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
    } finally {
      try { await cleanupFixture(db, fixture); } finally { await db.$disconnect(); }
    }
  });
});
