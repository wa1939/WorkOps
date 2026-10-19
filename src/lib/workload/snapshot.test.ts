import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";
import { publishSnapshot } from "./snapshot";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Workload snapshot persistence test requires a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const db1 = new PrismaClient();
const db2 = new PrismaClient();

const weekStart = new Date("2026-09-06T00:00:00.000Z");

function row(userId: string, loadHours: number) {
    return {
        userId,
        weekStart,
        loadHours,
        loadPercent: loadHours * 10,
        driversJson: JSON.stringify({ hours: loadHours, capacity: 35, leaveDays: 0, drivers: [] }),
        unknownTaskCount: 0,
        backlogCount: 1,
        confidence: 0.9,
    };
}

async function withFixture(run: (fixture: { userId: string; scope: string }) => Promise<void>) {
    const suffix = randomUUID();
    const userId = `snapshot-test-user-${suffix}`;
    const scope = `snapshot-test-scope-${suffix}`;
    await db1.user.create({ data: { id: userId, email: `${userId}@example.test`, name: "Snapshot Test User" } });
    try {
        await run({ userId, scope });
    } finally {
        await db1.teamLoadSnapshot.deleteMany({ where: { userId } });
        await db1.teamLoadRun.deleteMany({ where: { scope } });
        await db1.user.delete({ where: { id: userId } });
    }
}

afterAll(async () => {
    await Promise.all([db1.$disconnect(), db2.$disconnect()]);
});

describe.runIf(databaseEnabled)("workload snapshot publishing", () => {
    it("concurrent refresh computes once", async () => {
        await withFixture(async ({ userId, scope }) => {
            let computeCount = 0;
            const compute = async () => {
                computeCount++;
                await new Promise((resolve) => setTimeout(resolve, 150));
                return { rows: [row(userId, 4)] };
            };

            const [first, second] = await Promise.all([
                publishSnapshot(db1, scope, compute, { inputVersion: "v1", calendarVersion: "calendar-1", leaseMs: 2_000 }),
                publishSnapshot(db2, scope, compute, { inputVersion: "v1", calendarVersion: "calendar-1", leaseMs: 2_000 }),
            ]);

            expect(computeCount).toBe(1);
            expect([first, second].filter((result) => result.skipped)).toHaveLength(1);
            const skipped = [first, second].find((result) => result.skipped);
            expect(skipped?.reason === "lease-held" || skipped?.reason === "already-current").toBe(true);
            expect([first, second].find((result) => !result.skipped)).toMatchObject({ skipped: false, run: "published" });
        });
    });

    it("re-invocation with unchanged version does not recompute", async () => {
        await withFixture(async ({ userId, scope }) => {
            let computeCount = 0;
            const compute = async () => {
                computeCount++;
                return { rows: [row(userId, 4)] };
            };

            const first = await publishSnapshot(db1, scope, compute, {
                inputVersion: "v1",
                calendarVersion: "calendar-1",
            });
            const second = await publishSnapshot(db2, scope, compute, {
                inputVersion: "v1",
                calendarVersion: "calendar-1",
            });

            expect(first).toMatchObject({ skipped: false, run: "published" });
            expect(second).toMatchObject({ skipped: true, reason: "already-current" });
            expect(computeCount).toBe(1);
        });
    });

    it("failed run leaves previous snapshot intact", async () => {
        await withFixture(async ({ userId, scope }) => {
            await publishSnapshot(db1, scope, async () => ({ rows: [row(userId, 4)] }), {
                inputVersion: "v1",
                calendarVersion: "calendar-1",
                finishedAt: new Date("2026-09-07T01:00:00.000Z"),
            });

            await expect(
                publishSnapshot(db2, scope, async () => {
                    throw new Error("synthetic compute failure");
                }, {
                    inputVersion: "v2",
                    calendarVersion: "calendar-1",
                }),
            ).rejects.toThrow("synthetic compute failure");

            const active = await db1.teamLoadSnapshot.findUniqueOrThrow({
                where: { userId_weekStart: { userId, weekStart } },
            });
            expect(active).toMatchObject({ inputVersion: "v1", calendarVersion: "calendar-1", loadHours: 4 });
            await expect(db1.teamLoadRun.findFirstOrThrow({ where: { scope, inputVersion: "v2" } })).resolves.toMatchObject({ status: "failed" });
        });
    });

    it("late older run cannot replace newer snapshot", async () => {
        await withFixture(async ({ userId, scope }) => {
            await publishSnapshot(db1, scope, async () => ({ rows: [row(userId, 8)] }), {
                inputVersion: "v2",
                calendarVersion: "calendar-1",
                finishedAt: new Date("2026-09-07T02:00:00.000Z"),
            });

            const late = await publishSnapshot(db2, scope, async () => ({ rows: [row(userId, 2)] }), {
                inputVersion: "v1",
                calendarVersion: "calendar-1",
                finishedAt: new Date("2026-09-07T01:00:00.000Z"),
            });

            expect(late).toMatchObject({ skipped: true, reason: "stale-run" });
            const active = await db1.teamLoadSnapshot.findUniqueOrThrow({
                where: { userId_weekStart: { userId, weekStart } },
            });
            expect(active).toMatchObject({ inputVersion: "v2", calendarVersion: "calendar-1", loadHours: 8 });
        });
    });

    it("calendar edit invalidates snapshot", async () => {
        await withFixture(async ({ userId, scope }) => {
            await publishSnapshot(db1, scope, async () => ({ rows: [row(userId, 4)] }), {
                inputVersion: "same-input",
                calendarVersion: "calendar-1",
                finishedAt: new Date("2026-09-07T01:00:00.000Z"),
            });
            await publishSnapshot(db2, scope, async () => ({ rows: [row(userId, 6)] }), {
                inputVersion: "same-input",
                calendarVersion: "calendar-2",
                finishedAt: new Date("2026-09-07T02:00:00.000Z"),
            });

            const active = await db1.teamLoadSnapshot.findUniqueOrThrow({
                where: { userId_weekStart: { userId, weekStart } },
            });
            expect(active).toMatchObject({ inputVersion: "same-input", calendarVersion: "calendar-2", loadHours: 6 });
            await expect(db1.teamLoadSnapshot.count({ where: { userId } })).resolves.toBe(1);
        });
    });
});
