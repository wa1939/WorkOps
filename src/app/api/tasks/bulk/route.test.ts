import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../scripts/assert-local-database";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

import { POST } from "./route";

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Task bulk tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);
const db = new PrismaClient();

afterAll(async () => {
    await db.$disconnect();
});

function request(body: unknown): NextRequest {
    return new NextRequest("https://app.example/api/tasks/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe.runIf(databaseEnabled)("POST /api/tasks/bulk", () => {
    it("changes authorized tasks and reports an unauthorized task without rolling back the batch", async () => {
        const suffix = randomUUID();
        const viewerId = `bulk-viewer-${suffix}`;
        const ownerId = `bulk-owner-${suffix}`;
        const projectId = `bulk-project-${suffix}`;
        const allowedTaskId = `bulk-allowed-${suffix}`;
        const forbiddenTaskId = `bulk-forbidden-${suffix}`;
        const taskKeyPrefix = `BLK-${suffix}`;

        await db.user.createMany({
            data: [
                { id: viewerId, email: `${viewerId}@example.test`, name: "Bulk viewer", role: "MEMBER" },
                { id: ownerId, email: `${ownerId}@example.test`, name: "Task owner", role: "MEMBER" },
            ],
        });
        await db.project.create({ data: { id: projectId, name: "Bulk project", taskSeq: 2 } });
        await db.projectMember.create({ data: { projectId, userId: viewerId, accessLevel: "MEMBER" } });
        await db.task.createMany({
            data: [
                {
                    id: allowedTaskId,
                    taskKey: `${taskKeyPrefix}-0001`,
                    title: "Allowed task",
                    projectId,
                    createdById: viewerId,
                    status: "TODO",
                },
                {
                    id: forbiddenTaskId,
                    taskKey: `${taskKeyPrefix}-0002`,
                    title: "Forbidden task",
                    projectId,
                    createdById: ownerId,
                    status: "TODO",
                },
            ],
        });
        mocks.auth.mockResolvedValue({ user: { id: viewerId, role: "MEMBER", departmentIds: [] } });

        try {
            const response = await POST(request({
                action: "status",
                taskIds: [allowedTaskId, forbiddenTaskId],
                payload: { status: "DONE" },
            }));
            const body = await response.json();
            const rows = await db.task.findMany({
                where: { id: { in: [allowedTaskId, forbiddenTaskId] } },
                orderBy: { id: "asc" },
                select: { id: true, status: true },
            });

            expect(response.status).toBe(200);
            expect(body.results).toEqual({
                succeeded: [allowedTaskId],
                failed: [{ taskId: forbiddenTaskId, reason: "forbidden" }],
            });
            expect(rows.find((row) => row.id === allowedTaskId)?.status).toBe("DONE");
            expect(rows.find((row) => row.id === forbiddenTaskId)?.status).toBe("TODO");

            const duplicateResponse = await POST(request({
                action: "duplicate",
                taskIds: [allowedTaskId],
                payload: {},
            }));
            const duplicateBody = await duplicateResponse.json();
            const copy = await db.task.findFirst({
                where: { title: "Allowed task (copy)", projectId },
                select: { id: true, taskKey: true, title: true },
            });

            expect(duplicateResponse.status).toBe(200);
            expect(duplicateBody.results).toEqual({ succeeded: [allowedTaskId], failed: [] });
            expect(copy).toMatchObject({ title: "Allowed task (copy)" });
            expect(copy?.id).not.toBe(allowedTaskId);
            expect(copy?.taskKey).toMatch(/^BUL-\d{4}$/);
            expect(copy?.taskKey).not.toBe(`${taskKeyPrefix}-0002`);

            const exportResponse = await POST(request({
                action: "export",
                taskIds: [allowedTaskId],
                payload: {},
            }));
            const exportWorkbook = XLSX.read(Buffer.from(await exportResponse.arrayBuffer()), { type: "buffer" });
            const exportRows = XLSX.utils.sheet_to_json<unknown[]>(exportWorkbook.Sheets.Tasks, { header: 1 });
            expect(exportResponse.status).toBe(200);
            expect(exportResponse.headers.get("content-type")).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
            expect(exportResponse.headers.get("content-disposition")).toContain("tasks-export.xlsx");
            expect(exportRows[0]).toEqual(["title", "key", "status", "priority", "assignees", "due", "estimate", "project"]);
            expect(exportRows[1]?.[0]).toBe("Allowed task");
        } finally {
            await db.task.deleteMany({ where: { id: { in: [allowedTaskId, forbiddenTaskId] } } });
            await db.task.deleteMany({ where: { projectId } });
            await db.projectMember.deleteMany({ where: { projectId } });
            await db.project.delete({ where: { id: projectId } });
            await db.user.deleteMany({ where: { id: { in: [viewerId, ownerId] } } });
        }
    });

    it("archives without changing status and can unarchive the same task", async () => {
        const suffix = randomUUID();
        const viewerId = `bulk-archive-viewer-${suffix}`;
        const projectId = `bulk-archive-project-${suffix}`;
        const taskId = `bulk-archive-task-${suffix}`;

        await db.user.create({
            data: { id: viewerId, email: `${viewerId}@example.test`, name: "Archive viewer", role: "MEMBER" },
        });
        await db.project.create({ data: { id: projectId, name: "Archive project", taskSeq: 1 } });
        await db.projectMember.create({ data: { projectId, userId: viewerId, accessLevel: "MEMBER" } });
        await db.task.create({
            data: {
                id: taskId,
                taskKey: `ARC-${suffix}-0001`,
                title: "Archive me",
                projectId,
                createdById: viewerId,
                status: "DOING",
            },
        });
        mocks.auth.mockResolvedValue({ user: { id: viewerId, role: "MEMBER", departmentIds: [] } });

        try {
            const archiveResponse = await POST(request({
                action: "archive",
                taskIds: [taskId],
                payload: {},
            }));
            const archived = await db.task.findUnique({
                where: { id: taskId },
                select: { archived: true, status: true },
            });
            expect(archiveResponse.status).toBe(200);
            expect(archived).toEqual({ archived: true, status: "DOING" });

            const unarchiveResponse = await POST(request({
                action: "unarchive",
                taskIds: [taskId],
                payload: {},
            }));
            const unarchived = await db.task.findUnique({
                where: { id: taskId },
                select: { archived: true, status: true },
            });
            expect(unarchiveResponse.status).toBe(200);
            expect(unarchived).toEqual({ archived: false, status: "DOING" });
        } finally {
            await db.task.deleteMany({ where: { projectId } });
            await db.projectMember.deleteMany({ where: { projectId } });
            await db.project.delete({ where: { id: projectId } });
            await db.user.delete({ where: { id: viewerId } });
        }
    });

    it("duplicates subtasks recursively with fresh keys and preserved sibling order", async () => {
        const suffix = randomUUID();
        const viewerId = `bulk-duplicate-viewer-${suffix}`;
        const projectId = `bulk-duplicate-project-${suffix}`;
        const parentTaskId = `bulk-duplicate-parent-${suffix}`;
        const childTaskIds = [
            `bulk-duplicate-child-a-${suffix}`,
            `bulk-duplicate-child-b-${suffix}`,
        ];

        await db.user.create({
            data: { id: viewerId, email: `${viewerId}@example.test`, name: "Duplicate viewer", role: "MEMBER" },
        });
        await db.project.create({ data: { id: projectId, name: "Duplicate project", taskSeq: 3 } });
        await db.projectMember.create({ data: { projectId, userId: viewerId, accessLevel: "MEMBER" } });
        await db.task.create({
            data: {
                id: parentTaskId,
                taskKey: `DUP-${suffix}-0001`,
                title: "Duplicate parent",
                projectId,
                createdById: viewerId,
                status: "DOING",
            },
        });
        await db.task.createMany({
            data: [
                {
                    id: childTaskIds[0],
                    taskKey: `DUP-${suffix}-0002`,
                    title: "First child",
                    projectId,
                    parentTaskId,
                    siblingOrder: 10,
                    createdById: viewerId,
                    status: "TODO",
                },
                {
                    id: childTaskIds[1],
                    taskKey: `DUP-${suffix}-0003`,
                    title: "Second child",
                    projectId,
                    parentTaskId,
                    siblingOrder: 20,
                    createdById: viewerId,
                    status: "BLOCKED",
                },
            ],
        });
        mocks.auth.mockResolvedValue({ user: { id: viewerId, role: "MEMBER", departmentIds: [] } });

        try {
            const response = await POST(request({
                action: "duplicate",
                taskIds: [parentTaskId],
                payload: { includeSubtasks: true },
            }));
            const body = await response.json();
            const copy = await db.task.findFirst({
                where: { title: "Duplicate parent (copy)", projectId },
                select: { id: true, taskKey: true },
            });
            const copiedChildren = copy
                ? await db.task.findMany({
                    where: { parentTaskId: copy.id },
                    orderBy: { siblingOrder: "asc" },
                    select: { id: true, taskKey: true, title: true, siblingOrder: true, parentTaskId: true },
                })
                : [];

            expect(response.status).toBe(200);
            expect(body.results).toEqual({ succeeded: [parentTaskId], failed: [] });
            expect(copy?.id).not.toBe(parentTaskId);
            expect(copy?.taskKey).toMatch(/^DUP-\d{4}$/);
            expect(copiedChildren).toHaveLength(2);
            expect(copiedChildren.map((child) => child.siblingOrder)).toEqual([10, 20]);
            expect(copiedChildren.map((child) => child.parentTaskId)).toEqual([copy?.id, copy?.id]);
            expect(copiedChildren.map((child) => child.title)).toEqual(["First child (copy)", "Second child (copy)"]);
            expect(copiedChildren.every((child) => !childTaskIds.includes(child.id))).toBe(true);
            expect(copiedChildren.every((child) => /^DUP-\d{4}$/.test(child.taskKey ?? ""))).toBe(true);
            expect(copiedChildren.map((child) => child.taskKey)).not.toEqual([`DUP-${suffix}-0002`, `DUP-${suffix}-0003`]);
        } finally {
            await db.task.deleteMany({ where: { projectId } });
            await db.projectMember.deleteMany({ where: { projectId } });
            await db.project.delete({ where: { id: projectId } });
            await db.user.delete({ where: { id: viewerId } });
        }
    });
});
