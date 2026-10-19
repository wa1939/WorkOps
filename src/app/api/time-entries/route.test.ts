import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../scripts/assert-local-database";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET } from "./route";
import { POST as POST_EXPORT } from "./export/route";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Time entry route tests require a dedicated _test database");
    }
    process.env.DATABASE_URL = databaseUrl;
}

const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();
const authMock = vi.mocked(auth);

type Fixture = {
    viewerId: string;
    otherId: string;
    projectId: string;
    taskId: string;
    otherTaskId: string;
};

async function createFixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const viewer = await db.user.create({
        data: { email: `time-entry-viewer-${suffix}@example.test`, name: "Time Entry Viewer", role: "MEMBER" },
    });
    const other = await db.user.create({
        data: { email: `time-entry-other-${suffix}@example.test`, name: "Other Time User", role: "MEMBER" },
    });
    const project = await db.project.create({ data: { name: `Time Entry Project ${suffix}`, ownerId: viewer.id } });
    const task = await db.task.create({
        data: { title: `Time entry task ${suffix}`, taskKey: `TIME-${suffix.slice(0, 8)}`, projectId: project.id, createdById: viewer.id },
    });
    const otherTask = await db.task.create({
        data: { title: `Other time entry task ${suffix}`, projectId: project.id, createdById: viewer.id },
    });

    await db.timeLog.createMany({
        data: [
            { taskId: task.id, userId: viewer.id, startedAt: new Date("2026-09-13T09:00:00.000Z"), minutes: 30, note: "Planning", source: "manual" },
            { taskId: task.id, userId: viewer.id, startedAt: new Date("2026-09-14T10:00:00.000Z"), minutes: 45, note: "Implementation", source: "timer" },
            { taskId: otherTask.id, userId: other.id, startedAt: new Date("2026-09-13T11:00:00.000Z"), minutes: 60, note: "Other user's work", source: "manual" },
        ],
    });

    return { viewerId: viewer.id, otherId: other.id, projectId: project.id, taskId: task.id, otherTaskId: otherTask.id };
}

async function destroyFixture(fixture: Fixture): Promise<void> {
    await db.timeLog.deleteMany({ where: { taskId: { in: [fixture.taskId, fixture.otherTaskId] } } });
    await db.task.deleteMany({ where: { id: { in: [fixture.taskId, fixture.otherTaskId] } } });
    await db.project.delete({ where: { id: fixture.projectId } });
    await db.user.deleteMany({ where: { id: { in: [fixture.viewerId, fixture.otherId] } } });
}

function request(params: Record<string, string>): Request {
    const query = new URLSearchParams(params);
    return new Request(`http://localhost/api/time-entries?${query.toString()}`);
}

function exportRequest(body: Record<string, string>): Request {
    return new Request("http://localhost/api/time-entries/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

afterEach(() => {
    authMock.mockReset();
});

afterAll(async () => {
    await db.$disconnect();
});

describe.runIf(databaseEnabled)("GET /api/time-entries", () => {
    it("returns a member's entries with day and week totals", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.viewerId, role: "MEMBER" } } as never);
        try {
            const response = await GET(request({ from: "2026-09-13", to: "2026-09-20", projectId: fixture.projectId }));
            expect(response.status).toBe(200);
            const body = await response.json();
            expect(body.dayTotals).toEqual({ "2026-09-13": 30, "2026-09-14": 45 });
            expect(body.weekTotal).toBe(75);
            expect(body.logs).toHaveLength(2);
            const viewerEntry = body.logs.find((log: { taskId: string }) => log.taskId === fixture.taskId);
            expect(viewerEntry).toMatchObject({
                taskId: fixture.taskId,
                userId: fixture.viewerId,
                task: {
                    taskKey: expect.stringMatching(/^TIME-/),
                    project: { id: fixture.projectId },
                },
                user: { id: fixture.viewerId, name: "Time Entry Viewer" },
            });
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("exports the selected entries as an XLSX workbook with stable columns", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.viewerId, role: "MEMBER" } } as never);
        try {
            const response = await POST_EXPORT(exportRequest({ from: "2026-09-13", to: "2026-09-20", projectId: fixture.projectId }));
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            expect(response.headers.get("content-disposition")).toContain("time-entries.xlsx");

            const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0] as string];
            const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 }) as unknown[][];
            expect(rows[0]).toEqual(["Date", "TaskKey", "Task", "Project", "User", "Minutes", "Note", "Source"]);
            expect(rows).toHaveLength(3);
            expect(String(rows[1]?.[1])).toMatch(/^TIME-/);
            expect(rows[1]?.[5]).toBe(45);
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("prevents a member from querying another user's entries", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.viewerId, role: "MEMBER" } } as never);
        try {
            const response = await GET(request({ from: "2026-09-13", to: "2026-09-20", userId: fixture.otherId }));
            expect(response.status).toBe(403);
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("allows a lead to query another user's entries", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.viewerId, role: "LEAD" } } as never);
        try {
            const response = await GET(request({ from: "2026-09-13", to: "2026-09-20", userId: fixture.otherId }));
            expect(response.status).toBe(200);
            await expect(response.json()).resolves.toMatchObject({
                weekTotal: 60,
                logs: [expect.objectContaining({ userId: fixture.otherId, taskId: fixture.otherTaskId })],
            });
        } finally {
            await destroyFixture(fixture);
        }
    });

    it("rejects requests without both ISO date bounds", async () => {
        const fixture = await createFixture();
        authMock.mockResolvedValue({ user: { id: fixture.viewerId, role: "MEMBER" } } as never);
        try {
            const response = await GET(request({ from: "2026-09-13" }));
            expect(response.status).toBe(400);
        } finally {
            await destroyFixture(fixture);
        }
    });
});
