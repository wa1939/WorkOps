"use client";

import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export const TASK_DRAWER_TABS = ["info", "time", "activity"] as const;
export type TaskDrawerTab = (typeof TASK_DRAWER_TABS)[number];

export interface TaskDrawerUrlState {
    taskId: string | null;
    tab: TaskDrawerTab;
    commentId: string | null;
}

export type TaskDrawerUrlAction =
    | { type: "open"; taskId: string }
    | { type: "close" }
    | { type: "set-tab"; tab: TaskDrawerTab }
    | { type: "previous"; ids: readonly string[] }
    | { type: "next"; ids: readonly string[] };

export function createTaskDrawerUrlState(): TaskDrawerUrlState {
    return { taskId: null, tab: "info", commentId: null };
}

export function normalizeTaskDrawerTab(value: string | null | undefined): TaskDrawerTab {
    return TASK_DRAWER_TABS.includes(value as TaskDrawerTab) ? value as TaskDrawerTab : "info";
}

export function readTaskDrawerUrl(searchParams: { get(name: string): string | null }): TaskDrawerUrlState {
    const taskId = searchParams.get("task");
    return {
        taskId: taskId || null,
        tab: normalizeTaskDrawerTab(searchParams.get("tab")),
        commentId: searchParams.get("comment") || null,
    };
}

function moveTask(state: TaskDrawerUrlState, ids: readonly string[], direction: -1 | 1): TaskDrawerUrlState {
    if (ids.length === 0) return state;
    const index = state.taskId ? ids.indexOf(state.taskId) : -1;
    const targetIndex = index < 0
        ? direction === -1 ? ids.length - 1 : 0
        : Math.max(0, Math.min(ids.length - 1, index + direction));
    if (ids[targetIndex] === state.taskId) return state;
    return { ...state, taskId: ids[targetIndex] ?? null, commentId: null };
}

export function taskDrawerUrlReducer(
    state: TaskDrawerUrlState,
    action: TaskDrawerUrlAction,
): TaskDrawerUrlState {
    switch (action.type) {
        case "open":
            return { taskId: action.taskId, tab: "info", commentId: null };
        case "close":
            return createTaskDrawerUrlState();
        case "set-tab":
            return { ...state, tab: action.tab };
        case "previous":
            return moveTask(state, action.ids, -1);
        case "next":
            return moveTask(state, action.ids, 1);
        default:
            return state;
    }
}

export interface TaskDrawerListContextValue {
    ids: readonly string[];
}

export const TaskDrawerListContext = createContext<TaskDrawerListContextValue>({ ids: [] });

export function TaskDrawerListProvider({ ids, children }: TaskDrawerListContextValue & { children: ReactNode }) {
    const value = useMemo(() => ({ ids }), [ids]);
    return createElement(TaskDrawerListContext.Provider, { value }, children);
}

export function useTaskDrawerList(): readonly string[] {
    return useContext(TaskDrawerListContext).ids;
}

function queryForState(state: TaskDrawerUrlState, current: string): string {
    const params = new URLSearchParams(current);
    if (state.taskId) {
        params.set("task", state.taskId);
        params.set("tab", state.tab);
        if (state.commentId) params.set("comment", state.commentId);
        else params.delete("comment");
    } else {
        params.delete("task");
        params.delete("tab");
        params.delete("comment");
    }
    const query = params.toString();
    return query ? `?${query}` : "";
}

export function useTaskDrawer() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();
    const ids = useTaskDrawerList();
    const state = useMemo(() => readTaskDrawerUrl(searchParams), [searchParams]);

    const replaceState = useCallback((next: TaskDrawerUrlState) => {
        router.replace(`${pathname}${queryForState(next, searchParams.toString())}`, { scroll: false });
    }, [pathname, router, searchParams]);

    const open = useCallback((taskId: string) => {
        replaceState(taskDrawerUrlReducer(state, { type: "open", taskId }));
    }, [replaceState, state]);
    const close = useCallback(() => replaceState(taskDrawerUrlReducer(state, { type: "close" })), [replaceState, state]);
    const setTab = useCallback((tab: TaskDrawerTab) => replaceState(taskDrawerUrlReducer(state, { type: "set-tab", tab })), [replaceState, state]);
    const previous = useCallback(() => replaceState(taskDrawerUrlReducer(state, { type: "previous", ids })), [ids, replaceState, state]);
    const next = useCallback(() => replaceState(taskDrawerUrlReducer(state, { type: "next", ids })), [ids, replaceState, state]);

    return { ...state, ids, open, close, setTab, previous, next };
}
