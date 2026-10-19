import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "./route";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Utilization tests require a dedicated _test database");
    }
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();
const authMock = vi.mocked(auth);

type Fixture = { userId: string; delegateId: string; projectId: string; taskId: string; leaveId: string };

async function createFixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const user = await db.user.create({
        data: { email: `utilization-user-${suffix}@example.test`, name: "Utilization User", role: "MEMBER", capacityPerWeekHours: 35 },
    });
    const delegate = await db.user.create({
        data: { email: `utilization-delegate-${suffix}@example.test`, name: "Utilization Delegate", role: "MEMBER" },
    });
    const project = await db.project.create({ data: { name: `Utilization Project ${suffix}`, ownerId: user.id } });
    const task = await db.task.create({ data: { title: "Utilization task", projectId: project.id, createdById: user.id } });
    await db.timeLog.create({
        data: { taskId: task.id, userId: user.id, startedAt: new Date("2026-09-13T09:00:00.000Z"), minutes: 420 },
    });
    const leave = await db.leaveRequest.create({
        data: {
            userId: user.id,
            delegateId: delegate.id,
            startAt: new Date("2026-09-14T00:00:00.000Z"),
            endAt: new Date("2026-09-14T21:00:00.000Z"),
            status: "Approved",
        },
    });
    return { userId: user.id, delegateId: delegate.id, projectId: project.id, taskId: task.id, leaveId: leave.id };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
    await db.leaveRequest.delete({ where: { id: fixture.leaveId } });
    await db.timeLog.deleteMany({ where: { taskId: fixture.taskId } });
    await db.task.delete({ where: { id: fixture.taskId } });
    await db.project.delete({ where: { id: fixture.projectId } });
    await db.user.deleteMany({ where: { id: { in: [fixture.userId, fixture.delegateId] } } });
}

function request(): Request {
    return new Request("http://localhost/api/reports/utilization?from=2026-09-13&to=2026-09-20");
}

afterEach(() => authMock.mockReset());
afterAll(async () => db.$disconnect());

describe.runIf(databaseEnabled)("GET /api/reports/utilization", () => {
    it("subtracts approved leave from a five-day weekly capacity", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.userId, role: "MEMBER" } } as never);
        try {
            const response = await GET(request());
            expect(response.status).toBe(200);
            const body = await response.json();
            expect(body.members).toHaveLength(1);
            expect(body.members[0]).toMatchObject({
                memberId: fixture.userId,
                capacityHours: 28,
                loggedHours: 7,
                utilizationPercent: 25,
                state: "under",
            });
            expect(body.members[0].weeks).toEqual(expect.arrayContaining([
                expect.objectContaining({ weekStart: "2026-09-13", capacityHours: 28, loggedHours: 7 }),
            ]));
        } finally {
            await destroyFixture(fixture);
        }
    });
});
