import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../scripts/assert-local-database";
import { runMonitor } from "./service";

type Fixture = { workspaceId: string; userId: string; monitorId: string; taskIds: string[] };
const databaseUrl = readDatabaseUrl();
if (databaseUrl) { assertLocalDatabaseUrl(databaseUrl); process.env.DATABASE_URL = databaseUrl; }
const databaseEnabled = Boolean(databaseUrl);

async function createFixture(db: PrismaClient): Promise<Fixture> {
    const suffix = randomUUID();
    const fixture: Fixture = { workspaceId: `q03-workspace-${suffix}`, userId: `q03-user-${suffix}`, monitorId: `q03-monitor-${suffix}`, taskIds: [] };
    await db.workspace.create({ data: { id: fixture.workspaceId, slug: `q03-${suffix}`, name: "Q03 monitor workspace", timezone: "Asia/Riyadh" } });
    await db.user.create({ data: { id: fixture.userId, email: `${fixture.userId}@example.test`, name: "Q03 monitor subject", role: "MEMBER", isActive: true } });
    await db.workspaceMember.create({ data: { workspaceId: fixture.workspaceId, userId: fixture.userId, role: "MEMBER", active: true } });
    await db.aiMonitor.create({ data: { id: fixture.monitorId, key: "deadlines", name: "Q03 deadlines", enabled: true, schedule: "HOURLY", scope: "WORKSPACE", definitionJson: JSON.stringify({ workspaceId: fixture.workspaceId, userId: fixture.userId, deadlineWindowDays: 7 }), createdById: fixture.userId } });
    return fixture;
}

async function createTask(db: PrismaClient, fixture: Fixture, input: { title: string; dueAt: Date; status?: "TODO" | "DONE" }) {
    const task = await db.task.create({ data: { id: `q03-task-${randomUUID()}`, title: input.title, workspaceId: fixture.workspaceId, createdById: fixture.userId, isPrivate: false, dueAt: input.dueAt, status: input.status ?? "TODO" } });
    fixture.taskIds.push(task.id);
    return task;
}

async function cleanup(db: PrismaClient, fixture: Fixture): Promise<void> {
    await db.aiJob.deleteMany({ where: { idempotencyKey: { startsWith: `monitor:${fixture.monitorId}:` } } });
    await db.aiSuggestion.deleteMany({ where: { monitorId: fixture.monitorId } });
    await db.aiMonitorState.deleteMany({ where: { monitorId: fixture.monitorId } });
    await db.aiMonitor.deleteMany({ where: { id: fixture.monitorId } });
    await db.task.deleteMany({ where: { id: { in: fixture.taskIds } } });
    await db.workspaceMember.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await db.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await db.user.deleteMany({ where: { id: fixture.userId } });
}

describe.runIf(databaseEnabled)("Q03 real monitor evidence readers", () => {
    it("deadline monitor emits only actual deadline evidence", async () => {
        const db = new PrismaClient(); const now = new Date("2026-09-08T00:00:00.000Z"); const fixture = await createFixture(db);
        try {
            const near = await createTask(db, fixture, { title: "Due soon", dueAt: new Date("2026-09-10T00:00:00.000Z") });
            const far = await createTask(db, fixture, { title: "Due later", dueAt: new Date("2026-10-08T00:00:00.000Z") });
            const done = await createTask(db, fixture, { title: "Already done", dueAt: new Date("2026-09-09T00:00:00.000Z"), status: "DONE" });
            const result = await runMonitor(fixture.monitorId, { db, now });
            const suggestions = await db.aiSuggestion.findMany({ where: { monitorId: fixture.monitorId } });
            expect(result.created).toBe(true); expect(suggestions).toHaveLength(1);
            const evidence = JSON.parse(suggestions[0].evidenceJson) as { sourceIds: string[]; items: Array<{ sourceId: string }> };
            expect(evidence.sourceIds).toEqual([near.id]); expect(evidence.items.map((item) => item.sourceId)).toEqual([near.id]);
            expect(evidence.sourceIds).not.toContain(far.id); expect(evidence.sourceIds).not.toContain(done.id);
        } finally { try { await cleanup(db, fixture); } finally { await db.$disconnect(); } }
    });

    it("unchanged evidence does not re-notify", async () => {
        const db = new PrismaClient(); const now = new Date("2026-09-08T00:00:00.000Z"); const fixture = await createFixture(db);
        try {
            await createTask(db, fixture, { title: "Due soon", dueAt: new Date("2026-09-10T00:00:00.000Z") });
            const first = await runMonitor(fixture.monitorId, { db, now }); const second = await runMonitor(fixture.monitorId, { db, now });
            expect(first.created).toBe(true); expect(second.created).toBe(false); expect(second.suppressed).toBe(true);
            expect(await db.aiSuggestion.count({ where: { monitorId: fixture.monitorId } })).toBe(1);
        } finally { try { await cleanup(db, fixture); } finally { await db.$disconnect(); } }
    });

    it("expired suggestion is suppressed", async () => {
        const db = new PrismaClient(); const now = new Date("2026-09-08T00:00:00.000Z"); const fixture = await createFixture(db);
        try {
            await createTask(db, fixture, { title: "Due soon", dueAt: new Date("2026-09-10T00:00:00.000Z") });
            const first = await runMonitor(fixture.monitorId, { db, now }); expect(first.created).toBe(true);
            await db.aiSuggestion.updateMany({ where: { monitorId: fixture.monitorId, fingerprint: first.fingerprint }, data: { state: "EXPIRED", dismissedAt: now } });
            const second = await runMonitor(fixture.monitorId, { db, now: new Date(now.getTime() + 60 * 60 * 1000) });
            expect(second.created).toBe(false); expect(second.suppressed).toBe(true); expect(await db.aiSuggestion.count({ where: { monitorId: fixture.monitorId } })).toBe(1);
        } finally { try { await cleanup(db, fixture); } finally { await db.$disconnect(); } }
    });

    it("membership removal prevents generation", async () => {
        const db = new PrismaClient(); const now = new Date("2026-09-08T00:00:00.000Z"); const fixture = await createFixture(db);
        try {
            await createTask(db, fixture, { title: "Due soon", dueAt: new Date("2026-09-10T00:00:00.000Z") });
            await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: fixture.workspaceId, userId: fixture.userId } }, data: { active: false } });
            const result = await runMonitor(fixture.monitorId, { db, now });
            expect(result.created).toBe(false); expect(result.suppressed).toBe(true); expect(await db.aiSuggestion.count({ where: { monitorId: fixture.monitorId } })).toBe(0);
        } finally { try { await cleanup(db, fixture); } finally { await db.$disconnect(); } }
    });
});
