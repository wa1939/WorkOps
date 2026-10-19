import type { Block } from "@/components/view-blocks/block-editor";
import type { ViewQuickFilter } from "./view-task-client";
import { applyViewQuickFilters, serializeViewTaskQuery } from "./view-task-client";

export type ViewMetric =
    | "my-open"
    | "my-overdue"
    | "my-due-today"
    | "my-due-week"
    | "my-done-week"
    | "team-done-week"
    | "team-overdue"
    | "active-projects"
    | "on-track-kpis"
    | "at-risk-kpis";

export type ViewChartKind =
    | "task-by-status"
    | "task-by-priority"
    | "task-by-project"
    | "task-completion-trend"
    | "kpi-by-perspective"
    | "kpi-status";

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

export type ViewAggregateExpectation = {
    kind: "metric" | "chart";
    key: ViewMetric | ViewChartKind;
    scope: "task" | "project" | "kpi";
};

export type ViewAggregateUrl = {
    url: string;
    conflict: string | null;
};

export const DEFAULT_VIEW_METRIC: ViewMetric = "my-open";
export const DEFAULT_VIEW_CHART_KIND: ViewChartKind = "task-by-status";

export type ViewAggregateSelectorErrorCode =
    | "missing"
    | "multiple"
    | "unsupported-metric"
    | "unsupported-chart";

export class ViewAggregateSelectorError extends Error {
    constructor(
        public readonly code: ViewAggregateSelectorErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "ViewAggregateSelectorError";
    }
}

const TASK_METRICS: ReadonlySet<ViewMetric> = new Set<ViewMetric>([
    "my-open",
    "my-overdue",
    "my-due-today",
    "my-due-week",
    "my-done-week",
    "team-done-week",
    "team-overdue",
]);
const PROJECT_METRICS: ReadonlySet<ViewMetric> = new Set<ViewMetric>(["active-projects"]);
const KPI_METRICS: ReadonlySet<ViewMetric> = new Set<ViewMetric>(["on-track-kpis", "at-risk-kpis"]);
const TASK_CHARTS: ReadonlySet<ViewChartKind> = new Set<ViewChartKind>([
    "task-by-status",
    "task-by-priority",
    "task-by-project",
    "task-completion-trend",
]);
const KPI_CHARTS: ReadonlySet<ViewChartKind> = new Set<ViewChartKind>(["kpi-by-perspective", "kpi-status"]);

const TASK_AGGREGATE_KEYS = new Set([
    "assigneeIds",
    "priority",
    "dueRange",
    "dueAfter",
    "dueBefore",
    "status",
    "tagIds",
    "projectId",
    "projectIds",
    "workspaceId",
    "search",
    "includeArchived",
]);

const METRIC_KEYS = new Set<ViewMetric>([
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
const CHART_KEYS = new Set<ViewChartKind>([
    "task-by-status",
    "task-by-priority",
    "task-by-project",
    "task-completion-trend",
    "kpi-by-perspective",
    "kpi-status",
]);

const EMPTY_CHIPS: ReadonlySet<string> = new Set();

function recordFor(block: Block): Record<string, unknown> {
    return block as unknown as Record<string, unknown>;
}

function scalarFor(block: Block, key: string): string | undefined {
    const record = recordFor(block);
    const filters = record.filters;
    const filterRecord = typeof filters === "object" && filters !== null
        ? filters as Record<string, unknown>
        : undefined;
    const value = record[key] ?? filterRecord?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Restore the selectors used by the original blank data blocks without
 * weakening validation for an explicitly supplied selector.
 */
export function withViewAggregateDefault(block: Block, kind: "metric" | "chart"): Block {
    if (scalarFor(block, "metric") !== undefined || scalarFor(block, "chartKind") !== undefined) {
        return block;
    }
    return kind === "metric"
        ? { ...block, metric: DEFAULT_VIEW_METRIC }
        : { ...block, chartKind: DEFAULT_VIEW_CHART_KIND };
}

function selectorFor(block: Block): { selector: ViewMetric | ViewChartKind; kind: "metric" | "chart" } {
    const metric = scalarFor(block, "metric");
    const chartKind = scalarFor(block, "chartKind");
    if ((metric === undefined) === (chartKind === undefined)) {
        throw new ViewAggregateSelectorError(
            metric === undefined ? "missing" : "multiple",
            metric === undefined
                ? "Exactly one of metric or chartKind is required"
                : "Exactly one of metric or chartKind is required; both were supplied",
        );
    }

    if (metric !== undefined) {
        if (!METRIC_KEYS.has(metric as ViewMetric)) {
            throw new ViewAggregateSelectorError("unsupported-metric", `Unsupported view metric: ${metric}`);
        }
        return { selector: metric as ViewMetric, kind: "metric" };
    }

    if (!CHART_KEYS.has(chartKind as ViewChartKind)) {
        throw new ViewAggregateSelectorError("unsupported-chart", `Unsupported view chart: ${chartKind}`);
    }
    return { selector: chartKind as ViewChartKind, kind: "chart" };
}

export function getViewAggregateExpectation(block: Block): ViewAggregateExpectation {
    const { selector, kind } = selectorFor(block);
    if (kind === "metric") {
        return {
            kind,
            key: selector,
            scope: TASK_METRICS.has(selector as ViewMetric)
                ? "task"
                : PROJECT_METRICS.has(selector as ViewMetric)
                    ? "project"
                    : "kpi",
        };
    }

    return {
        kind,
        key: selector,
        scope: TASK_CHARTS.has(selector as ViewChartKind) ? "task" : "kpi",
    };
}

/**
 * Build the reviewed aggregate URL without resolving the current actor in the browser.
 * Task-only chips are intersected by the existing task-view quick-filter helper; all
 * paging, sorting, and grouping controls are deliberately excluded from the route.
 */
export function buildViewAggregateUrl(
    block: Block,
    activeChips: ReadonlySet<ViewQuickFilter | string> = EMPTY_CHIPS,
): ViewAggregateUrl {
    const expectation = getViewAggregateExpectation(block);
    const params = new URLSearchParams();
    if (expectation.kind === "metric") params.set("metric", expectation.key);
    else params.set("chartKind", expectation.key);

    if (expectation.scope !== "task") {
        return { url: `/api/views/aggregate?${params.toString()}`, conflict: null };
    }

    const quickFilter = applyViewQuickFilters(block, activeChips);
    if (quickFilter.conflict) {
        return { url: "", conflict: quickFilter.conflict };
    }

    const taskParams = serializeViewTaskQuery(quickFilter.block);
    taskParams.forEach((value, key) => {
        if (TASK_AGGREGATE_KEYS.has(key)) params.append(key, value);
    });

    return { url: `/api/views/aggregate?${params.toString()}`, conflict: null };
}

export class ViewAggregateResponseError extends Error {
    constructor(reason: string) {
        super(`Invalid view aggregate response: ${reason}`);
        this.name = "ViewAggregateResponseError";
    }
}

export class ViewAggregateConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ViewAggregateConflictError";
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function requiredString(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== "string" || value.length === 0) {
        throw new ViewAggregateResponseError(`${key} must be a non-empty string`);
    }
    return value;
}

function validateWindow(value: unknown): { start: string; end: string } | undefined {
    if (value === undefined) return undefined;
    if (!isRecord(value)) throw new ViewAggregateResponseError("window must be an object");
    const start = requiredString(value, "start");
    const end = requiredString(value, "end");
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime > endTime) {
        throw new ViewAggregateResponseError("window must contain ordered dates");
    }
    return { start, end };
}

/** Validate the discriminated server contract before rendering any successful data. */
export function parseViewAggregateResponse(
    payload: unknown,
    expected: ViewAggregateExpectation,
): ViewAggregateResponse {
    if (!isRecord(payload)) throw new ViewAggregateResponseError("payload must be an object");
    if (payload.kind !== expected.kind) throw new ViewAggregateResponseError("kind does not match the request");
    if (payload.key !== expected.key) throw new ViewAggregateResponseError("key does not match the request");
    if (payload.scope !== expected.scope) throw new ViewAggregateResponseError("scope does not match the request");
    if (payload.timeZone !== "Asia/Riyadh") throw new ViewAggregateResponseError("timeZone is not Asia/Riyadh");

    const totalCount = payload.totalCount;
    if (!isCount(totalCount)) throw new ViewAggregateResponseError("totalCount must be a non-negative integer");
    const window = validateWindow(payload.window);

    if (expected.kind === "metric") {
        if (Object.prototype.hasOwnProperty.call(payload, "points")) {
            throw new ViewAggregateResponseError("metric payload cannot contain points");
        }
        const value = payload.value;
        if (!isCount(value)) throw new ViewAggregateResponseError("value must be a non-negative integer");
        if (totalCount !== value) throw new ViewAggregateResponseError("totalCount must equal value");
        return {
            kind: "metric",
            key: expected.key as ViewMetric,
            scope: expected.scope,
            value,
            totalCount,
            timeZone: "Asia/Riyadh",
            ...(window ? { window } : {}),
        };
    }

    if (Object.prototype.hasOwnProperty.call(payload, "value")) {
        throw new ViewAggregateResponseError("chart payload cannot contain value");
    }
    if (!Array.isArray(payload.points)) throw new ViewAggregateResponseError("points must be an array");

    const keys = new Set<string>();
    const points = payload.points.map((point, index): ViewAggregatePoint => {
        if (!isRecord(point)) throw new ViewAggregateResponseError(`point ${index} must be an object`);
        const key = requiredString(point, "key");
        const label = requiredString(point, "label");
        const value = point.value;
        if (!isCount(value)) throw new ViewAggregateResponseError(`point ${index} value must be a non-negative integer`);
        if (keys.has(key)) throw new ViewAggregateResponseError(`point key ${key} is duplicated`);
        keys.add(key);
        return { key, label, value };
    });
    const pointTotal = points.reduce((sum, point) => sum + point.value, 0);
    if (pointTotal !== totalCount) throw new ViewAggregateResponseError("totalCount must equal point values");

    return {
        kind: "chart",
        key: expected.key as ViewChartKind,
        scope: expected.scope as "task" | "kpi",
        points,
        totalCount,
        timeZone: "Asia/Riyadh",
        ...(window ? { window } : {}),
    };
}

export async function fetchViewAggregate(
    block: Block,
    activeChips: ReadonlySet<ViewQuickFilter | string> = EMPTY_CHIPS,
    signal?: AbortSignal,
): Promise<ViewAggregateResponse> {
    const expectation = getViewAggregateExpectation(block);
    const request = buildViewAggregateUrl(block, activeChips);
    if (request.conflict) throw new ViewAggregateConflictError(request.conflict);

    const response = await fetch(request.url, { signal });
    if (!response.ok) throw new Error(`Aggregate request failed with status ${response.status}`);

    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        throw new ViewAggregateResponseError("response body is not JSON");
    }
    return parseViewAggregateResponse(payload, expectation);
}
