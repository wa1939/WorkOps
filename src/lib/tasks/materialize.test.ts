import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { runDueRecurrences } from "./materialize";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();

describe.runIf(databaseEnabled)("recurrence materializer", () => {
    afterAll(async () => {
        await db.$disconnect();
    });

    it("creates a fresh keyed task and advances the due rule", async () => {
        const token = randomUUID();
        const projectId = `recurrence-project-${token}`;
        const sourceTaskId = `recurrence-source-${token}`;
        const scheduled = new Date("2026-09-14T00:00:00.000Z");
        const now = new Date("2026-09-14T12:00:00.000Z");

        await db.project.create({
            data: { id: projectId, name: `Recurring ${token}`, taskSeq: 1 },
        });
        await db.task.create({
            data: {
                id: sourceTaskId,
                taskKey: `SRC-${token.slice(0, 8)}`,
                title: `Recurring source ${token}`,
                projectId,
                status: "DOING",
                startAt: new Date("2026-09-13T00:00:00.000Z"),
                dueAt: scheduled,
                manualProgress: 45,
            },
        });
        await db.recurringRule.create({
            data: {
                id: `recurrence-rule-${token}`,
                taskId: sourceTaskId,
                freq: "daily",
                interval: 1,
                mode: "create",
                active: true,
                nextRunAt: scheduled,
            },
        });

        try {
            await expect(runDueRecurrences(now, 50)).resolves.toMatchObject({ processed: 1, created: 1 });

            const copies = await db.task.findMany({
                where: { projectId, title: `Recurring source ${token} (Recurring)` },
            });
            expect(copies).toHaveLength(1);
            expect(copies[0]?.taskKey).toMatch(/^REC-/);
            expect(copies[0]?.taskKey).not.toBe(`SRC-${token.slice(0, 8)}`);
            expect(copies[0]?.status).toBe("TODO");
            expect(copies[0]?.doneAt).toBeNull();
            expect(copies[0]?.manualProgress).toBeNull();
            // The copy is dated at the occurrence that is DUE now, not at the
            // future nextRunAt (spec-review fix): dueAt == scheduled.
            expect(copies[0]?.dueAt).toEqual(new Date("2026-09-14T00:00:00.000Z"));
            expect(copies[0]?.startAt).toEqual(new Date("2026-09-13T00:00:00.000Z"));

            const rule = await db.recurringRule.findUnique({ where: { taskId: sourceTaskId } });
            expect(rule?.lastRunAt).toEqual(scheduled);
            expect(rule?.nextRunAt).toEqual(new Date("2026-09-15T00:00:00.000Z"));
            expect(rule?.nextRunAt?.getTime()).toBeGreaterThan(now.getTime());
        } finally {
            await db.task.deleteMany({ where: { projectId } });
            await db.project.delete({ where: { id: projectId } });
        }
    });
});
