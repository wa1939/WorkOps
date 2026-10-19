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

type BoardPayload = {
    tasks: Array<{
        id: string;
        status: string;
        dueDate: string | null;
        assignees: unknown[];
        subtaskCount: number;
        completedSubtasks: number;
    }>;
};

describe("GET /api/tasks/board validation", () => {
    it("returns 401 before querying when the session is absent", async () => {
        auth.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost/api/tasks/board"));
        expect(response.status).toBe(401);
        auth.mockReset();
    });
});

describe.runIf(databaseEnabled)("GET /api/tasks/board", () => {
    it("scopes cards to the requested workspace", async () => {
        const prisma = new PrismaClient();
        const suffix = randomUUID();
        const workspaceAId = `t251-workspace-a-${suffix}`;
        const workspaceBId = `t251-workspace-b-${suffix}`;
        const actorId = `t251-actor-${suffix}`;
        const taskAId = `t251-task-a-${suffix}`;
        const taskBId = `t251-task-b-${suffix}`;
        const taskSubtaskId = `t251-subtask-${suffix}`;

        try {
            await prisma.workspace.createMany({
                data: [
                    { id: workspaceAId, slug: `t251-a-${suffix}`, name: "T251 A", timezone: "UTC" },
                    { id: workspaceBId, slug: `t251-b-${suffix}`, name: "T251 B", timezone: "UTC" },
                ],
            });
            await prisma.user.create({
                data: { id: actorId, email: `${actorId}@example.test`, name: "T251 Actor", role: "MEMBER" },
            });
            await prisma.workspaceMember.create({
                data: { workspaceId: workspaceAId, userId: actorId, role: "MEMBER" },
            });
            await prisma.task.createMany({
                data: [
                    {
                        id: taskAId,
                        taskKey: `T251-A-${suffix}`,
                        title: "T251 visible card",
                        status: "TODO",
                        priority: "HIGH",
                        dueAt: new Date("2026-09-20T00:00:00.000Z"),
                        workspaceId: workspaceAId,
                        createdById: actorId,
                        isPrivate: false,
                    },
                    {
                        id: taskBId,
                        taskKey: `T251-B-${suffix}`,
                        title: "T251 hidden card",
                        status: "DOING",
                        priority: "LOW",
                        workspaceId: workspaceBId,
                        createdById: actorId,
                        isPrivate: false,
                    },
                ],
            });
            await prisma.task.create({
                data: {
                    id: taskSubtaskId,
                    taskKey: `T251-S-${suffix}`,
                    title: "T251 completed subtask",
                    status: "DONE",
                    priority: "LOW",
                    workspaceId: workspaceAId,
                    parentTaskId: taskAId,
                    createdById: actorId,
                    isPrivate: false,
                },
            });

            auth.mockResolvedValue({ user: { id: actorId, role: "MEMBER" } });
            const response = await GET(new Request(
                `http://localhost/api/tasks/board?workspaceId=${workspaceAId}`,
            ));

            expect(response.status).toBe(200);
            const payload = await response.json() as BoardPayload;
            expect(payload.tasks.some((task) => task.id === taskAId)).toBe(true);
            expect(payload.tasks.some((task) => task.id === taskBId)).toBe(false);
            const visibleCard = payload.tasks.find((task) => task.id === taskAId);
            expect(visibleCard).toEqual(expect.objectContaining({
                status: "TODO",
                dueDate: "2026-09-20T00:00:00.000Z",
                subtaskCount: 1,
                completedSubtasks: 1,
            }));
            expect(visibleCard?.assignees).toEqual([]);
        } finally {
            await prisma.task.deleteMany({ where: { id: { in: [taskAId, taskBId, taskSubtaskId] } } });
            await prisma.workspaceMember.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
            await prisma.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
            await prisma.user.deleteMany({ where: { id: actorId } });
            await prisma.$disconnect();
            auth.mockReset();
        }
    });
});
