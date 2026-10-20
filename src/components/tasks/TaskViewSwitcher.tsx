"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { riyadhDayWindow } from "@/lib/week";
import type { TaskGridFilters } from "./grid/grid-types";
import { Board } from "./board/Board";
import { TaskGrid } from "./grid/TaskGrid";
import {
    TaskWorkspaceToolbar,
    type TaskWorkspaceDuePreset,
    type TaskWorkspaceFilterState,
    type TaskWorkspaceScope,
    type TaskWorkspaceView,
} from "./TaskWorkspaceToolbar";

const TASKS_VIEW_STORAGE_KEY = "tasks-view";

const TASK_SCOPES: readonly TaskWorkspaceScope[] = ["all", "assigned", "related", "created", "unassigned"];
const DUE_PRESETS: readonly TaskWorkspaceDuePreset[] = ["", "today", "week", "overdue"];
const DEFAULT_SORT_BY = "updatedAt";
const DEFAULT_DIR = "desc";
const FILTER_PARAM_KEYS = ["scope", "assigneeIds", "assigneeId", "status", "priority", "search", "due", "dueBefore", "dueAfter", "statusNotIn", "cursor", "sortBy", "dir"];

function readScope(value: string | null): TaskWorkspaceScope {
    return TASK_SCOPES.includes(value as TaskWorkspaceScope) ? value as TaskWorkspaceScope : "assigned";
}

function readDuePreset(value: string | null): TaskWorkspaceDuePreset {
    return DUE_PRESETS.includes(value as TaskWorkspaceDuePreset) ? value as TaskWorkspaceDuePreset : "";
}

/** Reads the saved view without ever letting storage failures break the page. */
export function parseStoredView(storage: Pick<Storage, "getItem">): TaskWorkspaceView | null {
    try {
        const stored = storage.getItem(TASKS_VIEW_STORAGE_KEY);
        return stored === "list" || stored === "board" ? stored : null;
    } catch {
        return null;
    }
}

/** Turns a due preset into the ISO dueBefore/dueAfter bounds the query already understands. */
export function duePresetToRange(
    preset: TaskWorkspaceDuePreset,
    now: Date,
): { dueBefore?: string; dueAfter?: string } {
    const { start, end } = riyadhDayWindow(now);
    if (preset === "today") {
        return { dueAfter: start.toISOString(), dueBefore: new Date(end.getTime() - 1).toISOString() };
    }
    if (preset === "week") {
        const weekEnd = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000 - 1);
        return { dueAfter: start.toISOString(), dueBefore: weekEnd.toISOString() };
    }
    if (preset === "overdue") {
        return { dueBefore: new Date(start.getTime() - 1).toISOString() };
    }
    return {};
}

/**
 * Tasks workspace: one URL-encoded filter state shared by the grid and the
 * board. The URL is the source of truth — localStorage only fills in the view
 * when the URL is silent, and every storage access is guarded.
 */
export function TaskViewSwitcher() {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const queryString = searchParams.toString();
    const pendingQueryRef = useRef(queryString);
    const queuedQueriesRef = useRef<string[]>([]);

    useEffect(() => {
        const acknowledged = queuedQueriesRef.current.indexOf(queryString);
        if (acknowledged >= 0) {
            queuedQueriesRef.current.splice(0, acknowledged + 1);
            if (queuedQueriesRef.current.length > 0) return;
        } else {
            queuedQueriesRef.current = [];
        }
        pendingQueryRef.current = queryString;
    }, [queryString]);

    const filters = useMemo<TaskWorkspaceFilterState>(() => {
        const params = new URLSearchParams(queryString);
        return {
            scope: readScope(params.get("scope")),
            assigneeIds: params.getAll(params.has("assigneeIds") ? "assigneeIds" : "assigneeId").filter(Boolean),
            status: params.getAll("status").filter(Boolean),
            priority: params.getAll("priority").filter(Boolean),
            search: params.get("search") ?? "",
            due: readDuePreset(params.get("due")),
            sortBy: params.get("sortBy") || DEFAULT_SORT_BY,
            dir: params.get("dir") === "asc" ? "asc" : DEFAULT_DIR,
        };
    }, [queryString]);

    const [storedView, setStoredView] = useState<TaskWorkspaceView | null>(null);
    const [pendingView, setPendingView] = useState<TaskWorkspaceView | null>(null);

    useEffect(() => {
        try { setStoredView(parseStoredView(window.localStorage)); }
        catch { setStoredView(null); }
    }, []);

    useEffect(() => {
        setPendingView(null);
    }, [queryString]);

    const urlView = searchParams.get("view");
    const view: TaskWorkspaceView =
        urlView === "board" || urlView === "list"
            ? urlView
            : pendingView ?? storedView ?? "list";

    const pushParams = useCallback((mutate: (params: URLSearchParams) => void) => {
        const params = new URLSearchParams(pendingQueryRef.current);
        mutate(params);
        const query = params.toString();
        if (query === pendingQueryRef.current) return;
        pendingQueryRef.current = query;
        queuedQueriesRef.current.push(query);
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router]);

    const handleFilterChange = useCallback((patch: Partial<TaskWorkspaceFilterState>) => {
        pushParams((params) => {
            if (patch.scope !== undefined) {
                // "assigned" is the default, so the URL stays clean without it.
                if (patch.scope === "assigned") params.delete("scope");
                else params.set("scope", patch.scope);
            }
            if (patch.assigneeIds !== undefined) {
                params.delete("assigneeIds");
                params.delete("assigneeId");
                patch.assigneeIds.filter(Boolean).forEach((id) => params.append("assigneeIds", id));
            }
            if (patch.status !== undefined) {
                params.delete("status");
                patch.status.filter(Boolean).forEach((value) => params.append("status", value));
            }
            if (patch.priority !== undefined) {
                params.delete("priority");
                patch.priority.filter(Boolean).forEach((value) => params.append("priority", value));
            }
            if (patch.search !== undefined) {
                const search = patch.search.trim();
                if (search) params.set("search", search);
                else params.delete("search");
            }
            if (patch.due !== undefined) {
                params.delete("dueBefore");
                params.delete("dueAfter");
                params.delete("statusNotIn");
                if (patch.due) params.set("due", patch.due);
                else params.delete("due");
            }
            if (patch.sortBy !== undefined) {
                if (patch.sortBy && patch.sortBy !== DEFAULT_SORT_BY) params.set("sortBy", patch.sortBy);
                else params.delete("sortBy");
            }
            if (patch.dir !== undefined) {
                if (patch.dir === "asc") params.set("dir", "asc");
                else params.delete("dir");
            }
        });
    }, [pushParams]);

    const handleClearFilters = useCallback(() => {
        pushParams((params) => {
            FILTER_PARAM_KEYS.forEach((key) => params.delete(key));
        });
    }, [pushParams]);

    const handleViewChange = useCallback((nextView: TaskWorkspaceView) => {
        setPendingView(nextView);
        pushParams((params) => {
            params.set("view", nextView);
        });
        try {
            window.localStorage.setItem(TASKS_VIEW_STORAGE_KEY, nextView);
        } catch {
            // Storage can be unavailable in private browsing; the URL still records the view.
        }
    }, [pushParams]);

    const gridFilters = useMemo(() => {
        // "assigned" (My tasks) never carries assigneeIds, and a named person is
        // only meaningful under the "all" scope — selecting one switches to it.
        const derived: TaskGridFilters & { scope: TaskWorkspaceScope } = { scope: filters.scope, assigneeIds: [] };
        if (filters.scope === "all" && filters.assigneeIds.length > 0) {
            derived.assigneeIds = filters.assigneeIds;
        }
        if (filters.status.length > 0) derived.status = filters.status;
        if (filters.priority.length > 0) derived.priority = filters.priority;
        if (filters.due === "overdue") derived.statusNotIn = ["DONE", "CANCELED"];
        const search = filters.search.trim();
        if (search) derived.search = search;
        Object.assign(derived, duePresetToRange(filters.due, new Date()));
        return derived;
    }, [filters]);

    return (
        <div className="space-y-4">
            <TaskWorkspaceToolbar
                filters={filters}
                onChange={handleFilterChange}
                onClear={handleClearFilters}
                view={view}
                onViewChange={handleViewChange}
            />
            {view === "board" ? <Board filters={gridFilters} /> : <TaskGrid filters={gridFilters} />}
        </div>
    );
}

export default TaskViewSwitcher;
