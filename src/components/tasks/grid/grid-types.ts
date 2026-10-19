import type { Priority, TaskStatus } from "@prisma/client";

export type GridGroupBy = "status" | "priority" | "assignee" | "none";

export type GridColumnId =
    | "key"
    | "title"
    | "timer"
    | "status"
    | "priority"
    | "assignees"
    | "dueDate"
    | "progress"
    | "estimate";

export interface GridColumnDefinition {
    id: GridColumnId;
    label: string;
    width: string;
    sticky?: boolean;
    defaultHidden?: boolean;
}

export type GridDate = string | Date | null;

export interface TaskGridUser {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    imageUrl?: string | null;
}

export interface TaskGridAssignment {
    userId?: string | null;
    user: TaskGridUser | null;
}

export interface TaskGridProject {
    id: string;
    name: string;
}

export interface TaskGridRow {
    id: string;
    taskKey: string | null;
    title: string;
    status: TaskStatus;
    priority: Priority;
    dueDate: GridDate;
    updatedAt: string | Date;
    progress?: number | null;
    progressMode?: string | null;
    manualProgress?: number | null;
    completedSubtasks?: number | null;
    subtaskCount?: number | null;
    estimateMinutes: number | null;
    assignments: TaskGridAssignment[];
    project: TaskGridProject | null;
}

export interface TaskGridGroup {
    key: string;
    label: string;
    count: number;
    doneCount: number;
    overdueCount: number;
    estimateMinutesSum: number;
    sampleAvatars: TaskGridUser[];
}

export interface TaskGridCursor {
    updatedAt: string;
    id: string;
}

export interface TaskGridFilters {
    status?: string[];
    priority?: string[];
    assigneeIds?: string[];
    tagIds?: string[];
    projectId?: string;
    workspaceId?: string;
    search?: string;
    includeArchived?: boolean;
    dueBefore?: string;
    dueAfter?: string;
}

export type TaskGridRowPatch = Partial<Pick<
    TaskGridRow,
    | "title"
    | "status"
    | "priority"
    | "dueDate"
    | "progress"
    | "manualProgress"
    | "estimateMinutes"
>>;

export interface TaskGridResponse {
    rows: TaskGridRow[];
    groups: TaskGridGroup[];
    nextCursor: TaskGridCursor | null;
}
