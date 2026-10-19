import type { Block } from "@/components/view-blocks/block-editor";

export type ViewQuickFilter = "me" | "overdue" | "this-week" | "high-priority";

export type QuickFilterResult = {
    block: Block;
    conflict: string | null;
};

type TaskViewClientBlock = Block & Record<string, unknown>;

type DateBounds = {
    dueAfter?: string;
    dueBefore?: string;
};

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_KEYS = ["status", "priority", "assigneeIds", "tagIds", "projectIds"] as const;
const SCALAR_KEYS = [
    "projectId",
    "workspaceId",
    "search",
    "dueRange",
    "dueAfter",
    "dueBefore",
    "sortBy",
    "groupBy",
] as const;

function recordFor(block: Block): TaskViewClientBlock {
    return block as TaskViewClientBlock;
}

function legacyFilters(block: Block): Record<string, unknown> {
    return block.filters && typeof block.filters === "object" ? block.filters : {};
}

function flattenValues(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(flattenValues);
    if (typeof value === "string") {
        return value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean);
    }
    if (typeof value === "number" || typeof value === "boolean") return [String(value)];
    return [];
}

function unique(values: readonly string[]): string[] {
    return Array.from(new Set(values));
}

function valuesFor(block: Block, key: string): string[] {
    const rawBlock = recordFor(block);
    const filters = legacyFilters(block);
    return unique([
        ...flattenValues(rawBlock[key]),
        ...flattenValues(filters[key]),
    ]);
}

function scalarFor(block: Block, ...keys: string[]): string | undefined {
    const rawBlock = recordFor(block);
    const filters = legacyFilters(block);
    for (const key of keys) {
        const blockValue = flattenValues(rawBlock[key])[0];
        if (blockValue !== undefined) return blockValue;
        const filterValue = flattenValues(filters[key])[0];
        if (filterValue !== undefined) return filterValue;
    }
    return undefined;
}

function appendList(params: URLSearchParams, key: string, values: readonly string[]): void {
    for (const value of unique(values)) params.append(key, value);
}

/**
 * Serialize a persisted task-view block for the browser-only view-data route.
 * It intentionally keeps @me unresolved so authorization and actor resolution
 * remain server-side.
 */
export function serializeViewTaskQuery(block: Block, offset = 0): URLSearchParams {
    const params = new URLSearchParams();
    for (const key of LIST_KEYS) appendList(params, key, valuesFor(block, key));

    for (const key of SCALAR_KEYS) {
        const value = scalarFor(block, key);
        if (value !== undefined) params.set(key, value);
    }

    const includeArchived = scalarFor(block, "includeArchived");
    if (includeArchived !== undefined) params.set("includeArchived", includeArchived);

    const sortDir = scalarFor(block, "sortDir", "dir");
    if (sortDir !== undefined) params.set("sortDir", sortDir);

    params.set("offset", String(Math.max(0, offset)));
    return params;
}

export function buildViewTaskUrl(block: Block, offset = 0): string {
    return `/api/tasks/view-data?${serializeViewTaskQuery(block, offset).toString()}`;
}

function riyadhDayStart(now: Date): Date {
    const riyadhNow = new Date(now.getTime() + RIYADH_OFFSET_MS);
    riyadhNow.setUTCHours(0, 0, 0, 0);
    return new Date(riyadhNow.getTime() - RIYADH_OFFSET_MS);
}

function boundsForRange(range: string, now: Date): DateBounds | null {
    const dayStart = riyadhDayStart(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    if (range === "overdue") {
        return { dueBefore: new Date(dayStart.getTime() - 1).toISOString() };
    }
    if (range === "today") {
        return {
            dueAfter: dayStart.toISOString(),
            dueBefore: new Date(dayEnd.getTime() - 1).toISOString(),
        };
    }
    if (range === "this-week") {
        const riyadhNow = new Date(now.getTime() + RIYADH_OFFSET_MS);
        const weekStart = new Date(riyadhNow);
        weekStart.setUTCHours(0, 0, 0, 0);
        weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
        const start = new Date(weekStart.getTime() - RIYADH_OFFSET_MS);
        return {
            dueAfter: start.toISOString(),
            dueBefore: new Date(start.getTime() + 7 * DAY_MS - 1).toISOString(),
        };
    }
    return null;
}

function explicitBoundsFor(block: Block): DateBounds {
    const dueAfter = scalarFor(block, "dueAfter");
    const dueBefore = scalarFor(block, "dueBefore");
    return {
        ...(dueAfter ? { dueAfter } : {}),
        ...(dueBefore ? { dueBefore } : {}),
    };
}

function intersectBounds(left: DateBounds, right: DateBounds): DateBounds | null {
    const leftAfter = left.dueAfter ? new Date(left.dueAfter).getTime() : Number.NEGATIVE_INFINITY;
    const rightAfter = right.dueAfter ? new Date(right.dueAfter).getTime() : Number.NEGATIVE_INFINITY;
    const leftBefore = left.dueBefore ? new Date(left.dueBefore).getTime() : Number.POSITIVE_INFINITY;
    const rightBefore = right.dueBefore ? new Date(right.dueBefore).getTime() : Number.POSITIVE_INFINITY;
    const after = Math.max(leftAfter, rightAfter);
    const before = Math.min(leftBefore, rightBefore);
    if (after > before) return null;
    return {
        ...(Number.isFinite(after) ? { dueAfter: new Date(after).toISOString() } : {}),
        ...(Number.isFinite(before) ? { dueBefore: new Date(before).toISOString() } : {}),
    };
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function updateField(block: Block, key: string, value: unknown): Block {
    const next = { ...block } as TaskViewClientBlock;
    const filters = { ...legacyFilters(block) };
    const rawBlock = recordFor(block);
    const updateBlock = hasOwn(rawBlock, key) || !hasOwn(filters, key);
    const updateFilters = hasOwn(filters, key);

    if (updateBlock) next[key] = value;
    if (updateFilters) filters[key] = value;
    next.filters = filters;
    return next as Block;
}

function addConflict(conflicts: string[], message: string): void {
    if (!conflicts.includes(message)) conflicts.push(message);
}

/**
 * Apply transient renderer chips without mutating saved JSON. Restrictions that
 * cannot intersect are surfaced as a no-match state instead of being broadened.
 */
export function applyViewQuickFilters(
    block: Block,
    activeFilters: ReadonlySet<string>,
    now = new Date(),
): QuickFilterResult {
    if (activeFilters.size === 0) return { block, conflict: null };
    let next = { ...block, filters: { ...legacyFilters(block) } } as Block;
    const conflicts: string[] = [];

    if (activeFilters.has("me")) {
        const persistedAssignees = valuesFor(next, "assigneeIds");
        if (persistedAssignees.length > 0 && !persistedAssignees.includes("@me")) {
            addConflict(conflicts, "Me cannot be combined with the saved assignee restriction; no tasks match.");
        } else {
            next = updateField(next, "assigneeIds", ["@me"]);
        }
    }

    if (activeFilters.has("high-priority")) {
        const persistedPriorities = valuesFor(next, "priority");
        const intersection = persistedPriorities.length === 0
            ? ["HIGH", "URGENT"]
            : persistedPriorities.filter((priority) => priority === "HIGH" || priority === "URGENT");
        if (intersection.length === 0) {
            addConflict(conflicts, "High Priority cannot be combined with the saved priority restriction; no tasks match.");
        } else {
            next = updateField(next, "priority", intersection);
        }
    }

    const rangeFilters = ["overdue", "this-week"].filter((filter): filter is "overdue" | "this-week" => activeFilters.has(filter));
    if (rangeFilters.length > 1) {
        addConflict(conflicts, "Overdue and This Week are mutually exclusive; choose one.");
    } else if (rangeFilters.length === 1) {
        const requestedRange = rangeFilters[0];
        const persistedRange = scalarFor(next, "dueRange");
        const savedExplicitBounds = explicitBoundsFor(next);
        const persistedRangeBounds = persistedRange ? boundsForRange(persistedRange, now) : {};
        const savedBounds = persistedRange && !persistedRangeBounds
            ? null
            : intersectBounds(persistedRangeBounds ?? {}, savedExplicitBounds);
        const chipBounds = boundsForRange(requestedRange, now) ?? {};
        const intersection = savedBounds ? intersectBounds(savedBounds, chipBounds) : null;

        if (!intersection) {
            addConflict(conflicts, `${requestedRange === "overdue" ? "Overdue" : "This Week"} cannot be combined with the saved date restriction; no tasks match.`);
        } else if (!persistedRange) {
            next = updateField(next, "dueRange", requestedRange);
        } else if (persistedRange === requestedRange) {
            // Preserve the persisted range: removing it would also remove the
            // server's terminal-status exclusion for overdue/weekly queries.
        } else {
            // Keep the saved range for its server-side open-task semantics and
            // add the intersection as explicit bounds understood by the route.
            if (intersection.dueAfter) next = updateField(next, "dueAfter", intersection.dueAfter);
            if (intersection.dueBefore) next = updateField(next, "dueBefore", intersection.dueBefore);
        }
    }

    return { block: next, conflict: conflicts.length > 0 ? conflicts.join(" ") : null };
}
