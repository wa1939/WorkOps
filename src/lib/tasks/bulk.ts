import { Prisma, type Priority, type PrismaClient, type TaskStatus } from "@prisma/client";
import { z } from "zod";
import { authorize } from "@/lib/authz";
import type { AuthzUser } from "@/lib/authz/types";
import { prisma } from "@/lib/prisma";
import {
    buildTaskGridQuery,
    taskGridInclude,
    type TaskGridViewer,
} from "./grid-query";
import { nextTaskKey } from "./key";

const taskIdSchema = z.string().trim().min(1);
const taskIdsSchema = z.array(taskIdSchema).min(1).max(500);
const statusSchema = z.enum(["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"]);
const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const emptyPayloadSchema = z.object({}).strict();
const duplicatePayloadSchema = z.object({
    includeSubtasks: z.boolean().optional(),
    includeAttachments: z.boolean().optional(),
    includeAssignees: z.boolean().optional(),
}).strict();

export const bulkActionSchema = z.enum([
    "status",
    "priority",
    "assignee",
    "tagAdd",
    "tagRemove",
    "archive",
    "unarchive",
    "delete",
    "duplicate",
    "export",
]);

const bulkStatusSchema = z.object({
    action: z.literal("status"),
    taskIds: taskIdsSchema,
    payload: z.object({ status: statusSchema }).strict(),
}).strict();
const bulkPrioritySchema = z.object({
    action: z.literal("priority"),
    taskIds: taskIdsSchema,
    payload: z.object({ priority: prioritySchema }).strict(),
}).strict();
const bulkAssigneeSchema = z.object({
    action: z.literal("assignee"),
    taskIds: taskIdsSchema,
    payload: z.object({
        mode: z.enum(["set", "add", "remove"]),
        userId: taskIdSchema,
    }).strict(),
}).strict();
const bulkTagAddSchema = z.object({
    action: z.literal("tagAdd"),
    taskIds: taskIdsSchema,
    payload: z.object({ tagIds: z.array(taskIdSchema).min(1).max(500) }).strict(),
}).strict();
const bulkTagRemoveSchema = z.object({
    action: z.literal("tagRemove"),
    taskIds: taskIdsSchema,
    payload: z.object({ tagIds: z.array(taskIdSchema).min(1).max(500) }).strict(),
}).strict();

export const bulkInputSchema = z.discriminatedUnion("action", [
    bulkStatusSchema,
    bulkPrioritySchema,
    bulkAssigneeSchema,
    bulkTagAddSchema,
    bulkTagRemoveSchema,
    z.object({ action: z.literal("archive"), taskIds: taskIdsSchema, payload: emptyPayloadSchema }).strict(),
    z.object({ action: z.literal("unarchive"), taskIds: taskIdsSchema, payload: emptyPayloadSchema }).strict(),
    z.object({ action: z.literal("delete"), taskIds: taskIdsSchema, payload: emptyPayloadSchema }).strict(),
    z.object({ action: z.literal("duplicate"), taskIds: taskIdsSchema, payload: duplicatePayloadSchema }).strict(),
    z.object({ action: z.literal("export"), taskIds: taskIdsSchema, payload: emptyPayloadSchema }).strict(),
]);

export type BulkAction = z.infer<typeof bulkActionSchema>;
export type BulkInput = z.infer<typeof bulkInputSchema>;
export type BulkPayload = BulkInput["payload"];

export type BulkAssignment = {
    userId: string;
    user?: { id?: string; name?: string | null; email?: string | null } | null;
};

export type BulkTag = { tagId: string; tag?: { id?: string; name?: string | null } | null };
export type BulkAttachment = { type: string; filename: string | null; url: string };

/** Scalar and relation fields consumed by the pure planner and duplicate/export actions. */
export type BulkTask = {
    id: string;
    taskKey?: string | null;
    title: string;
    description?: string | null;
    status: TaskStatus;
    priority: Priority;
    type?: string;
    progressMode?: string;
    estimateMinutes?: number | null;
    manualProgress?: number | null;
    startAt?: Date | null;
    dueAt?: Date | null;
    dueAtEnd?: Date | null;
    projectId?: string | null;
    stageId?: string | null;
    caseStudyId?: string | null;
    kpiId?: string | null;
    workspaceId?: string | null;
    parentTaskId?: string | null;
    siblingOrder?: number;
    archived?: boolean;
    isPrivate?: boolean;
    isStarred?: boolean;
    effortHours?: number | null;
    actualHours?: number | null;
    remainingEffortHours?: number | null;
    assignments?: readonly BulkAssignment[];
    tags?: readonly BulkTag[];
    attachments?: readonly BulkAttachment[];
    project?: { id: string; name: string } | null;
};

export type BulkExportRow = {
    title: string;
    key: string | null;
    status: TaskStatus;
    priority: Priority;
    assignees: string;
    due: string | null;
    estimate: number | null;
    project: string | null;
};

type DuplicateOptions = {
    includeSubtasks: boolean;
    includeAttachments: boolean;
    includeAssignees: boolean;
};

export type BulkOperation =
    | { taskId: string; action: "status"; data: { status: TaskStatus } }
    | { taskId: string; action: "priority"; data: { priority: Priority } }
    | { taskId: string; action: "assignee"; mode: "set" | "add" | "remove"; userId: string }
    | { taskId: string; action: "tagAdd" | "tagRemove"; tagIds: string[] }
    | { taskId: string; action: "archive" | "unarchive"; data: { archived: boolean } }
    | { taskId: string; action: "delete" }
    | { taskId: string; action: "duplicate"; options: DuplicateOptions }
    | { taskId: string; action: "export"; row: BulkExportRow };

function asIsoDate(value: Date | null | undefined): string | null {
    return value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : null;
}

function exportRow(task: BulkTask): BulkExportRow {
    return {
        title: task.title,
        key: task.taskKey ?? null,
        status: task.status,
        priority: task.priority,
        assignees: (task.assignments ?? [])
            .map((assignment) => assignment.user?.name ?? assignment.user?.email ?? assignment.userId)
            .join(", "),
        due: asIsoDate(task.dueAt),
        estimate: task.estimateMinutes ?? null,
        project: task.project?.name ?? null,
    };
}

/**
 * Build one deterministic operation per selected task. This function performs
 * no I/O, which keeps the action semantics independently testable.
 */
export function bulkPlan(
    action: BulkAction,
    tasks: readonly BulkTask[],
    payload: BulkPayload,
): BulkOperation[] {
    switch (action) {
        case "status":
            return tasks.map((task) => ({ taskId: task.id, action, data: { status: (payload as { status: TaskStatus }).status } }));
        case "priority":
            return tasks.map((task) => ({ taskId: task.id, action, data: { priority: (payload as { priority: Priority }).priority } }));
        case "assignee": {
            const assignee = payload as { mode: "set" | "add" | "remove"; userId: string };
            return tasks.map((task) => ({ taskId: task.id, action, mode: assignee.mode, userId: assignee.userId }));
        }
        case "tagAdd":
        case "tagRemove": {
            const tagIds = (payload as { tagIds: string[] }).tagIds;
            return tasks.map((task) => ({ taskId: task.id, action, tagIds: [...tagIds] }));
        }
        case "archive":
        case "unarchive":
            return tasks.map((task) => ({
                taskId: task.id,
                action,
                data: { archived: action === "archive" },
            }));
        case "delete":
            return tasks.map((task) => ({ taskId: task.id, action }));
        case "duplicate": {
            const duplicate = payload as {
                includeSubtasks?: boolean;
                includeAttachments?: boolean;
                includeAssignees?: boolean;
            };
            const options = {
                includeSubtasks: duplicate.includeSubtasks === true,
                includeAttachments: duplicate.includeAttachments === true,
                includeAssignees: duplicate.includeAssignees === true,
            };
            return tasks.map((task) => ({ taskId: task.id, action, options }));
        }
        case "export":
            return tasks.map((task) => ({ taskId: task.id, action, row: exportRow(task) }));
    }
}

export const bulkTaskInclude = {
    ...taskGridInclude,
    attachments: {
        select: { type: true, filename: true, url: true },
    },
} satisfies Prisma.TaskInclude;

export type BulkViewer = TaskGridViewer & Pick<AuthzUser, "id" | "role">;
export type BulkDatabase = PrismaClient;
export type BulkFailure = { taskId: string; reason: "forbidden" | "failed" };
export type BulkResults = { succeeded: string[]; failed: BulkFailure[] };
export type BulkExecution = { results: BulkResults; exportRows?: BulkExportRow[] };

const CHUNK_SIZE = 100;

function uniqueIds(ids: readonly string[]): string[] {
    return Array.from(new Set(ids));
}

function authzAction(action: BulkAction): "task:view" | "task:edit" | "task:delete" {
    if (action === "export") return "task:view";
    if (action === "delete") return "task:delete";
    return "task:edit";
}

function chunks<T>(items: readonly T[], size = CHUNK_SIZE): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
    return result;
}

async function loadScopedTasks(
    db: BulkDatabase,
    taskIds: readonly string[],
    viewer: BulkViewer,
): Promise<BulkTask[]> {
    const gridQuery = buildTaskGridQuery({
        filters: {
            status: [],
            priority: [],
            assigneeIds: [],
            tagIds: [],
            includeArchived: true,
        },
        groupBy: "none",
        sortBy: "updatedAt",
        dir: "desc",
    }, viewer);
    return db.task.findMany({
        where: { AND: [gridQuery.where, { id: { in: [...taskIds] } }] },
        include: bulkTaskInclude,
    }) as unknown as Promise<BulkTask[]>;
}

function statusUpdate(status: TaskStatus): Record<string, unknown> {
    return { status, doneAt: status === "DONE" ? new Date() : null };
}

const MAX_SUBTASK_DEPTH = 3;

async function loadScopedSubtasks(
    db: BulkDatabase,
    parentTaskId: string,
    viewer: BulkViewer,
): Promise<BulkTask[]> {
    const gridQuery = buildTaskGridQuery({
        filters: {
            status: [],
            priority: [],
            assigneeIds: [],
            tagIds: [],
            includeArchived: true,
        },
        groupBy: "none",
        sortBy: "updatedAt",
        dir: "desc",
    }, viewer);
    return db.task.findMany({
        where: { AND: [gridQuery.where, { parentTaskId }] },
        orderBy: [{ siblingOrder: "asc" }, { id: "asc" }],
        include: bulkTaskInclude,
    }) as unknown as Promise<BulkTask[]>;
}

async function copyTaskTree(
    tx: any,
    source: BulkTask,
    options: DuplicateOptions,
    viewer: BulkViewer,
    parentTaskId: string | null,
    depth: number,
): Promise<string> {
    const taskKey = source.projectId ? await nextTaskKey(source.projectId, tx) : null;
    const copy = await tx.task.create({
        data: {
            taskKey,
            title: `${source.title} (copy)`,
            description: source.description ?? null,
            ...(source.type ? { type: source.type } : {}),
            status: source.status,
            priority: source.priority,
            ...(source.progressMode ? { progressMode: source.progressMode } : {}),
            estimateMinutes: source.estimateMinutes ?? null,
            manualProgress: source.manualProgress ?? null,
            startAt: source.startAt ?? null,
            dueAt: source.dueAt ?? null,
            dueAtEnd: source.dueAtEnd ?? null,
            projectId: source.projectId ?? null,
            stageId: source.stageId ?? null,
            caseStudyId: source.caseStudyId ?? null,
            kpiId: source.kpiId ?? null,
            workspaceId: source.workspaceId ?? null,
            parentTaskId,
            siblingOrder: source.siblingOrder ?? 0,
            archived: false,
            createdById: viewer.id,
            isPrivate: source.isPrivate ?? false,
            isStarred: source.isStarred ?? false,
            effortHours: source.effortHours ?? null,
            actualHours: source.actualHours ?? null,
            remainingEffortHours: source.remainingEffortHours ?? null,
        },
        select: { id: true },
    });

    if (source.tags?.length && tx.taskTag?.createMany) {
        await tx.taskTag.createMany({
            data: source.tags.map((tag) => ({ taskId: copy.id, tagId: tag.tagId })),
            skipDuplicates: true,
        });
    }
    if (options.includeAssignees && source.assignments?.length && tx.taskAssignment?.createMany) {
        await tx.taskAssignment.createMany({
            data: source.assignments.map((assignment) => ({ taskId: copy.id, userId: assignment.userId })),
            skipDuplicates: true,
        });
    }
    if (options.includeAttachments && source.attachments?.length && tx.attachment?.createMany) {
        await tx.attachment.createMany({
            data: source.attachments.map((attachment) => ({
                taskId: copy.id,
                type: attachment.type,
                filename: attachment.filename,
                url: attachment.url,
            })),
        });
    }

    if (options.includeSubtasks && depth < MAX_SUBTASK_DEPTH) {
        const subtasks = await loadScopedSubtasks(tx, source.id, viewer);
        for (const subtask of subtasks) {
            await copyTaskTree(tx, subtask, options, viewer, copy.id, depth + 1);
        }
    }

    return copy.id;
}

async function executeDuplicate(
    tx: any,
    source: BulkTask,
    options: DuplicateOptions,
    viewer: BulkViewer,
): Promise<string> {
    return copyTaskTree(tx, source, options, viewer, null, 0);
}

async function applyOperations(
    tx: any,
    operations: readonly BulkOperation[],
    taskById: ReadonlyMap<string, BulkTask>,
    viewer: BulkViewer,
): Promise<void> {
    for (const operationChunk of chunks(operations)) {
        const ids = operationChunk.map((operation) => operation.taskId);
        const action = operationChunk[0]?.action;
        if (!action) continue;

        if (action === "status") {
            const status = (operationChunk[0] as Extract<BulkOperation, { action: "status" }>).data.status;
            await tx.task.updateMany({ where: { id: { in: ids } }, data: statusUpdate(status) });
            continue;
        }
        if (action === "priority") {
            const priority = (operationChunk[0] as Extract<BulkOperation, { action: "priority" }>).data.priority;
            await tx.task.updateMany({ where: { id: { in: ids } }, data: { priority } });
            continue;
        }
        if (action === "archive" || action === "unarchive") {
            const archived = (operationChunk[0] as Extract<BulkOperation, { action: "archive" | "unarchive" }>).data.archived;
            await tx.task.updateMany({
                where: { id: { in: ids } },
                data: { archived },
            });
            continue;
        }
        if (action === "delete") {
            await tx.task.deleteMany({ where: { id: { in: ids } } });
            continue;
        }
        if (action === "assignee") {
            const first = operationChunk[0] as Extract<BulkOperation, { action: "assignee" }>;
            if (first.mode === "set") {
                await tx.taskAssignment.deleteMany({ where: { taskId: { in: ids } } });
                await tx.taskAssignment.createMany({
                    data: ids.map((taskId) => ({ taskId, userId: first.userId })),
                    skipDuplicates: true,
                });
            } else if (first.mode === "add") {
                await tx.taskAssignment.createMany({
                    data: ids.map((taskId) => ({ taskId, userId: first.userId })),
                    skipDuplicates: true,
                });
            } else {
                await tx.taskAssignment.deleteMany({ where: { taskId: { in: ids }, userId: first.userId } });
            }
            continue;
        }
        if (action === "tagAdd" || action === "tagRemove") {
            const tagIds = (operationChunk[0] as Extract<BulkOperation, { action: "tagAdd" | "tagRemove" }>).tagIds;
            if (action === "tagAdd") {
                await tx.taskTag.createMany({
                    data: ids.flatMap((taskId) => tagIds.map((tagId) => ({ taskId, tagId }))),
                    skipDuplicates: true,
                });
            } else {
                await tx.taskTag.deleteMany({ where: { taskId: { in: ids }, tagId: { in: tagIds } } });
            }
            continue;
        }
        if (action === "duplicate") {
            for (const operation of operationChunk as Array<Extract<BulkOperation, { action: "duplicate" }>>) {
                const source = taskById.get(operation.taskId);
                if (source) await executeDuplicate(tx, source, operation.options, viewer);
            }
        }
    }
}

/** Execute one validated bulk request after per-task scope and authz checks. */
export async function executeBulk(
    input: BulkInput,
    viewer: BulkViewer,
    db: BulkDatabase = prisma,
): Promise<BulkExecution> {
    const taskIds = uniqueIds(input.taskIds);
    const tasks = await loadScopedTasks(db, taskIds, viewer);
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const failed: BulkFailure[] = [];
    const authorizedTasks: BulkTask[] = [];
    const requiredAction = authzAction(input.action);

    for (const taskId of taskIds) {
        const task = taskById.get(taskId);
        if (!task) {
            failed.push({ taskId, reason: "forbidden" });
            continue;
        }
        let allowed = false;
        try {
            allowed = await authorize(viewer, requiredAction, { type: "task", id: taskId });
        } catch {
            allowed = false;
        }
        if (!allowed) {
            failed.push({ taskId, reason: "forbidden" });
            continue;
        }
        authorizedTasks.push(task);
    }

    const operations = bulkPlan(input.action, authorizedTasks, input.payload);
    if (input.action === "export") {
        return {
            results: { succeeded: authorizedTasks.map((task) => task.id), failed },
            exportRows: operations.flatMap((operation) => operation.action === "export" ? [operation.row] : []),
        };
    }

    if (operations.length > 0) {
        await db.$transaction((tx) => applyOperations(tx, operations, taskById, viewer));
    }

    return {
        results: {
            succeeded: authorizedTasks.map((task) => task.id),
            failed,
        },
    };
}
