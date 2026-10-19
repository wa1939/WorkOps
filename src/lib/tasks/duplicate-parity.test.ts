import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { createTask } from "./commands";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
  assertLocalDatabaseUrl(databaseUrl);
  process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

type Fixture = {
  workspaceId: string;
  userIds: string[];
  taskIds: string[];
};

async function createFixture(db: PrismaClient, userCount = 1): Promise<Fixture> {
  const suffix = randomUUID();
  const workspaceId = `q01-workspace-${suffix}`;
  const userIds = Array.from({ length: userCount }, (_, index) => `q01-user-${index}-${suffix}`);
  await db.workspace.create({
    data: { id: workspaceId, slug: `q01-${suffix}`, name: "Q01 duplicate guard workspace" },
  });
  await db.user.createMany({
    data: userIds.map((id, index) => ({ id, email: `${id}@example.test`, name: `Q01 User ${index + 1}`, role: "MEMBER" as const })),
  });
  await db.workspaceMember.createMany({
    data: userIds.map((userId) => ({ workspaceId, userId, role: "MEMBER" as const })),
  });
  return { workspaceId, userIds, taskIds: [] };
}

async function cleanupFixture(db: PrismaClient, fixture: Fixture): Promise<void> {
  if (fixture.taskIds.length) {
    await db.aiEntityFingerprint.deleteMany({ where: { entityId: { in: fixture.taskIds } } });
    await db.aiCapabilityResult.deleteMany({ where: { outputJson: { contains: fixture.taskIds[0] } } });
    await db.task.deleteMany({ where: { id: { in: fixture.taskIds } } });
  }
  await db.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspaceId } });
  await db.workspace.deleteMany({ where: { id: fixture.workspaceId } });
  await db.user.deleteMany({ where: { id: { in: fixture.userIds } } });
}

function input(fixture: Fixture, title: string, extra: Record<string, unknown> = {}) {
  return { title, workspaceId: fixture.workspaceId, ...extra } as any;
}

describe.runIf(databaseEnabled)("Q01 task duplicate guard parity", () => {
  it("same idempotency key cannot create twice concurrently", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    const actor = { id: fixture.userIds[0], role: "MEMBER" as const };
    try {
      const results = await Promise.all([
        createTask(input(fixture, "Publish the monthly operating report", { idempotencyKey: "q01-replay-key" }), actor, db, fixture.workspaceId),
        createTask(input(fixture, "Publish the monthly operating report", { idempotencyKey: "q01-replay-key" }), actor, db, fixture.workspaceId),
      ]);
      fixture.taskIds.push(results[0].id);

      expect(results[0].id).toBe(results[1].id);
      expect(await db.task.count({ where: { id: results[0].id } })).toBe(1);
      expect(await db.task.count({ where: { createdById: actor.id, title: "Publish the monthly operating report" } })).toBe(1);
    } finally {
      try {
        await cleanupFixture(db, fixture);
      } finally {
        await db.$disconnect();
      }
    }
  });

  it("different recurring occurrence allowed", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    const actor = { id: fixture.userIds[0], role: "MEMBER" as const };
    try {
      const first = await createTask(input(fixture, "Review monthly KPI performance", { recurrenceKey: "2026-09" }), actor, db, fixture.workspaceId);
      const second = await createTask(input(fixture, "Review monthly KPI performance", { recurrenceKey: "2026-10" }), actor, db, fixture.workspaceId);
      fixture.taskIds.push(first.id, second.id);

      expect(second.id).not.toBe(first.id);
      expect(await db.task.count({ where: { id: { in: [first.id, second.id] } } })).toBe(2);
      expect((second as any).metadata?.duplicateWarnings ?? []).toEqual([]);
    } finally {
      try {
        await cleanupFixture(db, fixture);
      } finally {
        await db.$disconnect();
      }
    }
  });

  it("related task requires user choice not automatic merge", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db);
    const actor = { id: fixture.userIds[0], role: "MEMBER" as const };
    try {
      const first = await createTask(input(fixture, "Prepare the monthly budget report"), actor, db, fixture.workspaceId);
      const second = await createTask(input(fixture, "Prepare the monthly budget report details"), actor, db, fixture.workspaceId);
      fixture.taskIds.push(first.id, second.id);

      expect(second.id).not.toBe(first.id);
      expect((second as any).metadata?.duplicateWarnings).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.id }),
      ]));
      expect(await db.task.count({ where: { id: { in: [first.id, second.id] } } })).toBe(2);
    } finally {
      try {
        await cleanupFixture(db, fixture);
      } finally {
        await db.$disconnect();
      }
    }
  });

  it("private candidate cannot leak", async () => {
    const db = new PrismaClient();
    const fixture = await createFixture(db, 2);
    const actor = { id: fixture.userIds[0], role: "MEMBER" as const };
    try {
      const privateTask = await db.task.create({
        data: {
          id: `q01-private-${randomUUID()}`,
          title: "Secret monthly budget report",
          workspaceId: fixture.workspaceId,
          createdById: fixture.userIds[1],
          isPrivate: true,
        },
      });
      fixture.taskIds.push(privateTask.id);
      const created = await createTask(input(fixture, "Secret monthly budget reporting"), actor, db, fixture.workspaceId);
      fixture.taskIds.push(created.id);

      const warnings = (created as any).metadata?.duplicateWarnings ?? [];
      expect(warnings.map((warning: { id: string }) => warning.id)).not.toContain(privateTask.id);
      expect(JSON.stringify(warnings)).not.toContain(privateTask.title);
    } finally {
      try {
        await cleanupFixture(db, fixture);
      } finally {
        await db.$disconnect();
      }
    }
  });
});
