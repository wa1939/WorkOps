import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { assertLocalDatabaseUrl } from "../../../../../scripts/assert-local-database";

const rawDatabaseUrl = process.env.DATABASE_URL;
const parsedDatabaseUrl = rawDatabaseUrl === undefined ? null : assertLocalDatabaseUrl(rawDatabaseUrl);
if (parsedDatabaseUrl && !parsedDatabaseUrl.pathname.endsWith("_test")) {
    throw new Error("view-data PostgreSQL acceptance requires a database name ending with _test");
}

const databaseEnabled = parsedDatabaseUrl !== null;
const db = databaseEnabled ? new PrismaClient() : undefined;

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth }));

import { prisma as routePrisma } from "@/lib/prisma";
import { GET } from "./route";

type ViewDataRow = {
    id: string;
    dueAt: string | null;
    dueDate: string | null;
    priority: string;
};

type ViewDataPayload = {
    rows: ViewDataRow[];
    totalCount: number;
    nextOffset: number | null;
};

function request(params: Record<string, string>): Request {
    const query = new URLSearchParams(params);
    return new Request(`http://localhost/api/tasks/view-data?${query.toString()}`);
}

const suite = describe.runIf(databaseEnabled);

suite("GET /api/tasks/view-data PostgreSQL acceptance", () => {
    beforeAll(() => {
        auth.mockResolvedValue({ user: { id: "placeholder", role: "MEMBER", departmentIds: [] } });
    });

    afterAll(async () => {
        auth.mockReset();
        await db?.$disconnect();
        await routePrisma.$disconnect();
    });

    it("returns exact-count pages and preserves real PostgreSQL sort/filter/privacy boundaries", async () => {
        if (!db) throw new Error("database fixture was not initialized");

        const suffix = randomUUID();
        const actorId = `t1-vd-actor-${suffix}`;
        const outsiderId = `t1-vd-outsider-${suffix}`;
        const workspaceAId = `t1-vd-workspace-a-${suffix}`;
        const workspaceBId = `t1-vd-workspace-b-${suffix}`;
        const projectAId = `t1-vd-project-a-${suffix}`;
        const projectBId = `t1-vd-project-b-${suffix}`;
        const projectCId = `t1-vd-project-c-${suffix}`;
        const mainTaskIds = Array.from({ length: 101 }, (_, index) => (
            `t1-vd-page-${suffix}-${String(index).padStart(3, "0")}`
        ));
        const nullSortTaskIds = [
            `t1-vd-null-sort-${suffix}-a`,
            `t1-vd-null-sort-${suffix}-b`,
            `t1-vd-null-sort-${suffix}-c`,
            `t1-vd-null-sort-${suffix}-d`,
        ];
        const privateTaskId = `t1-vd-private-${suffix}`;
        const projectBTaskId = `t1-vd-project-b-task-${suffix}`;
        const workspaceBTaskId = `t1-vd-workspace-b-task-${suffix}`;
        const taskIds = [...mainTaskIds, ...nullSortTaskIds, privateTaskId, projectBTaskId, workspaceBTaskId];

        try {
            await db.workspace.createMany({
                data: [
                    { id: workspaceAId, slug: `t1-vd-a-${suffix}`, name: "T1 View Data A", timezone: "Asia/Riyadh" },
                    { id: workspaceBId, slug: `t1-vd-b-${suffix}`, name: "T1 View Data B", timezone: "Asia/Riyadh" },
                ],
            });
            await db.user.createMany({
                data: [
                    { id: actorId, email: `${actorId}@example.test`, name: "T1 View Data Actor", role: "MEMBER" },
                    { id: outsiderId, email: `${outsiderId}@example.test`, name: "T1 View Data Outsider", role: "MEMBER" },
                ],
            });
            await db.workspaceMember.createMany({
                data: [
                    { workspaceId: workspaceAId, userId: actorId, role: "MEMBER" },
                    { workspaceId: workspaceBId, userId: outsiderId, role: "MEMBER" },
                ],
            });
            await db.project.createMany({
                data: [
                    { id: projectAId, name: `T1 View Data Project A ${suffix}`, workspaceId: workspaceAId, ownerId: actorId },
                    { id: projectBId, name: `T1 View Data Project B ${suffix}`, workspaceId: workspaceAId, ownerId: outsiderId },
                    { id: projectCId, name: `T1 View Data Project C ${suffix}`, workspaceId: workspaceBId, ownerId: actorId },
                ],
            });

            const mainTasks: Prisma.TaskCreateManyInput[] = mainTaskIds.map((id, index) => ({
                id,
                taskKey: id,
                title: `page-${suffix}-${String(index).padStart(3, "0")}`,
                status: "TODO",
                priority: "HIGH",
                projectId: projectAId,
                workspaceId: workspaceAId,
                createdById: actorId,
                isPrivate: false,
                archived: false,
            }));
            const nullSortTasks: Prisma.TaskCreateManyInput[] = [
                {
                    id: nullSortTaskIds[0],
                    taskKey: nullSortTaskIds[0],
                    title: `null-sort-${suffix}-dated-a`,
                    status: "TODO",
                    priority: "MEDIUM",
                    dueAt: new Date("2026-10-10T00:00:00.000Z"),
                    projectId: projectAId,
                    workspaceId: workspaceAId,
                    createdById: actorId,
                    isPrivate: false,
                },
                {
                    id: nullSortTaskIds[1],
                    taskKey: nullSortTaskIds[1],
                    title: `null-sort-${suffix}-dated-b`,
                    status: "TODO",
                    priority: "MEDIUM",
                    dueAt: new Date("2026-10-10T00:00:00.000Z"),
                    projectId: projectAId,
                    workspaceId: workspaceAId,
                    createdById: actorId,
                    isPrivate: false,
                },
                {
                    id: nullSortTaskIds[2],
                    taskKey: nullSortTaskIds[2],
                    title: `null-sort-${suffix}-null-a`,
                    status: "TODO",
                    priority: "MEDIUM",
                    dueAt: null,
                    projectId: projectAId,
                    workspaceId: workspaceAId,
                    createdById: actorId,
                    isPrivate: false,
                },
                {
                    id: nullSortTaskIds[3],
                    taskKey: nullSortTaskIds[3],
                    title: `null-sort-${suffix}-null-b`,
                    status: "TODO",
                    priority: "MEDIUM",
                    dueAt: null,
                    projectId: projectAId,
                    workspaceId: workspaceAId,
                    createdById: actorId,
                    isPrivate: false,
                },
            ];
            await db.task.createMany({
                data: [
                    ...mainTasks,
                    ...nullSortTasks,
                    {
                        id: privateTaskId,
                        taskKey: privateTaskId,
                        title: `private-${suffix}`,
                        status: "TODO",
                        priority: "HIGH",
                        projectId: projectAId,
                        workspaceId: workspaceAId,
                        createdById: outsiderId,
                        isPrivate: true,
                    },
                    {
                        id: projectBTaskId,
                        taskKey: projectBTaskId,
                        title: `project-b-${suffix}`,
                        status: "TODO",
                        priority: "HIGH",
                        projectId: projectBId,
                        workspaceId: workspaceAId,
                        createdById: outsiderId,
                        isPrivate: false,
                    },
                    {
                        id: workspaceBTaskId,
                        taskKey: workspaceBTaskId,
                        title: `workspace-b-${suffix}`,
                        status: "TODO",
                        priority: "HIGH",
                        projectId: projectCId,
                        workspaceId: workspaceBId,
                        createdById: actorId,
                        isPrivate: false,
                    },
                ],
            });
            await db.taskAssignment.createMany({
                data: mainTaskIds.slice(0, 2).map((taskId) => ({ taskId, userId: actorId })),
            });

            auth.mockResolvedValue({ user: { id: actorId, role: "MEMBER", departmentIds: [] } });
            const fetchViewData = async (params: Record<string, string>): Promise<ViewDataPayload> => {
                const response = await GET(request(params));
                expect(response.status).toBe(200);
                return await response.json() as ViewDataPayload;
            };

            const base = {
                workspaceId: workspaceAId,
                projectId: projectAId,
                search: `page-${suffix}`,
                sortBy: "priority",
                dir: "asc",
            };
            const firstPage = await fetchViewData({ ...base, offset: "0" });
            const secondPage = await fetchViewData({ ...base, offset: "50" });
            const remainderPage = await fetchViewData({ ...base, offset: "100" });
            expect(firstPage.totalCount).toBe(101);
            expect(secondPage.totalCount).toBe(101);
            expect(remainderPage.totalCount).toBe(101);
            expect(firstPage.rows).toHaveLength(50);
            expect(secondPage.rows).toHaveLength(50);
            expect(remainderPage.rows).toHaveLength(1);
            expect(firstPage.nextOffset).toBe(50);
            expect(secondPage.nextOffset).toBe(100);
            expect(remainderPage.nextOffset).toBeNull();
            const pageIds = [...firstPage.rows, ...secondPage.rows, ...remainderPage.rows].map((row) => row.id);
            expect(pageIds).toEqual(mainTaskIds);
            expect(new Set(pageIds).size).toBe(101);

            const descending = await fetchViewData({ ...base, dir: "desc", offset: "0" });
            expect(descending.rows.map((row) => row.id)).toEqual([...mainTaskIds].reverse().slice(0, 50));
            expect(descending.totalCount).toBe(101);

            const mine = await fetchViewData({ ...base, assigneeIds: "@me", offset: "0" });
            expect(mine.totalCount).toBe(2);
            expect(mine.rows.map((row) => row.id)).toEqual(mainTaskIds.slice(0, 2));

            const dueAsc = await fetchViewData({
                workspaceId: workspaceAId,
                projectId: projectAId,
                search: `null-sort-${suffix}`,
                sortBy: "dueDate",
                dir: "asc",
                offset: "0",
            });
            expect(dueAsc.rows.map((row) => row.id)).toEqual([
                nullSortTaskIds[0],
                nullSortTaskIds[1],
                nullSortTaskIds[2],
                nullSortTaskIds[3],
            ]);
            expect(dueAsc.rows.slice(0, 2).map((row) => row.dueDate)).toEqual([
                "2026-10-10T00:00:00.000Z",
                "2026-10-10T00:00:00.000Z",
            ]);
            expect(dueAsc.rows.slice(2).map((row) => row.dueDate)).toEqual([null, null]);

            const dueDesc = await fetchViewData({
                workspaceId: workspaceAId,
                projectId: projectAId,
                search: `null-sort-${suffix}`,
                sortBy: "dueDate",
                dir: "desc",
                offset: "0",
            });
            expect(dueDesc.rows.map((row) => row.id)).toEqual([
                nullSortTaskIds[3],
                nullSortTaskIds[2],
                nullSortTaskIds[1],
                nullSortTaskIds[0],
            ]);

            const projectHidden = await fetchViewData({
                projectIds: projectBId,
                search: `project-b-${suffix}`,
                offset: "0",
            });
            expect(projectHidden.totalCount).toBe(0);
            expect(projectHidden.rows).toHaveLength(0);

            const conflictingProjects = await fetchViewData({
                projectId: projectAId,
                projectIds: projectBId,
                search: `page-${suffix}`,
                offset: "0",
            });
            expect(conflictingProjects.totalCount).toBe(0);
            expect(conflictingProjects.rows).toHaveLength(0);

            const privateTask = await fetchViewData({ search: `private-${suffix}`, offset: "0" });
            expect(privateTask.totalCount).toBe(0);
            expect(privateTask.rows).toHaveLength(0);

            const wrongWorkspace = await fetchViewData({ workspaceId: workspaceAId, search: `workspace-b-${suffix}`, offset: "0" });
            expect(wrongWorkspace.totalCount).toBe(0);
            const correctWorkspace = await fetchViewData({ workspaceId: workspaceBId, search: `workspace-b-${suffix}`, offset: "0" });
            expect(correctWorkspace.totalCount).toBe(1);
            expect(correctWorkspace.rows.map((row) => row.id)).toEqual([workspaceBTaskId]);
        } finally {
            await db.task.deleteMany({ where: { id: { in: taskIds } } });
            await db.project.deleteMany({ where: { id: { in: [projectAId, projectBId, projectCId] } } });
            await db.workspaceMember.deleteMany({ where: { workspaceId: { in: [workspaceAId, workspaceBId] } } });
            await db.workspace.deleteMany({ where: { id: { in: [workspaceAId, workspaceBId] } } });
            await db.user.deleteMany({ where: { id: { in: [actorId, outsiderId] } } });
            expect(await db.task.count({ where: { id: { in: taskIds } } })).toBe(0);
            expect(await db.project.count({ where: { id: { in: [projectAId, projectBId, projectCId] } } })).toBe(0);
            expect(await db.workspace.count({ where: { id: { in: [workspaceAId, workspaceBId] } } })).toBe(0);
            expect(await db.user.count({ where: { id: { in: [actorId, outsiderId] } } })).toBe(0);
        }
    });
});
