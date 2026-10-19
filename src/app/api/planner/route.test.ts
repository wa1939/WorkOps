import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../scripts/assert-local-database";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Planner route tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { GET } from "./route";

type PlannerPayload = {
    members: Array<{
        id: string;
        days: Array<{
            datePart: string;
            capacityHours: number;
            allocatedHours: number;
            availableHours: number;
            utilizationPercent: number | null;
            taskChips: Array<{ taskId: string; projectId: string | null }>;
        }>;
    }>;
    projectAxis: Array<{ projectId: string; days: Array<{ datePart: string; allocatedHours: number }> }>;
    teamTotal: { days: Array<{ datePart: string; allocatedHours: number; utilizationPercent: number | null }> };
    backlog: Array<{ taskId: string; reason: string }>;
    unknownEffortCount: number;
};

describe("GET /api/planner validation", () => {
    it("returns 401 before parsing or querying when the session is absent", async () => {
        auth.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost/api/planner"));
        expect(response.status).toBe(401);
        auth.mockReset();
    });

    it("rejects viewers and malformed ranges", async () => {
        auth.mockResolvedValue({ user: { id: "viewer", role: "VIEWER" } });
        expect((await GET(new Request("http://localhost/api/planner?from=2026-01-04&to=2026-01-04"))).status).toBe(403);

        auth.mockResolvedValue({ user: { id: "member", role: "MEMBER" } });
        expect((await GET(new Request("http://localhost/api/planner?from=2026-01-05&to=2026-01-04"))).status).toBe(400);
        auth.mockReset();
    });
});

describe.runIf(databaseEnabled)("GET /api/planner", () => {
    it("returns the scoped read model and excludes a project outside viewer visibility", async () => {
        const db = new PrismaClient();
        const suffix = randomUUID();
        const actorId = `t31-actor-${suffix}`;
        const assigneeId = `t31-assignee-${suffix}`;
        const outsiderId = `t31-outsider-${suffix}`;
        const workspaceId = `t31-workspace-${suffix}`;
        const outsideWorkspaceId = `t31-outside-workspace-${suffix}`;
        const projectId = `t31-project-${suffix}`;
        const outsideProjectId = `t31-outside-project-${suffix}`;
        const taskId = `t31-task-${suffix}`;
        const outsideTaskId = `t31-outside-task-${suffix}`;

        try {
            await db.workspace.createMany({
                data: [
                    { id: workspaceId, slug: `t31-${suffix}`, name: "T31 workspace", timezone: "Asia/Riyadh" },
                    { id: outsideWorkspaceId, slug: `t31-outside-${suffix}`, name: "T31 outside", timezone: "Asia/Riyadh" },
                ],
            });
            await db.user.createMany({
                data: [
                    { id: actorId, email: `${actorId}@example.test`, name: "T31 Actor", role: "MEMBER" },
                    { id: assigneeId, email: `${assigneeId}@example.test`, name: "T31 Assignee", role: "MEMBER", capacityPerWeekHours: 40 },
                    { id: outsiderId, email: `${outsiderId}@example.test`, name: "T31 Outsider", role: "MEMBER" },
                ],
            });
            await db.workspaceMember.createMany({
                data: [
                    { workspaceId, userId: actorId, role: "MEMBER" },
                    { workspaceId, userId: assigneeId, role: "MEMBER" },
                ],
            });
            await db.project.createMany({
                data: [
                    { id: projectId, name: "T31 visible project", workspaceId, ownerId: actorId },
                    { id: outsideProjectId, name: "T31 hidden project", workspaceId: outsideWorkspaceId, ownerId: outsiderId },
                ],
            });
            await db.task.createMany({
                data: [
                    {
                        id: taskId,
                        taskKey: `T31-${suffix}`,
                        title: "Visible planned task",
                        status: "TODO",
                        priority: "HIGH",
                        estimateMinutes: 120,
                        remainingEffortHours: 2,
                        plannedStartAt: new Date("2026-01-04T00:00:00.000+03:00"),
                        plannedEndAt: new Date("2026-01-04T23:59:59.999+03:00"),
                        projectId,
                        workspaceId,
                        createdById: actorId,
                    },
                    {
                        id: outsideTaskId,
                        taskKey: `T31-outside-${suffix}`,
                        title: "Hidden planned task",
                        status: "TODO",
                        priority: "HIGH",
                        estimateMinutes: 120,
                        remainingEffortHours: 2,
                        plannedStartAt: new Date("2026-01-04T00:00:00.000+03:00"),
                        plannedEndAt: new Date("2026-01-04T23:59:59.999+03:00"),
                        projectId: outsideProjectId,
                        workspaceId: outsideWorkspaceId,
                        createdById: outsiderId,
                    },
                ],
            });
            await db.taskAssignment.create({ data: { taskId, userId: assigneeId, plannedShare: 1 } });
            await db.taskAssignment.create({ data: { taskId: outsideTaskId, userId: outsiderId, plannedShare: 1 } });

            auth.mockResolvedValue({ user: { id: actorId, role: "MEMBER" } });
            const response = await GET(new Request(
                "http://localhost/api/planner?from=2026-01-04&to=2026-01-04"
                + `&projectIds=${projectId},${outsideProjectId}&memberIds=${assigneeId},${outsiderId}`,
            ));

            expect(response.status).toBe(200);
            expect(response.headers.get("cache-control")).toBe("no-store");
            const payload = await response.json() as PlannerPayload;
            expect(payload.members.some((member) => member.days.some((day) => day.taskChips.some((chip) => chip.taskId === outsideTaskId)))).toBe(false);
            expect(payload.projectAxis.map((project) => project.projectId)).toEqual([projectId]);
            expect(payload.projectAxis[0].days).toEqual([{ datePart: "2026-01-04", allocatedHours: 2 }]);
            expect(payload.members.find((member) => member.id === assigneeId)?.days[0]).toMatchObject({
                capacityHours: 8,
                allocatedHours: 2,
                availableHours: 6,
                utilizationPercent: 25,
            });
            expect(payload.teamTotal.days).toEqual([
                expect.objectContaining({ datePart: "2026-01-04", allocatedHours: 2 }),
            ]);
            expect(payload.backlog).toEqual([]);
            expect(payload.unknownEffortCount).toBe(0);
        } finally {
            await db.task.deleteMany({ where: { id: { in: [taskId, outsideTaskId] } } });
            await db.project.deleteMany({ where: { id: { in: [projectId, outsideProjectId] } } });
            await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [workspaceId, outsideWorkspaceId] } } });
            await db.workspace.deleteMany({ where: { id: { in: [workspaceId, outsideWorkspaceId] } } });
            await db.user.deleteMany({ where: { id: { in: [actorId, assigneeId, outsiderId] } } });
            await db.$disconnect();
            auth.mockReset();
        }
    });
});
