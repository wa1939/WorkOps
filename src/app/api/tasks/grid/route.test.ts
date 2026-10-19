import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { GET } from "./route";

type GridPayload = {
    rows: Array<{ id: string; workspaceId: string | null }>;
    groups: Array<{ key: string; count: number; doneCount: number; overdueCount: number; estimateMinutesSum: number }>;
    nextCursor: { id: string; updatedAt: string } | null;
};

describe("GET /api/tasks/grid validation", () => {
    it("returns 401 before querying when the session is absent", async () => {
        auth.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost/api/tasks/grid"));
        expect(response.status).toBe(401);
        auth.mockReset();
    });

    it("returns 400 for a sort value outside the whitelist", async () => {
        auth.mockResolvedValue({ user: { id: "t13-validation-user", role: "MEMBER" } });
        const response = await GET(new Request("http://localhost/api/tasks/grid?sortBy=drop-table"));
        expect(response.status).toBe(400);
        auth.mockReset();
    });
});

describe.runIf(databaseEnabled)("GET /api/tasks/grid", () => {
    it("filters and groups tasks without crossing the selected workspace", async () => {
        const prisma = new PrismaClient();
        const suffix = randomUUID();
        const workspaceAId = `t13-workspace-a-${suffix}`;
        const workspaceBId = `t13-workspace-b-${suffix}`;
        const actorId = `t13-actor-${suffix}`;
        const assigneeId = `t13-assignee-${suffix}`;
        const projectAId = `t13-project-a-${suffix}`;
        const projectBId = `t13-project-b-${suffix}`;
        const taskAId = `t13-task-a-${suffix}`;
        const taskDoneId = `t13-task-done-${suffix}`;
        const taskBId = `t13-task-b-${suffix}`;
        vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));

        try {
            await prisma.workspace.createMany({
                data: [
                    { id: workspaceAId, slug: `t13-a-${suffix}`, name: "T13 A", timezone: "UTC" },
                    { id: workspaceBId, slug: `t13-b-${suffix}`, name: "T13 B", timezone: "UTC" },
                ],
            });
            await prisma.user.createMany({
                data: [
                    { id: actorId, email: `${actorId}@example.test`, name: "T13 Actor", role: "MEMBER" },
                    { id: assigneeId, email: `${assigneeId}@example.test`, name: "T13 Assignee", role: "MEMBER" },
                ],
            });
            await prisma.workspaceMember.createMany({
                data: [
                    { workspaceId: workspaceAId, userId: actorId, role: "MEMBER" },
                    { workspaceId: workspaceAId, userId: assigneeId, role: "MEMBER" },
                ],
            });
            await prisma.project.createMany({
                data: [
                    { id: projectAId, name: "T13 Project A", workspaceId: workspaceAId },
                    { id: projectBId, name: "T13 Project B", workspaceId: workspaceBId },
                ],
            });
            await prisma.task.createMany({
                data: [
                    {
                        id: taskAId,
                        taskKey: `T13-A-${suffix}`,
                        title: "T13 visible todo",
                        status: "TODO",
                        priority: "HIGH",
                        estimateMinutes: 45,
                        dueAt: new Date("2026-09-20T00:00:00.000Z"),
                        workspaceId: workspaceAId,
                        projectId: projectAId,
                        createdById: actorId,
                        isPrivate: false,
                    },
                    {
                        id: taskDoneId,
                        taskKey: `T13-DONE-${suffix}`,
                        title: "T13 visible done",
                        status: "DONE",
                        priority: "LOW",
                        estimateMinutes: 15,
                        dueAt: new Date("2026-09-10T00:00:00.000Z"),
                        workspaceId: workspaceAId,
                        projectId: projectAId,
                        createdById: actorId,
                        isPrivate: false,
                    },
                    {
                        id: taskBId,
                        taskKey: `T13-B-${suffix}`,
                        title: "T13 hidden workspace B",
                        status: "TODO",
                        priority: "HIGH",
                        estimateMinutes: 90,
                        workspaceId: workspaceBId,
                        projectId: projectBId,
                        createdById: actorId,
                        isPrivate: false,
                    },
                ],
            });
            await prisma.taskAssignment.create({ data: { taskId: taskAId, userId: assigneeId } });

            auth.mockResolvedValue({ user: { id: actorId, role: "MEMBER" } });
            const response = await GET(new Request(
                `http://localhost/api/tasks/grid?workspaceId=${workspaceAId}`
                + `&status=TODO,DONE&assigneeIds=${assigneeId}&groupBy=status&sortBy=updatedAt&dir=asc`,
            ));

            expect(response.status).toBe(200);
            const payload = await response.json() as GridPayload;
            expect(payload.rows.map((row) => row.id)).toEqual([taskAId]);
            expect(payload.rows.some((row) => row.id === taskBId)).toBe(false);
            expect(payload.groups).toEqual([
                expect.objectContaining({
                    key: "TODO",
                    count: 1,
                    doneCount: 0,
                    overdueCount: 0,
                    estimateMinutesSum: 45,
                }),
            ]);
            expect(payload.nextCursor).toBeNull();
        } finally {
            await prisma.task.deleteMany({ where: { id: { in: [taskAId, taskDoneId, taskBId] } } });
            await prisma.project.deleteMany({ where: { id: { in: [projectAId, projectBId] } } });
            await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
            await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
            await prisma.user.deleteMany({ where: { id: { in: [actorId, assigneeId] } } });
            await prisma.$disconnect();
            auth.mockReset();
            vi.useRealTimers();
        }
    });
});
