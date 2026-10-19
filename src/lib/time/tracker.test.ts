import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../scripts/assert-local-database";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { POST as postTimer } from "../../app/api/tasks/[id]/timer/route";
import { POST as postManualLog, GET as getTimeLogs } from "../../app/api/tasks/[id]/time-logs/route";
import { GET as getActiveTimer } from "../../app/api/users/me/active-timer/route";
import { elapsedMinutes, startTimer } from "./tracker";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Timer tests require a dedicated _test database");
    }
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();
const authMock = vi.mocked(auth);

type Fixture = {
    userId: string;
    taskOneId: string;
    taskTwoId: string;
};

async function createFixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const user = await db.user.create({
        data: {
            email: `timer-${suffix}@example.test`,
            name: "Timer Test User",
            role: "ADMIN",
        },
    });
    const taskOne = await db.task.create({
        data: { title: `Timer task one ${suffix}`, createdById: user.id },
    });
    const taskTwo = await db.task.create({
        data: { title: `Timer task two ${suffix}`, createdById: user.id },
    });
    return { userId: user.id, taskOneId: taskOne.id, taskTwoId: taskTwo.id };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
    await db.activeTimer.deleteMany({ where: { userId: fixture.userId } });
    await db.task.deleteMany({ where: { id: { in: [fixture.taskOneId, fixture.taskTwoId] } } });
    await db.user.delete({ where: { id: fixture.userId } });
}

function timerRequest(action: "start" | "stop", note?: string): Request {
    return new Request("http://localhost/api/tasks/task/timer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(note ? { note } : {}) }),
    });
}

function manualLogRequest(minutes: number, note: string): Request {
    return new Request("http://localhost/api/tasks/task/time-logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes, note }),
    });
}

function timerContext(taskId: string) {
    return { params: Promise.resolve({ id: taskId }) };
}

afterEach(() => {
    authMock.mockReset();
});

afterAll(async () => {
    await db.$disconnect();
});

describe("elapsedMinutes", () => {
    it("rounds elapsed time and never returns less than one minute", () => {
        const startedAt = new Date("2026-09-14T08:00:00.000Z");

        expect(elapsedMinutes(startedAt, new Date("2026-09-14T08:00:00.000Z"))).toBe(1);
        expect(elapsedMinutes(startedAt, new Date("2026-09-14T08:00:30.000Z"))).toBe(1);
        expect(elapsedMinutes(startedAt, new Date("2026-09-14T08:01:31.000Z"))).toBe(2);
        expect(elapsedMinutes(startedAt, new Date("2026-09-14T07:59:00.000Z"))).toBe(1);
    });
});

describe.runIf(databaseEnabled)("time tracker and timer route", () => {
    it("stops an existing timer before starting a different task", async () => {
        const fixture = await createFixture();
        const firstStart = new Date("2026-09-14T08:00:00.000Z");
        try {
            await startTimer(db, fixture.userId, fixture.taskOneId, firstStart);
            await startTimer(db, fixture.userId, fixture.taskTwoId, new Date("2026-09-14T08:02:29.000Z"));

            const logs = await db.timeLog.findMany({ where: { userId: fixture.userId } });
            expect(logs).toHaveLength(1);
            expect(logs[0]).toMatchObject({
                taskId: fixture.taskOneId,
                userId: fixture.userId,
                minutes: 2,
                source: "timer",
            });

            await expect(db.activeTimer.findUnique({ where: { userId: fixture.userId } })).resolves.toMatchObject({
                userId: fixture.userId,
                taskId: fixture.taskTwoId,
                startedAt: new Date("2026-09-14T08:02:29.000Z"),
            });
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("starts and stops a timer through the route with a one-minute minimum", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.userId, role: "ADMIN" } } as never);
        try {
            const started = await postTimer(timerRequest("start"), timerContext(fixture.taskOneId));
            expect(started.status).toBe(200);

            const stopped = await postTimer(timerRequest("stop", "wrap-up"), timerContext(fixture.taskOneId));
            expect(stopped.status).toBe(200);
            await expect(stopped.json()).resolves.toMatchObject({
                log: { taskId: fixture.taskOneId, userId: fixture.userId, minutes: 1, note: "wrap-up", source: "timer" },
            });

            await expect(db.timeLog.findFirst({ where: { userId: fixture.userId, taskId: fixture.taskOneId } })).resolves.toMatchObject({
                minutes: 1,
                source: "timer",
                note: "wrap-up",
            });
            await expect(db.activeTimer.findUnique({ where: { userId: fixture.userId } })).resolves.toBeNull();
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("starts and stops a timer through the route with a one-minute minimum", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.userId, role: "ADMIN" } } as never);
        try {
            const started = await postTimer(timerRequest("start"), timerContext(fixture.taskOneId));
            expect(started.status).toBe(200);

            const stopped = await postTimer(timerRequest("stop", "wrap-up"), timerContext(fixture.taskOneId));
            expect(stopped.status).toBe(200);
            await expect(stopped.json()).resolves.toMatchObject({
                log: { taskId: fixture.taskOneId, userId: fixture.userId, minutes: 1, note: "wrap-up", source: "timer" },
            });

            await expect(db.timeLog.findFirst({ where: { userId: fixture.userId, taskId: fixture.taskOneId } })).resolves.toMatchObject({
                minutes: 1,
                source: "timer",
                note: "wrap-up",
            });
            await expect(db.activeTimer.findUnique({ where: { userId: fixture.userId } })).resolves.toBeNull();
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("returns the user's active timer and records manual time logs", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.userId, role: "ADMIN" } } as never);
        try {
            await expect(getActiveTimer()).resolves.toHaveProperty("status", 200);
            const emptyActive = await getActiveTimer();
            await expect(emptyActive.json()).resolves.toBeNull();

            const manual = await postManualLog(manualLogRequest(45, "Design review"), timerContext(fixture.taskOneId));
            expect(manual.status).toBe(201);
            await expect(manual.json()).resolves.toMatchObject({ minutes: 45, note: "Design review", source: "manual" });

            const logs = await getTimeLogs(new Request("http://localhost/api/tasks/task/time-logs"), timerContext(fixture.taskOneId));
            await expect(logs.json()).resolves.toMatchObject({ totalMinutes: 45, logs: [expect.objectContaining({ minutes: 45, source: "manual" })] });

            await postTimer(timerRequest("start"), timerContext(fixture.taskOneId));
            const active = await getActiveTimer();
            await expect(active.json()).resolves.toMatchObject({ taskId: fixture.taskOneId, elapsedMinutes: 1 });
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("applies conflict-stop semantics when the route starts a second task", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.userId, role: "ADMIN" } } as never);
        try {
            await expect(postTimer(timerRequest("start"), timerContext(fixture.taskOneId))).resolves.toHaveProperty("status", 200);
            await expect(postTimer(timerRequest("start"), timerContext(fixture.taskTwoId))).resolves.toHaveProperty("status", 200);

            await expect(db.timeLog.findMany({ where: { userId: fixture.userId } })).resolves.toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ taskId: fixture.taskOneId, minutes: 1, source: "timer" }),
                ]),
            );
            await expect(db.activeTimer.findUnique({ where: { userId: fixture.userId } })).resolves.toMatchObject({
                taskId: fixture.taskTwoId,
            });
        } finally {
            await destroyFixture(fixture);
        }
    });
});
