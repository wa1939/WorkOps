import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { projectVisibilityWhere } from "@/lib/executive-summary";
import { assertCanReadKpi } from "@/lib/kpis/authorization";
import { buildTaskGridQuery, taskGridPrioritySchema, taskGridStatusSchema } from "@/lib/tasks/grid-query";
import { currentRiyadhWeekWindow } from "@/lib/week";
import {
    normalizeViewTaskQuery,
    parseViewTaskSearchParams,
    riyadhDayWindow,
    type ViewTaskBlockConfig,
} from "@/lib/view-task-query";
import type { SabahActor } from "@/lib/sabah/auth/actor";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_FILTER_VALUES = 100;
const identifierSchema = z.string().trim().min(1).max(200);
const listSchema = z.array(identifierSchema).max(MAX_FILTER_VALUES);
const dueRangeSchema = z.enum(["overdue", "today", "this-week"]);
const includeArchivedSchema = z.enum(["true", "1", "false", "0"]);

const taskFilterKeys = new Set([
    "status",
    "priority",
    "assigneeIds",
    "tagIds",
    "projectId",
    "projectIds",
    "workspaceId",
    "search",
    "includeArchived",
    "dueRange",
    "dueAfter",
    "dueBefore",
]);
const forbiddenAggregateKeys = new Set(["offset", "cursor", "sortBy", "sortDir", "dir", "groupBy"]);
const selectorKeys = new Set(["metric", "chartKind"]);
const allowedKeys = new Set([
    ...Array.from(taskFilterKeys),
    ...Array.from(forbiddenAggregateKeys),
    ...Array.from(selectorKeys),
]);

const aggregateTaskScopeSchema = z.object({
    status: z.array(taskGridStatusSchema).max(6).optional(),
    priority: z.array(taskGridPrioritySchema).max(4).optional(),
    assigneeIds: listSchema.optional(),
    tagIds: listSchema.optional(),
    projectId: identifierSchema.optional(),
    projectIds: listSchema.optional(),
    workspaceId: identifierSchema.optional(),
    search: identifierSchema.optional(),
    includeArchived: includeArchivedSchema.optional(),
    dueRange: dueRangeSchema.optional(),
    dueAfter: z.string().datetime({ offset: true }).optional(),
    dueBefore: z.string().datetime({ offset: true }).optional(),
}).strict();

const viewMetricSchema = z.enum([
    "my-open",
    "my-overdue",
    "my-due-today",
    "my-due-week",
    "my-done-week",
    "team-done-week",
    "team-overdue",
    "active-projects",
    "on-track-kpis",
    "at-risk-kpis",
]);
const viewChartKindSchema = z.enum([
    "task-by-status",
    "task-by-priority",
    "task-by-project",
    "task-completion-trend",
    "kpi-by-perspective",
    "kpi-status",
]);

export type ViewMetric = z.infer<typeof viewMetricSchema>;
export type ViewChartKind = z.infer<typeof viewChartKindSchema>;

export type ViewAggregatePoint = {
    key: string;
    label: string;
    value: number;
};

export type ViewAggregateResponse =
    | {
        kind: "metric";
        key: ViewMetric;
        scope: "task" | "project" | "kpi";
        value: number;
        totalCount: number;
        timeZone: "Asia/Riyadh";
        window?: { start: string; end: string };
    }
    | {
        kind: "chart";
        key: ViewChartKind;
        scope: "task" | "kpi";
        points: ViewAggregatePoint[];
        totalCount: number;
        timeZone: "Asia/Riyadh";
        window?: { start: string; end: string };
    };

export type ParsedViewAggregateSearchParams = {
    metric?: ViewMetric;
    chartKind?: ViewChartKind;
    taskScope: ViewTaskBlockConfig;
};

type AggregateGroup = Record<string, unknown> & {
    _count: { _all: number } | number;
};

/** Narrow delegate surface used by the pure service and its tests. */
export type ViewAggregateDatabase = {
    task: {
        count(args: { where: Prisma.TaskWhereInput }): Promise<number>;
        groupBy(args: {
            by: readonly string[];
            where: Prisma.TaskWhereInput;
            _count: { _all: true };
        }): Promise<AggregateGroup[]>;
    };
    project: {
        count(args: { where: Prisma.ProjectWhereInput }): Promise<number>;
        findMany(args: {
            where: Prisma.ProjectWhereInput;
            select: { id: true; name: true };
        }): Promise<Array<{ id: string; name: string }>>;
    };
    kPI: {
        count(args: { where: Prisma.KPIWhereInput }): Promise<number>;
        groupBy(args: {
            by: readonly string[];
            where: Prisma.KPIWhereInput;
            _count: { _all: true };
        }): Promise<AggregateGroup[]>;
    };
};

const OPEN_TASK_STATUSES = ["TODO", "DOING", "BLOCKED", "WAITING"] as const;
const STATUS_ORDER = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"];
const PRIORITY_ORDER = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const KPI_STATUS_ORDER = ["ON_TRACK", "AT_RISK", "OFF_TRACK"];
const taskMetricKeys = new Set<ViewMetric>([
    "my-open",
    "my-overdue",
    "my-due-today",
    "my-due-week",
    "my-done-week",
    "team-done-week",
    "team-overdue",
]);
const taskChartKeys = new Set<ViewChartKind>([
    "task-by-status",
    "task-by-priority",
    "task-by-project",
    "task-completion-trend",
]);

function dbOrDefault(db?: ViewAggregateDatabase): ViewAggregateDatabase {
    return db ?? (prisma as unknown as ViewAggregateDatabase);
}

function fail(message: string): never {
    throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: [],
        message,
    }]);
}

function scalarParam(params: URLSearchParams, name: string): string | undefined {
    const values = params.getAll(name);
    if (values.length > 1) fail(`${name} may only be provided once`);
    return values[0];
}

function hasTaskScope(scope: ViewTaskBlockConfig): boolean {
    const record = scope as Record<string, unknown>;
    if (Object.entries(record).some(([key, value]) => {
        if (!taskFilterKeys.has(key) || value === undefined) return false;
        return Array.isArray(value) ? value.length > 0 : true;
    })) return true;

    const filters = record.filters;
    return typeof filters === "object" && filters !== null
        && Object.values(filters as Record<string, unknown>).some((value) => value !== undefined);
}

function rejectForbiddenTaskScope(scope: ViewTaskBlockConfig): void {
    const record = scope as Record<string, unknown>;
    const filters = typeof record.filters === "object" && record.filters !== null
        ? record.filters as Record<string, unknown>
        : {};
    forbiddenAggregateKeys.forEach((key) => {
        if (record[key] !== undefined || filters[key] !== undefined) {
            fail(`${key} is not supported for aggregate queries`);
        }
    });
}

/** Parse one aggregate selector and its bounded task filters without auth or I/O. */
export function parseViewAggregateSearchParams(params: URLSearchParams): ParsedViewAggregateSearchParams {
    params.forEach((_value, key) => {
        if (!allowedKeys.has(key)) fail(`Unknown aggregate parameter: ${key}`);
    });
    forbiddenAggregateKeys.forEach((key) => {
        if (params.has(key)) fail(`${key} is not supported for aggregate queries`);
    });

    const metricValue = scalarParam(params, "metric");
    const chartKindValue = scalarParam(params, "chartKind");
    if ((metricValue === undefined) === (chartKindValue === undefined)) {
        fail("Exactly one of metric or chartKind is required");
    }

    const metric = metricValue === undefined ? undefined : viewMetricSchema.parse(metricValue);
    const chartKind = chartKindValue === undefined ? undefined : viewChartKindSchema.parse(chartKindValue);
    const parsedTaskQuery = parseViewTaskSearchParams(params);
    const taskScopeInput = Object.fromEntries(
        Object.entries(parsedTaskQuery).filter(([key, value]) => taskFilterKeys.has(key) && value !== undefined),
    );
    const taskScope = aggregateTaskScopeSchema.parse(taskScopeInput) as ViewTaskBlockConfig;

    if (metric !== undefined && !taskMetricKeys.has(metric) && hasTaskScope(taskScope)) {
        fail("Task scope is not supported for this metric");
    }
    if (chartKind !== undefined && !taskChartKeys.has(chartKind) && hasTaskScope(taskScope)) {
        fail("Task scope is not supported for this chart");
    }

    return {
        ...(metric !== undefined ? { metric } : {}),
        ...(chartKind !== undefined ? { chartKind } : {}),
        taskScope,
    };
}

function andWhere(base: Prisma.TaskWhereInput, extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput {
    return { AND: [base, extra] };
}

function metricResponse(
    key: ViewMetric,
    scope: "task" | "project" | "kpi",
    value: number,
    window?: { start: Date; end: Date },
): ViewAggregateResponse {
    return {
        kind: "metric",
        key,
        scope,
        value,
        totalCount: value,
        timeZone: "Asia/Riyadh",
        ...(window ? { window: { start: window.start.toISOString(), end: window.end.toISOString() } } : {}),
    };
}

function chartResponse(
    key: ViewChartKind,
    scope: "task" | "kpi",
    points: ViewAggregatePoint[],
    window?: { start: Date; end: Date },
): ViewAggregateResponse {
    return {
        kind: "chart",
        key,
        scope,
        points,
        totalCount: points.reduce((total, point) => total + point.value, 0),
        timeZone: "Asia/Riyadh",
        ...(window ? { window: { start: window.start.toISOString(), end: window.end.toISOString() } } : {}),
    };
}

function groupCount(group: AggregateGroup): number {
    return typeof group._count === "number" ? group._count : group._count._all;
}

function sortByOrder(points: ViewAggregatePoint[], order: readonly string[]): ViewAggregatePoint[] {
    const rank = new Map(order.map((key, index) => [key, index]));
    return [...points].sort((left, right) => {
        const leftRank = rank.get(left.key) ?? order.length;
        const rightRank = rank.get(right.key) ?? order.length;
        return leftRank - rightRank || left.key.localeCompare(right.key);
    });
}

function sortByLabel(points: ViewAggregatePoint[]): ViewAggregatePoint[] {
    return [...points].sort((left, right) => left.label.localeCompare(right.label) || left.key.localeCompare(right.key));
}

function taskWhereFor(
    taskScope: ViewTaskBlockConfig,
    actor: SabahActor,
    now: Date,
): Prisma.TaskWhereInput {
    rejectForbiddenTaskScope(taskScope);
    return buildTaskGridQuery(
        normalizeViewTaskQuery(taskScope, actor.id, now).input,
        actor,
    ).where;
}

function taskMetricExtra(
    metric: Extract<ViewMetric, "my-open" | "my-overdue" | "my-due-today" | "my-due-week" | "my-done-week" | "team-done-week" | "team-overdue">,
    now: Date,
    actorId: string,
): {
    where: Prisma.TaskWhereInput;
    window?: { start: Date; end: Date };
} {
    const day = riyadhDayWindow(now);
    const week = currentRiyadhWeekWindow(now);
    const openStatus = { status: { in: [...OPEN_TASK_STATUSES] } } as Prisma.TaskWhereInput;
    const assignedToActor = { assignments: { some: { userId: actorId } } } as Prisma.TaskWhereInput;

    switch (metric) {
        case "my-open":
            return { where: { ...assignedToActor, ...openStatus } };
        case "my-overdue":
            return { where: { ...assignedToActor, ...openStatus, dueAt: { lt: day.start } } };
        case "my-due-today":
            return {
                where: { ...assignedToActor, ...openStatus, dueAt: { gte: day.start, lt: day.end } },
                window: day,
            };
        case "my-due-week":
            return {
                where: { ...assignedToActor, ...openStatus, dueAt: { gte: week.weekStart, lt: week.weekEnd } },
                window: { start: week.weekStart, end: week.weekEnd },
            };
        case "my-done-week":
            return {
                where: { ...assignedToActor, status: "DONE", doneAt: { gte: week.weekStart, lt: week.weekEnd } },
                window: { start: week.weekStart, end: week.weekEnd },
            };
        case "team-done-week":
            return {
                where: { status: "DONE", doneAt: { gte: week.weekStart, lt: week.weekEnd } },
                window: { start: week.weekStart, end: week.weekEnd },
            };
        case "team-overdue":
            return { where: { ...openStatus, dueAt: { lt: day.start } } };
    }
}

async function aggregateTaskMetric(
    metric: Extract<ViewMetric, "my-open" | "my-overdue" | "my-due-today" | "my-due-week" | "my-done-week" | "team-done-week" | "team-overdue">,
    taskScope: ViewTaskBlockConfig,
    actor: SabahActor,
    now: Date,
    db: ViewAggregateDatabase,
): Promise<ViewAggregateResponse> {
    const base = taskWhereFor(taskScope, actor, now);
    const extra = taskMetricExtra(metric, now, actor.id);
    const where = andWhere(base, extra.where);
    const value = await db.task.count({ where });
    return metricResponse(metric, "task", value, extra.window);
}

function taskGroupPoints(groups: AggregateGroup[], field: "status" | "priority"): ViewAggregatePoint[] {
    return groups.flatMap((group) => {
        const key = group[field];
        return typeof key === "string"
            ? [{ key, label: key, value: groupCount(group) }]
            : [];
    });
}

async function aggregateTaskChart(
    chartKind: Extract<ViewChartKind, "task-by-status" | "task-by-priority" | "task-by-project" | "task-completion-trend">,
    taskScope: ViewTaskBlockConfig,
    actor: SabahActor,
    now: Date,
    db: ViewAggregateDatabase,
): Promise<ViewAggregateResponse> {
    const base = taskWhereFor(taskScope, actor, now);

    if (chartKind === "task-by-status" || chartKind === "task-by-priority") {
        const field = chartKind === "task-by-status" ? "status" : "priority";
        const groups = await db.task.groupBy({ by: [field], where: base, _count: { _all: true } });
        const order = chartKind === "task-by-status" ? STATUS_ORDER : PRIORITY_ORDER;
        return chartResponse(chartKind, "task", sortByOrder(taskGroupPoints(groups, field), order));
    }

    if (chartKind === "task-by-project") {
        const groups = await db.task.groupBy({ by: ["projectId"], where: base, _count: { _all: true } });
        const projectIds = groups
            .map((group) => group.projectId)
            .filter((projectId): projectId is string => typeof projectId === "string");
        const projects = projectIds.length === 0
            ? []
            : await db.project.findMany({
                where: {
                    AND: [
                        projectVisibilityWhere(actor) as Prisma.ProjectWhereInput,
                        { id: { in: projectIds } },
                    ],
                },
                select: { id: true, name: true },
            });
        const names = new Map(projects.map((project) => [project.id, project.name]));
        const points = groups.flatMap((group) => {
            if (group.projectId === null) return [{ key: "__no-project__", label: "No project", value: groupCount(group) }];
            if (typeof group.projectId !== "string") return [];
            const name = names.get(group.projectId);
            return name === undefined ? [] : [{ key: group.projectId, label: name, value: groupCount(group) }];
        });
        return chartResponse(chartKind, "task", sortByLabel(points));
    }

    const currentDay = riyadhDayWindow(now);
    const firstDay = new Date(currentDay.start.getTime() - 13 * DAY_MS);
    const starts = Array.from({ length: 14 }, (_, index) => new Date(firstDay.getTime() + index * DAY_MS));
    const values = await Promise.all(starts.map((start) => {
        const end = new Date(start.getTime() + DAY_MS);
        const where = andWhere(base, {
            status: "DONE",
            doneAt: { gte: start, lt: end },
        });
        return db.task.count({ where });
    }));
    const points = starts.map((start, index) => {
        const key = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Riyadh",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(start);
        return { key, label: key, value: values[index] };
    });
    return chartResponse(chartKind, "task", points, {
        start: firstDay,
        end: currentDay.end,
    });
}

async function aggregateProjectMetric(
    metric: "active-projects",
    actor: SabahActor,
    db: ViewAggregateDatabase,
): Promise<ViewAggregateResponse> {
    const value = await db.project.count({
        where: {
            AND: [
                projectVisibilityWhere(actor) as Prisma.ProjectWhereInput,
                { status: { notIn: ["Done", "Archived"] } },
            ],
        },
    });
    return metricResponse(metric, "project", value);
}

async function aggregateKpiMetric(
    metric: "on-track-kpis" | "at-risk-kpis",
    actor: SabahActor,
    db: ViewAggregateDatabase,
): Promise<ViewAggregateResponse> {
    assertCanReadKpi(actor);
    const where: Prisma.KPIWhereInput = metric === "on-track-kpis"
        ? { status: "ON_TRACK" }
        : { status: { in: ["AT_RISK", "OFF_TRACK"] } };
    const value = await db.kPI.count({ where });
    return metricResponse(metric, "kpi", value);
}

async function aggregateKpiChart(
    chartKind: "kpi-by-perspective" | "kpi-status",
    actor: SabahActor,
    db: ViewAggregateDatabase,
): Promise<ViewAggregateResponse> {
    assertCanReadKpi(actor);
    const field = chartKind === "kpi-by-perspective" ? "perspective" : "status";
    const groups = await db.kPI.groupBy({ by: [field], where: {}, _count: { _all: true } });
    const points = groups.flatMap((group) => {
        const key = group[field];
        return typeof key === "string" ? [{ key, label: key, value: groupCount(group) }] : [];
    });
    return chartResponse(
        chartKind,
        "kpi",
        chartKind === "kpi-status" ? sortByOrder(points, KPI_STATUS_ORDER) : sortByLabel(points),
    );
}

/** Execute one validated aggregate against the existing authorization/query seams. */
export async function aggregateViewBlock({
    metric,
    chartKind,
    taskScope = {},
    actor,
    now,
    db,
}: {
    metric?: ViewMetric;
    chartKind?: ViewChartKind;
    taskScope?: ViewTaskBlockConfig;
    actor: SabahActor;
    now: Date;
    db?: ViewAggregateDatabase;
}): Promise<ViewAggregateResponse> {
    const client = dbOrDefault(db);
    rejectForbiddenTaskScope(taskScope);
    const selectedMetric = metric === undefined ? undefined : viewMetricSchema.parse(metric);
    const selectedChart = chartKind === undefined ? undefined : viewChartKindSchema.parse(chartKind);
    if ((selectedMetric === undefined) === (selectedChart === undefined)) {
        fail("Exactly one aggregate selector is required");
    }

    if (selectedMetric !== undefined) {
        if (!taskMetricKeys.has(selectedMetric) && hasTaskScope(taskScope)) {
            fail("Task scope is not supported for this metric");
        }
        if (selectedMetric === "active-projects") return aggregateProjectMetric(selectedMetric, actor, client);
        if (selectedMetric === "on-track-kpis" || selectedMetric === "at-risk-kpis") {
            return aggregateKpiMetric(selectedMetric, actor, client);
        }
        return aggregateTaskMetric(selectedMetric, taskScope, actor, now, client);
    }

    if (selectedChart !== undefined && !taskChartKeys.has(selectedChart) && hasTaskScope(taskScope)) {
        fail("Task scope is not supported for this chart");
    }
    if (selectedChart === "kpi-by-perspective" || selectedChart === "kpi-status") {
        return aggregateKpiChart(selectedChart, actor, client);
    }
    if (selectedChart === undefined) fail("Exactly one aggregate selector is required");
    return aggregateTaskChart(selectedChart, taskScope, actor, now, client);
}
