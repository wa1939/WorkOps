import { z } from "zod";
import {
    taskGridDirectionSchema,
    taskGridGroupBySchema,
    taskGridInputSchema,
    taskGridPrioritySchema,
    taskGridSortBySchema,
    taskGridStatusSchema,
    type TaskGridInput,
} from "@/lib/tasks/grid-query";
import { currentRiyadhWeekWindow, riyadhDayWindow } from "@/lib/week";
export { riyadhDayWindow } from "@/lib/week";
const MAX_FILTER_VALUES = 100;
export const MAX_VIEW_TASK_OFFSET = 10_000;

const identifierSchema = z.string().trim().min(1).max(200);
const listSchema = z.array(identifierSchema).max(MAX_FILTER_VALUES);
const statusListSchema = z.array(taskGridStatusSchema).max(6);
const priorityListSchema = z.array(taskGridPrioritySchema).max(4);
const dueRangeSchema = z.enum(["overdue", "today", "this-week"]);
export const viewTaskGroupBySchema = z.enum(["status", "priority", "assignee", "project", "none"]);

export type ViewTaskGroupBy = z.infer<typeof viewTaskGroupBySchema>;
export type ViewTaskBlockConfig = {
    type?: string;
    filters?: Record<string, unknown>;
    projectId?: unknown;
    projectIds?: unknown;
    assigneeIds?: unknown;
    tagIds?: unknown;
    status?: unknown;
    priority?: unknown;
    workspaceId?: unknown;
    search?: unknown;
    includeArchived?: unknown;
    dueRange?: unknown;
    dueBefore?: unknown;
    dueAfter?: unknown;
    sortBy?: unknown;
    sortDir?: unknown;
    dir?: unknown;
    groupBy?: unknown;
    offset?: unknown;
};

/** The parsed view query deliberately omits cursor pagination. */
export type ViewTaskGridInput = Omit<TaskGridInput, "cursor"> & { cursor?: undefined };
export type NormalizedViewTaskQuery = {
    input: ViewTaskGridInput;
    groupBy: ViewTaskGroupBy;
    offset: number;
};

const terminalStatuses = ["DONE", "CANCELED"] as const;

function recordValue(value: unknown): Record<string, unknown> {
    return z.record(z.unknown()).parse(value);
}

function listValue(value: unknown): unknown[] {
    if (Array.isArray(value)) return value.flatMap(listValue);
    if (typeof value === "string") return value.split(",").map((part) => part.trim());
    return [value];
}

function sourceValues(
    block: Record<string, unknown>,
    filters: Record<string, unknown>,
    key: string,
): unknown[] {
    const values: unknown[] = [];
    if (block[key] !== undefined && block[key] !== null) values.push(block[key]);
    if (filters[key] !== undefined && filters[key] !== null) values.push(filters[key]);
    return values;
}

function readList(
    block: Record<string, unknown>,
    filters: Record<string, unknown>,
    key: string,
): unknown[] | undefined {
    const values = sourceValues(block, filters, key);
    return values.length > 0 ? values.flatMap(listValue) : undefined;
}

function readScalar(
    block: Record<string, unknown>,
    filters: Record<string, unknown>,
    ...keys: string[]
): unknown {
    for (const key of keys) {
        if (block[key] !== undefined && block[key] !== null) return block[key];
        if (filters[key] !== undefined && filters[key] !== null) return filters[key];
    }
    return undefined;
}

function parseList(value: unknown[] | undefined): string[] {
    return Array.from(new Set(listSchema.parse(value ?? [])));
}

function parseStatuses(value: unknown[] | undefined): Array<z.infer<typeof taskGridStatusSchema>> {
    return Array.from(new Set(statusListSchema.parse(value ?? [])));
}

function parsePriorities(value: unknown[] | undefined): Array<z.infer<typeof taskGridPrioritySchema>> {
    return Array.from(new Set(priorityListSchema.parse(value ?? [])));
}

function parseOptionalIdentifier(value: unknown): string | undefined {
    return value === undefined ? undefined : identifierSchema.parse(value);
}

function parseOptionalDate(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    return z.string().datetime({ offset: true }).parse(value);
}

function parseBoolean(value: unknown): boolean {
    if (value === undefined) return false;
    return z.union([
        z.boolean(),
        z.enum(["true", "1", "false", "0"]).transform((item) => item === "true" || item === "1"),
    ]).parse(value);
}

const offsetSchema = z.union([
    z.number().int().min(0).max(MAX_VIEW_TASK_OFFSET),
    z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(MAX_VIEW_TASK_OFFSET)),
]);

function parseOffset(value: unknown): number {
    return offsetSchema.parse(value ?? 0);
}


function dateRangeFilters(dueRange: z.infer<typeof dueRangeSchema>, now: Date): {
    dueAfter?: string;
    dueBefore?: string;
} {
    const { start: dayStart, end: dayEnd } = riyadhDayWindow(now);
    if (dueRange === "overdue") {
        return { dueBefore: new Date(dayStart.getTime() - 1).toISOString() };
    }
    if (dueRange === "today") {
        return {
            dueAfter: dayStart.toISOString(),
            dueBefore: new Date(dayEnd.getTime() - 1).toISOString(),
        };
    }
    const { weekStart, weekEnd } = currentRiyadhWeekWindow(now);
    return {
        dueAfter: weekStart.toISOString(),
        dueBefore: new Date(weekEnd.getTime() - 1).toISOString(),
    };
}

function intersectDueBounds(
    rangeBounds: { dueAfter?: string; dueBefore?: string },
    explicitBounds: { dueAfter?: string; dueBefore?: string },
): { dueAfter?: string; dueBefore?: string } {
    const dueAfter = rangeBounds.dueAfter === undefined
        ? explicitBounds.dueAfter
        : explicitBounds.dueAfter === undefined
            ? rangeBounds.dueAfter
            : new Date(rangeBounds.dueAfter).getTime() >= new Date(explicitBounds.dueAfter).getTime()
                ? rangeBounds.dueAfter
                : explicitBounds.dueAfter;
    const dueBefore = rangeBounds.dueBefore === undefined
        ? explicitBounds.dueBefore
        : explicitBounds.dueBefore === undefined
            ? rangeBounds.dueBefore
            : new Date(rangeBounds.dueBefore).getTime() <= new Date(explicitBounds.dueBefore).getTime()
                ? rangeBounds.dueBefore
                : explicitBounds.dueBefore;

    if (dueAfter !== undefined && dueBefore !== undefined && new Date(dueAfter).getTime() > new Date(dueBefore).getTime()) {
        throw new z.ZodError([{
            code: z.ZodIssueCode.custom,
            path: ["dueRange"],
            message: "due bounds do not overlap",
        }]);
    }

    return {
        ...(dueAfter !== undefined ? { dueAfter } : {}),
        ...(dueBefore !== undefined ? { dueBefore } : {}),
    };
}

function parseProjectFilters(
    block: Record<string, unknown>,
    filters: Record<string, unknown>,
): { projectId?: string; projectIds: string[] } {
    const candidates = sourceValues(block, filters, "projectId").map((value) => identifierSchema.parse(value));
    const projectId = candidates[0];
    const projectIds = parseList(readList(block, filters, "projectIds"));
    const allProjectIds = [...projectIds, ...candidates.slice(1)];
    return {
        ...(projectId ? { projectId } : {}),
        projectIds: Array.from(new Set(allProjectIds)),
    };
}

/**
 * Convert a persisted task-view block into the server's validated grid input.
 * This function is pure: authorization and database access stay in the route.
 */
export function normalizeViewTaskQuery(
    rawBlock: ViewTaskBlockConfig,
    actorId: string,
    now: Date,
): NormalizedViewTaskQuery {
    const block = recordValue(rawBlock);
    const filtersValue = block.filters;
    const filters = filtersValue === undefined || filtersValue === null ? {} : recordValue(filtersValue);
    const actor = identifierSchema.parse(actorId);

    const explicitStatuses = parseStatuses(readList(block, filters, "status"));
    const dueRangeRaw = readScalar(block, filters, "dueRange");
    const dueRange = dueRangeRaw === undefined ? undefined : dueRangeSchema.parse(dueRangeRaw);
    const rangeFilters = dueRange ? dateRangeFilters(dueRange, new Date(z.date().parse(now))) : {};
    const hasExplicitTerminal = explicitStatuses.some((status) => terminalStatuses.includes(status as typeof terminalStatuses[number]));
    const statusNotIn = dueRange === "overdue"
        ? [...terminalStatuses]
        : dueRange && !hasExplicitTerminal
            ? [...terminalStatuses]
            : [];

    const { projectId, projectIds } = parseProjectFilters(block, filters);
    const assigneeIds = parseList(readList(block, filters, "assigneeIds"))
        .map((id) => id === "@me" ? actor : id);
    const tagIds = parseList(readList(block, filters, "tagIds"));
    const workspaceId = parseOptionalIdentifier(readScalar(block, filters, "workspaceId"));
    const search = parseOptionalIdentifier(readScalar(block, filters, "search"));
    const rawDueAfter = parseOptionalDate(readScalar(block, filters, "dueAfter"));
    const rawDueBefore = parseOptionalDate(readScalar(block, filters, "dueBefore"));
    const dueBounds = intersectDueBounds(rangeFilters, { dueAfter: rawDueAfter, dueBefore: rawDueBefore });
    const sortRaw = readScalar(block, filters, "sortBy");
    const sortBy = taskGridSortBySchema.parse(sortRaw === "dueAt" ? "dueDate" : sortRaw ?? "updatedAt");
    const dir = taskGridDirectionSchema.parse(readScalar(block, filters, "sortDir", "dir") ?? "desc");
    const groupBy = viewTaskGroupBySchema.parse(readScalar(block, filters, "groupBy") ?? "none");
    const offset = parseOffset(readScalar(block, filters, "offset"));

    const input = taskGridInputSchema.parse({
        filters: {
            status: explicitStatuses,
            statusNotIn,
            priority: parsePriorities(readList(block, filters, "priority")),
            assigneeIds,
            tagIds,
            projectIds,
            includeArchived: parseBoolean(readScalar(block, filters, "includeArchived")),
            ...(projectId ? { projectId } : {}),
            ...(workspaceId ? { workspaceId } : {}),
            ...(search ? { search } : {}),
            ...(dueBounds.dueAfter ? { dueAfter: dueBounds.dueAfter } : {}),
            ...(dueBounds.dueBefore ? { dueBefore: dueBounds.dueBefore } : {}),
        },
        groupBy: groupBy === "project" ? "none" : groupBy,
        sortBy,
        dir,
    }) as ViewTaskGridInput;

    return { input, groupBy, offset };
}

function scalarParam(params: URLSearchParams, name: string): unknown {
    const values = params.getAll(name);
    if (values.length === 0) return undefined;
    return values.length === 1 ? values[0] : values;
}

function listParam(params: URLSearchParams, name: string): unknown[] | undefined {
    const values = params.getAll(name);
    return values.length === 0 ? undefined : values.flatMap((value) => value.split(",").map((part) => part.trim()));
}

/** Parse URL query fields without touching auth or the database. */
export function parseViewTaskSearchParams(params: URLSearchParams): ViewTaskBlockConfig {
    return {
        status: listParam(params, "status"),
        priority: listParam(params, "priority"),
        assigneeIds: listParam(params, "assigneeIds"),
        tagIds: listParam(params, "tagIds"),
        projectIds: listParam(params, "projectIds"),
        projectId: scalarParam(params, "projectId"),
        workspaceId: scalarParam(params, "workspaceId"),
        search: scalarParam(params, "search"),
        includeArchived: scalarParam(params, "includeArchived"),
        dueRange: scalarParam(params, "dueRange"),
        dueBefore: scalarParam(params, "dueBefore"),
        dueAfter: scalarParam(params, "dueAfter"),
        sortBy: scalarParam(params, "sortBy"),
        sortDir: scalarParam(params, "sortDir") ?? scalarParam(params, "dir"),
        groupBy: scalarParam(params, "groupBy"),
        offset: scalarParam(params, "offset"),
    };
}
