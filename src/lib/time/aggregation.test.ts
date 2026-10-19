import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { parentTaskTimeRollup, totalMinutes, weekBuckets } from "./aggregation";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Time aggregation tests require a dedicated _test database");
    }
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();

afterAll(async () => {
    await db.$disconnect();
});

describe("time aggregation helpers", () => {
    it("groups logs by their UTC calendar day", () => {
        const logs = [
            { startedAt: new Date("2026-09-13T23:30:00.000Z"), minutes: 20 },
            { startedAt: new Date("2026-09-14T01:00:00.000Z"), minutes: 35 },
            { startedAt: "2026-09-14T13:00:00.000Z", minutes: 10 },
        ];

        expect(weekBuckets(logs)).toEqual({
            "2026-09-13": 20,
            "2026-09-14": 45,
        });
        expect(totalMinutes(logs)).toBe(65);
    });
});

describe.runIf(databaseEnabled)("recursive task time rollup", () => {
    it("includes the parent and all non-archived descendants", async () => {
        const suffix = randomUUID();
        const user = await db.user.create({
            data: {
                email: `time-rollup-${suffix}@example.test`,
                name: "Time Rollup Test User",
                role: "ADMIN",
            },
        });
        const root = await db.task.create({ data: { title: `Rollup root ${suffix}`, createdById: user.id } });
        const child = await db.task.create({ data: { title: `Rollup child ${suffix}`, parentTaskId: root.id, createdById: user.id } });
        const grandchild = await db.task.create({ data: { title: `Rollup grandchild ${suffix}`, parentTaskId: child.id, createdById: user.id } });
        const archivedChild = await db.task.create({ data: { title: `Archived child ${suffix}`, parentTaskId: root.id, archived: true, createdById: user.id } });
        const taskIds = [root.id, child.id, grandchild.id, archivedChild.id];

        try {
            await db.timeLog.createMany({
                data: [
                    { taskId: root.id, userId: user.id, startedAt: new Date("2026-09-14T08:00:00.000Z"), minutes: 20 },
                    { taskId: child.id, userId: user.id, startedAt: new Date("2026-09-14T09:00:00.000Z"), minutes: 35 },
                    { taskId: grandchild.id, userId: user.id, startedAt: new Date("2026-09-14T10:00:00.000Z"), minutes: 50 },
                    { taskId: archivedChild.id, userId: user.id, startedAt: new Date("2026-09-14T11:00:00.000Z"), minutes: 999 },
                ],
            });

            await expect(parentTaskTimeRollup(root.id, db)).resolves.toBe(105);
        } finally {
            await db.timeLog.deleteMany({ where: { taskId: { in: taskIds } } });
            await db.task.deleteMany({ where: { id: { in: taskIds } } });
            await db.user.delete({ where: { id: user.id } });
        }
    });
});
