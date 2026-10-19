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
        throw new Error("Estimate-vs-actual tests require a dedicated _test database");
    }
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();
const authMock = vi.mocked(auth);

type Fixture = {
    viewerId: string;
    otherId: string;
    leadId: string;
    projectId: string;
    viewerTaskId: string;
    otherTaskId: string;
};

async function createFixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const viewer = await db.user.create({
        data: { email: `estimate-viewer-${suffix}@example.test`, name: "Estimate Viewer", role: "MEMBER" },
    });
    const other = await db.user.create({
        data: { email: `estimate-other-${suffix}@example.test`, name: "Estimate Other", role: "MEMBER" },
    });
    const lead = await db.user.create({
        data: { email: `estimate-lead-${suffix}@example.test`, name: "Estimate Lead", role: "ADMIN" },
    });
    const project = await db.project.create({ data: { name: `Estimate Project ${suffix}`, ownerId: viewer.id } });
    const viewerTask = await db.task.create({
        data: {
            title: "Viewer estimate",
            taskKey: `EST-${suffix.slice(0, 8)}-A`,
            projectId: project.id,
            createdById: viewer.id,
            estimateMinutes: 120,
            assignments: { create: [{ userId: viewer.id }] },
        },
    });
    const otherTask = await db.task.create({
        data: {
            title: "Other estimate",
            taskKey: `EST-${suffix.slice(0, 8)}-B`,
            projectId: project.id,
            createdById: viewer.id,
            estimateMinutes: 60,
            assignments: { create: [{ userId: other.id }] },
        },
    });
    await db.timeLog.createMany({
        data: [
            { taskId: viewerTask.id, userId: viewer.id, startedAt: new Date("2026-09-13T09:00:00.000Z"), minutes: 60 },
            { taskId: otherTask.id, userId: other.id, startedAt: new Date("2026-09-14T09:00:00.000Z"), minutes: 90 },
        ],
    });
    return {
        viewerId: viewer.id,
        otherId: other.id,
        leadId: lead.id,
        projectId: project.id,
        viewerTaskId: viewerTask.id,
        otherTaskId: otherTask.id,
    };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
    await db.timeLog.deleteMany({ where: { taskId: { in: [fixture.viewerTaskId, fixture.otherTaskId] } } });
    await db.task.deleteMany({ where: { id: { in: [fixture.viewerTaskId, fixture.otherTaskId] } } });
    await db.project.delete({ where: { id: fixture.projectId } });
    await db.user.deleteMany({ where: { id: { in: [fixture.viewerId, fixture.otherId, fixture.leadId] } } });
}

function request(params: Record<string, string>): Request {
    return new Request(`http://localhost/api/reports/estimate-vs-actual?${new URLSearchParams(params).toString()}`);
}

afterEach(() => authMock.mockReset());
afterAll(async () => db.$disconnect());

describe.runIf(databaseEnabled)("GET /api/reports/estimate-vs-actual", () => {
    it("aggregates project and member estimates with variance state", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.leadId, role: "LEAD" } } as never);
        try {
            const response = await GET(request({ from: "2026-09-13", to: "2026-09-20", projectId: fixture.projectId }));
            expect(response.status).toBe(200);
            const body = await response.json();
            expect(body.projects).toHaveLength(1);
            expect(body.projects[0]).toMatchObject({
                projectId: fixture.projectId,
                estimatedMinutes: 180,
                loggedMinutes: 150,
                taskCount: 2,
                variance: { state: "under" },
            });
            expect(body.members).toEqual(expect.arrayContaining([
                expect.objectContaining({ memberId: fixture.viewerId, estimatedMinutes: 120, loggedMinutes: 60 }),
                expect.objectContaining({ memberId: fixture.otherId, estimatedMinutes: 60, loggedMinutes: 90 }),
            ]));
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("limits a member to their own data and rejects another member filter", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.viewerId, role: "MEMBER" } } as never);
        try {
            const own = await GET(request({ from: "2026-09-13", to: "2026-09-20" }));
            expect(own.status).toBe(200);
            await expect(own.json()).resolves.toMatchObject({
                projects: [expect.objectContaining({ estimatedMinutes: 120, loggedMinutes: 60, taskCount: 1 })],
            });
            const other = await GET(request({ from: "2026-09-13", to: "2026-09-20", memberId: fixture.otherId }));
            expect(other.status).toBe(403);
        } finally {
            await destroyFixture(fixture);
        }
    });
});
