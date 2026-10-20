import { Prisma } from "@prisma/client";
import type { Priority, TaskStatus } from "@prisma/client";
import { z } from "zod";
import { projectVisibilityWhere } from "@/lib/executive-summary";
import { taskScopeForActor, type TaskActor } from "@/lib/tasks/authorization";
import { composeScopes } from "@/lib/workspaces/scope";

const ISO_DATE_TIME = z.string().datetime({ offset: true });

export const taskGridStatusSchema = z.enum([
    "TODO",
    "DOING",
    "BLOCKED",
    "WAITING",
    "DONE",
    "CANCELED",
]);
export const taskGridPrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const taskGridGroupBySchema = z.enum(["status", "priority", "assignee", "none"]);
export const taskGridSortBySchema = z.enum([
    "taskKey",
    "title",
    "status",
    "priority",
    "dueDate",
    "updatedAt",
    "createdAt",
]);
export const taskGridDirectionSchema = z.enum(["asc", "desc"]);
export const taskGridCursorSchema = z.object({
    updatedAt: ISO_DATE_TIME,
    id: z.string().trim().min(1),
}).strict();

export const taskGridFiltersSchema = z.object({
    scope: z.enum(["all", "assigned", "related", "created", "unassigned"]).optional(),
    status: z.array(taskGridStatusSchema).default([]),
    statusNotIn: z.array(taskGridStatusSchema).max(6).optional(),
    priority: z.array(taskGridPrioritySchema).default([]),
    assigneeIds: z.array(z.string().trim().min(1)).default([]),
    tagIds: z.array(z.string().trim().min(1)).default([]),
    projectId: z.string().trim().min(1).optional(),
    projectIds: z.array(z.string().trim().min(1)).max(100).optional(),
    workspaceId: z.string().trim().min(1).optional(),
    search: z.string().trim().min(1).max(200).optional(),
    includeArchived: z.boolean().default(false),
    dueBefore: ISO_DATE_TIME.optional(),
    dueAfter: ISO_DATE_TIME.optional(),
}).strict();

export const taskGridInputSchema = z.object({
    filters: taskGridFiltersSchema.default({}),
    groupBy: taskGridGroupBySchema.default("none"),
    sortBy: taskGridSortBySchema.default("updatedAt"),
    dir: taskGridDirectionSchema.default("desc"),
    cursor: taskGridCursorSchema.optional(),
}).strict();

export type TaskGridInput = z.infer<typeof taskGridInputSchema>;
export type TaskGridGroupBy = z.infer<typeof taskGridGroupBySchema>;
export type TaskGridSortBy = z.infer<typeof taskGridSortBySchema>;
export type TaskGridDirection = z.infer<typeof taskGridDirectionSchema>;
export type TaskGridCursor = z.infer<typeof taskGridCursorSchema>;

/** The session data needed by the grid's existing task/project visibility scopes. */
export type TaskGridViewer = {
    id: string;
    role?: string | null;
    departmentIds?: readonly string[];
};

export type TaskGridAssignment = {
    userId: string;
    user?: {
        id?: string;
        name?: string | null;
        image?: string | null;
    } | null;
};

/** The smallest row contract required by the pure group derivation. */
export type TaskGridRow = {
    id: string;
    taskKey: string | null;
    title: string;
    status: TaskStatus;
    priority: Priority;
    dueAt: Date | null;
    dueDate?: Date | null;
    estimateMinutes: number | null;
    manualProgress?: number | null;
    isDone?: boolean;
    updatedAt: Date;
    createdAt: Date;
    assignments: readonly TaskGridAssignment[];
};

export type TaskGridGroup = {
    key: string;
    label: string;
    count: number;
    doneCount: number;
    overdueCount: number;
    estimateMinutes: number;
    assigneeAvatars: string[];
};

const SORT_FIELD: Record<TaskGridSortBy, keyof Prisma.TaskOrderByWithRelationInput> = {
    taskKey: "taskKey",
    title: "title",
    status: "status",
    priority: "priority",
    dueDate: "dueAt",
    updatedAt: "updatedAt",
    createdAt: "createdAt",
};

const EMPTY_RESULT_ID = "__task_grid_unauthorized__";

function normalizeViewer(viewer: TaskGridViewer): TaskActor | null {
    if (!viewer.id) return null;
    switch (viewer.role) {
        case "ADMIN":
            return { id: viewer.id, role: "ADMIN" };
        case "VIEWER":
            return { id: viewer.id, role: "VIEWER" };
        case "LEAD":
        case "MANAGER":
            return { id: viewer.id, role: "LEAD" };
        case "MEMBER":
        case undefined:
        case null:
            return { id: viewer.id, role: "MEMBER" };
        default:
            return null;
    }
}

function cursorWhere(cursor: TaskGridCursor, dir: TaskGridDirection): Prisma.TaskWhereInput {
    const updatedAt = new Date(cursor.updatedAt);
    const operator = dir === "asc" ? "gt" : "lt";
    const updatedAtFilter = { [operator]: updatedAt } as Prisma.DateTimeFilter;
    const idFilter = { [operator]: cursor.id } as Prisma.StringFilter;

    return {
        OR: [
            { updatedAt: updatedAtFilter },
            { updatedAt, id: idFilter },
        ],
    };
}

/**
 * Build the server-side task query. Visibility is part of the where clause so
 * callers cannot accidentally fetch first and authorize afterwards.
 */
export function buildTaskGridQuery(
    rawInput: TaskGridInput,
    viewer: TaskGridViewer,
): {
    where: Prisma.TaskWhereInput;
    orderBy: Prisma.TaskOrderByWithRelationInput[];
    include: Prisma.TaskInclude;
    cursor?: Prisma.TaskWhereUniqueInput;
    skip?: number;
} {
    const input = taskGridInputSchema.parse(rawInput);
    const { filters } = input;
    const actor = normalizeViewer(viewer);
    const conditions: Prisma.TaskWhereInput[] = [];

    if (!actor) {
        return {
            where: { id: EMPTY_RESULT_ID },
            orderBy: [{ [SORT_FIELD[input.sortBy]]: input.dir }, { id: input.dir }],
            include: taskGridInclude,
        };
    }

    conditions.push(taskScopeForActor(actor, filters.workspaceId) as Prisma.TaskWhereInput);

    // Project visibility is the companion scope to task privacy visibility.
    // Floating tasks remain visible, while project-backed rows use the existing
    // project policy rather than a second, divergent authorization rule.
    const projectScope = projectVisibilityWhere({
        id: actor.id,
        role: actor.role,
        departmentIds: [...(viewer.departmentIds ?? [])],
    }) as Prisma.ProjectWhereInput;
    if (actor.role !== "ADMIN") {
        conditions.push({
            OR: [
                { projectId: null },
                { project: projectScope },
            ],
        });
    }

    if (filters.status.length > 0) {
        conditions.push({ status: { in: filters.status as TaskStatus[] } });
    }
    if ((filters.statusNotIn ?? []).length > 0) {
        conditions.push({ status: { notIn: (filters.statusNotIn ?? []) as TaskStatus[] } });
    }
    if (filters.priority.length > 0) {
        conditions.push({ priority: { in: filters.priority as Priority[] } });
    }
    if (filters.assigneeIds.length > 0) {
        conditions.push({ assignments: { some: { userId: { in: filters.assigneeIds } } } });
    }
    if (filters.scope === "assigned") {
        conditions.push({ assignments: { some: { userId: actor.id } } });
    } else if (filters.scope === "related") {
        conditions.push({ OR: [{ assignments: { some: { userId: actor.id } } }, { createdById: actor.id }] });
    } else if (filters.scope === "created") {
        conditions.push({ createdById: actor.id });
    } else if (filters.scope === "unassigned") {
        conditions.push({ assignments: { none: {} } });
    }
    if (filters.tagIds.length > 0) {
        conditions.push({ tags: { some: { tagId: { in: filters.tagIds } } } });
    }
    if (filters.projectId) {
        conditions.push({ projectId: filters.projectId });
    }
    if ((filters.projectIds ?? []).length > 0) {
        conditions.push({ projectId: { in: filters.projectIds ?? [] } });
    }
    if (filters.search) {
        conditions.push({
            OR: [
                { title: { contains: filters.search, mode: "insensitive" } },
                { description: { contains: filters.search, mode: "insensitive" } },
                { taskKey: { contains: filters.search, mode: "insensitive" } },
            ],
        });
    }
    if (filters.dueBefore || filters.dueAfter) {
        conditions.push({
            dueAt: {
                ...(filters.dueBefore ? { lte: new Date(filters.dueBefore) } : {}),
                ...(filters.dueAfter ? { gte: new Date(filters.dueAfter) } : {}),
            },
        });
    }
    if (!filters.includeArchived) {
        conditions.push({ archived: false });
    }
    if (input.cursor && input.sortBy === "updatedAt") {
        conditions.push(cursorWhere(input.cursor, input.dir));
    }

    return {
        where: composeScopes(...conditions) as Prisma.TaskWhereInput,
        ...(input.cursor && input.sortBy !== "updatedAt" ? { cursor: { id: input.cursor.id }, skip: 1 } : {}),
        orderBy: [
            { [SORT_FIELD[input.sortBy]]: input.dir },
            { id: input.dir },
        ],
        include: taskGridInclude,
    };
}

export const taskGridInclude = {
    project: {
        select: {
            id: true,
            name: true,
            workspaceId: true,
        },
    },
    workspace: {
        select: {
            id: true,
            slug: true,
            name: true,
            archivedAt: true,
        },
    },
    assignments: {
        select: {
            userId: true,
            user: {
                select: {
                    id: true,
                    name: true,
                    image: true,
                },
            },
        },
    },
    tags: {
        select: {
            tagId: true,
            tag: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    },
} satisfies Prisma.TaskInclude;

function rowDueAt(row: TaskGridRow): Date | null {
    return row.dueAt ?? row.dueDate ?? null;
}

function rowIsDone(row: TaskGridRow): boolean {
    return row.isDone ?? row.status === "DONE";
}

function assignmentAvatar(assignment: TaskGridAssignment): string | null {
    return assignment.user?.image ?? null;
}

function addAvatarSample(group: TaskGridGroup, assignments: readonly TaskGridAssignment[]): void {
    for (const assignment of assignments) {
        const avatar = assignmentAvatar(assignment);
        if (avatar && !group.assigneeAvatars.includes(avatar) && group.assigneeAvatars.length < 5) {
            group.assigneeAvatars.push(avatar);
        }
    }
}

function newGroup(key: string, label: string): TaskGridGroup {
    return {
        key,
        label,
        count: 0,
        doneCount: 0,
        overdueCount: 0,
        estimateMinutes: 0,
        assigneeAvatars: [],
    };
}

/**
 * Derive group-header analytics without I/O. Rows are counted once per group;
 * a task with two assignees therefore contributes to both assignee groups.
 */
export function deriveGroups(
    rows: readonly TaskGridRow[],
    groupBy: TaskGridGroupBy = "none",
    now = new Date(),
): TaskGridGroup[] {
    const groups = new Map<string, TaskGridGroup>();

    for (const row of rows) {
        const assignmentGroups = groupBy === "assignee"
            ? row.assignments.length > 0
                ? row.assignments.map((assignment) => ({
                    key: assignment.userId,
                    label: assignment.user?.name ?? assignment.userId,
                    assignments: [assignment],
                }))
                : [{ key: "unassigned", label: "Unassigned", assignments: [] }]
            : [{
                key: groupBy === "status" ? row.status : groupBy === "priority" ? row.priority : "all",
                label: groupBy === "status" ? row.status : groupBy === "priority" ? row.priority : "All tasks",
                assignments: row.assignments,
            }];

        for (const groupInput of assignmentGroups) {
            const group = groups.get(groupInput.key) ?? newGroup(groupInput.key, groupInput.label);
            groups.set(groupInput.key, group);
            group.count += 1;
            if (rowIsDone(row)) group.doneCount += 1;
            const dueAt = rowDueAt(row);
            if (dueAt && dueAt < now && !rowIsDone(row)) group.overdueCount += 1;
            group.estimateMinutes += row.estimateMinutes ?? 0;
            addAvatarSample(group, groupInput.assignments);
        }
    }

    return Array.from(groups.values());
}
