"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
    GridGroupBy,
    TaskGridCursor,
    TaskGridFilters,
    TaskGridGroup,
    TaskGridResponse,
    TaskGridRow,
    TaskGridRowPatch,
} from "./grid-types";
import { computeSelectionRange, type SelectionModifiers } from "./selection";

const GROUP_BY_VALUES: readonly GridGroupBy[] = ["status", "priority", "assignee", "none"];

function groupKeyForRow(row: TaskGridRow, groupBy: GridGroupBy): string {
    if (groupBy === "status") return row.status;
    if (groupBy === "priority") return row.priority;
    if (groupBy === "assignee") return row.assignments[0]?.user?.id ?? "unassigned";
    return "all";
}

export interface UseTaskGridOptions {
    endpoint?: string;
    filters?: TaskGridFilters;
    initialGroupBy?: GridGroupBy;
}

function parseGroupBy(value: string | null | undefined): GridGroupBy {
    return GROUP_BY_VALUES.includes(value as GridGroupBy)
        ? value as GridGroupBy
        : "status";
}

function setListParam(params: URLSearchParams, key: string, values: string[]): void {
    params.delete(key);
    values.forEach((value) => params.append(key, value));
}

export function buildBaseParams(
    rawSearchParams: string,
    groupBy: GridGroupBy,
    filters?: TaskGridFilters,
): URLSearchParams {
    const params = new URLSearchParams(rawSearchParams);
    params.delete("legacy");
    params.delete("cursor");
    params.set("groupBy", groupBy);

    if (!filters) return params;
    if (filters.status) setListParam(params, "status", filters.status);
    if (filters.statusNotIn) setListParam(params, "statusNotIn", filters.statusNotIn);
    if (filters.priority) setListParam(params, "priority", filters.priority);
    if (filters.assigneeIds) {
        params.delete("assigneeId");
        setListParam(params, "assigneeIds", filters.assigneeIds);
    }
    if (filters.tagIds) setListParam(params, "tagIds", filters.tagIds);

    const scalarFilters: Array<[keyof TaskGridFilters, string]> = [
        ["scope", "scope"],
        ["projectId", "projectId"],
        ["workspaceId", "workspaceId"],
        ["search", "search"],
        ["dueBefore", "dueBefore"],
        ["dueAfter", "dueAfter"],
    ];
    scalarFilters.forEach(([filterKey, queryKey]) => {
        const value = filters[filterKey];
        if (value !== undefined) params.set(queryKey, value as string);
    });
    if (filters.includeArchived !== undefined) {
        params.set("includeArchived", String(filters.includeArchived));
    }

    return params;
}

function mergeRows(previous: TaskGridRow[], incoming: TaskGridRow[]): TaskGridRow[] {
    const merged = new Map(previous.map((row) => [row.id, row]));
    incoming.forEach((row) => merged.set(row.id, row));
    return Array.from(merged.values());
}

function mergeGroups(previous: TaskGridGroup[], incoming: TaskGridGroup[]): TaskGridGroup[] {
    const merged = new Map(previous.map((group) => [group.key, group]));
    incoming.forEach((group) => {
        const current = merged.get(group.key);
        if (!current) {
            merged.set(group.key, group);
            return;
        }
        const avatars = new Map(current.sampleAvatars.map((avatar) => [avatar.id, avatar]));
        group.sampleAvatars.forEach((avatar) => avatars.set(avatar.id, avatar));
        merged.set(group.key, {
            ...group,
            count: current.count + group.count,
            doneCount: current.doneCount + group.doneCount,
            overdueCount: current.overdueCount + group.overdueCount,
            estimateMinutesSum: current.estimateMinutesSum + group.estimateMinutesSum,
            sampleAvatars: Array.from(avatars.values()).slice(0, 5),
        });
    });
    return Array.from(merged.values());
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Failed to fetch tasks";
}

export function useTaskGrid(options: UseTaskGridOptions = {}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const rawSearchParams = searchParams.toString();
    const urlGroupBy = parseGroupBy(searchParams.get("groupBy"));
    const filtersKey = JSON.stringify(options.filters ?? {});
    const endpoint = options.endpoint ?? "/api/tasks/grid";

    const [groupBy, setGroupByState] = useState<GridGroupBy>(
        () => options.initialGroupBy ?? urlGroupBy,
    );
    const [rows, setRows] = useState<TaskGridRow[]>([]);
    const [groups, setGroups] = useState<TaskGridGroup[]>([]);
    const [nextCursor, setNextCursor] = useState<TaskGridCursor | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const selectionAnchorRef = useRef<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const rowsRef = useRef<TaskGridRow[]>([]);
    const requestGenerationRef = useRef(0);

    const commitRows = useCallback((updater: (current: TaskGridRow[]) => TaskGridRow[]) => {
        setRows((current) => {
            const next = updater(current);
            rowsRef.current = next;
            return next;
        });
    }, []);

    const baseParams = useMemo(
        () => buildBaseParams(
            rawSearchParams,
            groupBy,
            filtersKey === "{}" ? undefined : JSON.parse(filtersKey) as TaskGridFilters,
        ),
        [filtersKey, groupBy, rawSearchParams],
    );

    useEffect(() => {
        if (options.initialGroupBy === undefined) setGroupByState(urlGroupBy);
    }, [options.initialGroupBy, rawSearchParams, urlGroupBy]);

    const setGroupBy = useCallback((nextGroupBy: GridGroupBy) => {
        setGroupByState(nextGroupBy);
        const params = new URLSearchParams(rawSearchParams);
        params.delete("cursor");
        params.set("groupBy", nextGroupBy);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, [pathname, rawSearchParams, router]);

    const fetchPage = useCallback(async (
        cursor: TaskGridCursor | null,
        signal?: AbortSignal,
    ): Promise<TaskGridResponse> => {
        const params = new URLSearchParams(baseParams);
        if (cursor) params.set("cursor", JSON.stringify(cursor));
        const response = await fetch(`${endpoint}?${params.toString()}`, {
            cache: "no-store",
            signal,
        });
        const payload = await response.json() as Partial<TaskGridResponse> & { error?: unknown };
        if (!response.ok) {
            const message = typeof payload.error === "string" ? payload.error : "Failed to fetch tasks";
            throw new Error(message);
        }
        if (!Array.isArray(payload.rows)) throw new Error("Invalid task grid response");
        return {
            rows: payload.rows as TaskGridRow[],
            groups: Array.isArray(payload.groups) ? payload.groups as TaskGridGroup[] : [],
            nextCursor: payload.nextCursor ?? null,
        };
    }, [baseParams, endpoint]);

    useEffect(() => {
        const controller = new AbortController();
        requestGenerationRef.current += 1;
        let active = true;
        setLoading(true);
        setLoadingMore(false);
        setError(null);
        setNextCursor(null);
        setGroups([]);
        setSelectedIds(new Set());
        selectionAnchorRef.current = null;
        commitRows(() => []);

        fetchPage(null, controller.signal)
            .then((data) => {
                if (!active) return;
                commitRows(() => data.rows);
                setGroups(data.groups);
                setNextCursor(data.nextCursor);
            })
            .catch((requestError: unknown) => {
                if (!active || (requestError as { name?: string }).name === "AbortError") return;
                setError(errorMessage(requestError));
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
            controller.abort();
        };
    }, [commitRows, fetchPage, reloadToken]);

    const loadMore = useCallback(async () => {
        if (!nextCursor || loading || loadingMore) return;
        const generation = requestGenerationRef.current;
        setLoadingMore(true);
        setError(null);
        try {
            const data = await fetchPage(nextCursor);
            if (generation !== requestGenerationRef.current) return;
            commitRows((current) => mergeRows(current, data.rows));
            setGroups((current) => mergeGroups(current, data.groups));
            setNextCursor(data.nextCursor);
        } catch (requestError: unknown) {
            if (generation === requestGenerationRef.current && (requestError as { name?: string }).name !== "AbortError") {
                setError(errorMessage(requestError));
            }
        } finally {
            if (generation === requestGenerationRef.current) setLoadingMore(false);
        }
    }, [commitRows, fetchPage, loading, loadingMore, nextCursor]);

    const refresh = useCallback(() => setReloadToken((token) => token + 1), []);

    const updateTaskLocal = useCallback(async (id: string, patch: TaskGridRowPatch) => {
        const previous = rowsRef.current.find((row) => row.id === id);
        if (!previous) return;
        commitRows((current) => current.map((row) => (
            row.id === id ? { ...row, ...patch } : row
        )));

        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!response.ok) throw new Error("Failed to update task");
        } catch (requestError: unknown) {
            commitRows((current) => current.map((row) => (
                row.id === id ? previous : row
            )));
            throw requestError;
        }
    }, [commitRows]);

    const toggleSelection = useCallback((id: string, modifiers: SelectionModifiers = {}) => {
        const anchor = selectionAnchorRef.current;
        setSelectedIds((current) => {
            const next = new Set(current);
            if (modifiers.shiftKey) {
                computeSelectionRange(rowsRef.current.map((row) => row.id), anchor, id)
                    .forEach((rangeId) => next.add(rangeId));
                return next;
            }
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        selectionAnchorRef.current = id;
    }, []);

    const selectRow = useCallback((id: string, modifiers: SelectionModifiers = {}) => {
        const anchor = selectionAnchorRef.current;
        setSelectedIds((current) => {
            if (modifiers.shiftKey) {
                const next = new Set(current);
                computeSelectionRange(rowsRef.current.map((row) => row.id), anchor, id)
                    .forEach((rangeId) => next.add(rangeId));
                return next;
            }
            if (modifiers.ctrlKey || modifiers.metaKey) {
                const next = new Set(current);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            }
            return new Set([id]);
        });
        if (!modifiers.shiftKey || anchor === null) selectionAnchorRef.current = id;
    }, []);

    const toggleGroupSelection = useCallback((ids: readonly string[]) => {
        setSelectedIds((current) => {
            const next = new Set(current);
            const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
            ids.forEach((id) => {
                if (allSelected) next.delete(id);
                else next.add(id);
            });
            return next;
        });
        if (ids[0]) selectionAnchorRef.current = ids[0];
    }, []);

    const selectGroup = useCallback((groupKey: string) => {
        const ids = rowsRef.current
            .filter((row) => groupKeyForRow(row, groupBy) === groupKey)
            .map((row) => row.id);
        setSelectedIds((current) => {
            const next = new Set(current);
            const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
            ids.forEach((id) => {
                if (allSelected) next.delete(id);
                else next.add(id);
            });
            return next;
        });
        if (ids[0]) selectionAnchorRef.current = ids[0];
    }, [groupBy]);

    const clearSelection = useCallback(() => {
        selectionAnchorRef.current = null;
        setSelectedIds(new Set());
    }, []);

    return {
        rows,
        groups,
        groupBy,
        setGroupBy,
        nextCursor,
        hasMore: nextCursor !== null,
        loading,
        loadingMore,
        error,
        isEmpty: !loading && !error && rows.length === 0,
        refresh,
        loadMore,
        updateTaskLocal,
        selection: selectedIds,
        selectedIds,
        toggleSelection,
        selectRow,
        toggleGroupSelection,
        selectGroup,
        clearSelection,
    };
}
