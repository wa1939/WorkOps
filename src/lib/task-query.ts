import type { Prisma } from "@prisma/client";

export type DueWindow = "overdue" | "today" | "week" | "none";
export type TaskSort = "due-asc" | "due-desc" | "priority" | "created-desc" | "created-asc" | "title";

const DUE_WINDOWS: ReadonlySet<string> = new Set(["overdue", "today", "week", "none"]);
const TASK_SORTS: ReadonlySet<string> = new Set([
    "due-asc",
    "due-desc",
    "priority",
    "created-desc",
    "created-asc",
    "title",
]);

/** Narrow untrusted query-string values to the options we actually support. */
export function parseDueWindow(value: string | undefined): DueWindow | undefined {
    return value && DUE_WINDOWS.has(value) ? (value as DueWindow) : undefined;
}

export function parseTaskSort(value: string | undefined): TaskSort {
    return value && TASK_SORTS.has(value) ? (value as TaskSort) : "priority";
}

const PRIORITIES: ReadonlySet<string> = new Set(["URGENT", "HIGH", "MEDIUM", "LOW"]);

export function parsePriority(value: string | undefined): Prisma.TaskWhereInput["priority"] {
    return value && PRIORITIES.has(value) ? (value as Prisma.TaskWhereInput["priority"]) : undefined;
}

const endOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

/**
 * Due-date filter as a Prisma `where` fragment. `overdue` deliberately means "past due and
 * still open", which is what someone scanning for what to do next actually wants.
 */
export function dueWindowFilter(window: DueWindow | undefined, now = new Date()): Prisma.TaskWhereInput {
    if (!window) return {};

    switch (window) {
        case "none":
            return { dueAt: null };
        case "overdue":
            return { dueAt: { lt: now } };
        case "today":
            return { dueAt: { lte: endOfDay(now) } };
        case "week":
            return { dueAt: { lte: endOfDay(new Date(now.getTime() + 6 * 86400000)) } };
    }
}

/**
 * Prisma `orderBy` for a sort key. Undated tasks sort last on due-date sorts so they don't
 * crowd out the work that actually has a deadline.
 */
export function taskOrderBy(sort: TaskSort): Prisma.TaskOrderByWithRelationInput[] {
    switch (sort) {
        case "due-asc":
            return [{ dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }];
        case "due-desc":
            return [{ dueAt: { sort: "desc", nulls: "last" } }, { priority: "desc" }];
        case "created-desc":
            return [{ createdAt: "desc" }];
        case "created-asc":
            return [{ createdAt: "asc" }];
        case "title":
            return [{ title: "asc" }];
        case "priority":
        default:
            return [{ priority: "desc" }, { dueAt: { sort: "asc", nulls: "last" } }];
    }
}
