"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Priority, TaskStatus } from "@prisma/client";
import { CalendarDays, ChevronLeft, ChevronRight, Flame, Loader2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeDate, getInitials } from "@/lib/utils";
import { DEFAULT_TIME_ZONE } from "@/lib/workload/calendar";
import { formatInTimeZone } from "date-fns-tz";
import { dueClass, dueDateSemantics, priorityClass, statusClass } from "@/lib/ui/status-tokens";
import { buildViewTaskUrl } from "@/lib/view-task-client";
import type { Block } from "./block-editor";

export type TaskViewTask = {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: string | null;
    dueDate: string | null;
    project: { id?: string; name?: string | null } | null;
    assignments: Array<{
        userId: string;
        user?: { id?: string; name?: string | null; image?: string | null } | null;
        [key: string]: unknown;
    }>;
    [key: string]: unknown;
};

type TaskViewResponse = {
    rows: TaskViewTask[];
    totalCount: number;
    nextOffset: number | null;
};

type TaskViewBlockProps = {
    block: Block;
    userId: string;
    color: string;
    filterConflict?: string | null;
};

type TaskGroup = {
    key: string;
    label: string;
    tasks: TaskViewTask[];
};

type LoadState = "loading" | "ready" | "error";

const STATUS_GROUPS = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"];
const PRIORITY_GROUPS = ["URGENT", "HIGH", "MEDIUM", "LOW"];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function dateString(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) return value;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    return null;
}

function normalizeTask(value: unknown): TaskViewTask | null {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return null;
    const dueAt = dateString(value.dueAt) ?? dateString(value.dueDate);
    const rawAssignments = Array.isArray(value.assignments) ? value.assignments : [];
    const assignments = rawAssignments.flatMap((assignment): TaskViewTask["assignments"] => {
        if (!isRecord(assignment) || typeof assignment.userId !== "string") return [];
        const user = isRecord(assignment.user) ? {
            ...assignment.user,
            ...(typeof assignment.user.id === "string" ? { id: assignment.user.id } : {}),
            ...(typeof assignment.user.name === "string" || assignment.user.name === null ? { name: assignment.user.name } : {}),
            ...(typeof assignment.user.image === "string" || assignment.user.image === null ? { image: assignment.user.image } : {}),
        } : null;
        return [{ ...assignment, userId: assignment.userId, user }];
    });
    const project = isRecord(value.project)
        ? {
            ...value.project,
            ...(typeof value.project.id === "string" ? { id: value.project.id } : {}),
            ...(typeof value.project.name === "string" || value.project.name === null ? { name: value.project.name } : {}),
        }
        : null;

    return {
        ...value,
        id: value.id,
        title: value.title,
        status: typeof value.status === "string" ? value.status : "TODO",
        priority: typeof value.priority === "string" ? value.priority : "MEDIUM",
        dueAt,
        dueDate: dueAt,
        project,
        assignments,
    };
}

function uniqueTasks(rows: readonly TaskViewTask[]): TaskViewTask[] {
    const seen = new Set<string>();
    return rows.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
    });
}

function parseResponse(payload: unknown, requestedOffset: number): TaskViewResponse {
    if (!isRecord(payload) || !Array.isArray(payload.rows)) {
        throw new Error("The task view response was not valid.");
    }
    const totalCount = payload.totalCount;
    if (typeof totalCount !== "number" || !Number.isInteger(totalCount) || totalCount < 0) {
        throw new Error("The task view response was not valid.");
    }
    const rows = payload.rows.map((row): TaskViewTask => {
        const normalized = normalizeTask(row);
        if (!normalized) throw new Error("The task view rows were not valid.");
        return normalized;
    });
    const nextOffset = payload.nextOffset === null
        ? null
        : payload.nextOffset === undefined
            ? (() => { throw new Error("The task view pagination response was not valid."); })()
            : typeof payload.nextOffset === "number" && Number.isInteger(payload.nextOffset) && payload.nextOffset >= 0
                ? payload.nextOffset
                : (() => { throw new Error("The task view pagination response was not valid."); })();
    if (nextOffset !== null && nextOffset <= requestedOffset) {
        throw new Error("The task view pagination response was not valid.");
    }
    return { rows: uniqueTasks(rows), totalCount, nextOffset };
}

function errorMessage(payload: unknown, status: number): string {
    if (isRecord(payload) && typeof payload.error === "string") return payload.error;
    return status > 0 ? `The task view request failed (HTTP ${status}).` : "The task view request failed.";
}

async function requestPage(url: string, signal: AbortSignal): Promise<TaskViewResponse> {
    const response = await fetch(url, { signal, cache: "no-store" });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new Error(errorMessage(payload, response.status));
    const requestedOffset = Number(new URL(url, "http://localhost").searchParams.get("offset") ?? "0");
    if (!Number.isInteger(requestedOffset) || requestedOffset < 0) throw new Error("The task view pagination request was not valid.");
    return parseResponse(payload, requestedOffset);
}

function configuredProject(block: Block): boolean {
    const filters = block.filters ?? {};
    const hasValue = (value: unknown): boolean => Array.isArray(value)
        ? value.some((item) => typeof item === "string" && item.trim().length > 0)
        : typeof value === "string" && value.trim().length > 0;
    return hasValue(block.projectId) || hasValue(filters.projectId) || hasValue(block.projectIds) || hasValue(filters.projectIds);
}

function humanize(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

function groupsForRows(rows: readonly TaskViewTask[], groupBy: string | undefined): TaskGroup[] {
    const groups = new Map<string, TaskGroup>();
    const add = (key: string, label: string, task: TaskViewTask) => {
        const group = groups.get(key) ?? { key, label, tasks: [] };
        group.tasks.push(task);
        groups.set(key, group);
    };

    for (const task of rows) {
        if (groupBy === "assignee") {
            if (task.assignments.length === 0) add("unassigned", "Unassigned", task);
            else {
                for (const assignment of task.assignments) {
                    add(assignment.userId, assignment.user?.name || assignment.userId, task);
                }
            }
        } else if (groupBy === "project") {
            add(task.project?.id ?? "no-project", task.project?.name || "No project", task);
        } else if (groupBy === "priority") {
            add(task.priority, humanize(task.priority), task);
        } else if (groupBy === "status") {
            add(task.status, humanize(task.status), task);
        } else {
            add("all", "All tasks", task);
        }
    }

    if (groupBy === "status") {
        return STATUS_GROUPS.map((status) => groups.get(status)).filter((group): group is TaskGroup => Boolean(group));
    }
    if (groupBy === "priority") {
        return PRIORITY_GROUPS.map((priority) => groups.get(priority)).filter((group): group is TaskGroup => Boolean(group));
    }
    return Array.from(groups.values());
}

function taskDate(task: TaskViewTask): Date | null {
    if (!task.dueAt) return null;
    const value = new Date(task.dueAt);
    return Number.isNaN(value.getTime()) ? null : value;
}

function taskHref(task: TaskViewTask): string {
    return `/tasks/${encodeURIComponent(task.id)}`;
}

function TaskLink({ task, compact = false }: { task: TaskViewTask; compact?: boolean }) {
    const dueAt = taskDate(task);
    const overdue = dueAt && task.status !== "DONE" && task.status !== "CANCELED" && dueDateSemantics(dueAt) === "overdue";
    return (
        <Link
            href={taskHref(task)}
            aria-label={task.title}
            dir="auto"
            className={cn(
                "block rounded-md border border-border bg-card text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                compact ? "min-h-[44px] px-2 py-1 text-[11px]" : "min-h-[44px] p-3",
            )}
        >
            <div className="flex items-start gap-2">
                {!compact && <span className={cn("mt-0.5 h-8 w-1 shrink-0 rounded-full", priorityClass(task.priority as Priority))} aria-hidden="true" />}
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                        <p className={cn("font-medium", compact ? "truncate" : "text-sm")}>{task.title}</p>
                        {task.priority === "URGENT" && <Flame className="h-4 w-4 shrink-0 text-[hsl(var(--priority-urgent-fg))]" aria-label="Urgent priority" />}
                    </div>
                    {!compact && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className={cn("rounded px-1.5 py-0.5", statusClass(task.status as TaskStatus))}>{humanize(task.status)}</span>
                            {dueAt && <span className={cn("rounded px-1.5 py-0.5", dueClass(dueAt))}>{formatRelativeDate(dueAt)}{overdue ? " · overdue" : ""}</span>}
                            {task.project?.name && <span className="text-muted-foreground" dir="auto">{task.project.name}</span>}
                        </div>
                    )}
                    {!compact && task.assignments.length > 0 && (
                        <div className="mt-2 flex -space-x-1" aria-label="Assignees">
                            {task.assignments.slice(0, 3).map((assignment) => (
                                <Avatar key={assignment.userId} className="h-6 w-6 border border-background">
                                    <AvatarImage src={assignment.user?.image || ""} alt="" />
                                    <AvatarFallback className="text-[10px]">{getInitials(assignment.user?.name || "")}</AvatarFallback>
                                </Avatar>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
}

function GroupCount({ count }: { count: number }) {
    return <span className="text-xs font-normal text-muted-foreground">{count} loaded</span>;
}

function BoardView({ rows, groupBy }: { rows: TaskViewTask[]; groupBy?: string }) {
    const groups = groupsForRows(rows, groupBy);
    return (
        <div className="overflow-x-auto rounded-lg" aria-label="Task board">
            <div className="flex min-w-max gap-4 pb-3">
                {groups.map((group) => (
                    <section key={group.key} className="w-72 shrink-0 rounded-lg border border-border bg-muted/30 p-3" aria-labelledby={`task-group-${group.key}`}>
                        <div className="mb-3 flex items-center justify-between gap-2">
                            <h3 id={`task-group-${group.key}`} className="text-sm font-semibold" dir="auto">{group.label}</h3>
                            <GroupCount count={group.tasks.length} />
                        </div>
                        <div className="space-y-2">{group.tasks.map((task) => <TaskLink key={`${group.key}-${task.id}`} task={task} />)}</div>
                    </section>
                ))}
            </div>
        </div>
    );
}

function TableView({ rows, groupBy }: { rows: TaskViewTask[]; groupBy?: string }) {
    const groups = groupsForRows(rows, groupBy);
    return (
        <div className="space-y-2">
            <p className="text-xs text-muted-foreground md:hidden">Swipe horizontally to view all task columns.</p>
            <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-[680px] w-full text-left">
                    <caption className="sr-only">Task view results</caption>
                    <thead className="bg-muted/50"><tr>
                        <th scope="col" className="p-3 text-xs font-medium">Task</th>
                        <th scope="col" className="p-3 text-xs font-medium">Status</th>
                        <th scope="col" className="p-3 text-xs font-medium">Priority</th>
                        <th scope="col" className="p-3 text-xs font-medium">Due</th>
                        <th scope="col" className="p-3 text-xs font-medium">Assignees</th>
                        <th scope="col" className="p-3 text-xs font-medium">Project</th>
                    </tr></thead>
                    <tbody>
                        {groups.map((group) => <React.Fragment key={group.key}>
                            {groupBy && groupBy !== "none" && <tr className="border-t border-border bg-muted/20"><th scope="rowgroup" colSpan={6} className="p-2 text-xs font-semibold" dir="auto"><span>{group.label}</span><span className="ml-2"><GroupCount count={group.tasks.length} /></span></th></tr>}
                            {group.tasks.map((task) => {
                                const dueAt = taskDate(task);
                                return <tr key={`${group.key}-${task.id}`} className="border-t border-border align-top hover:bg-muted/20">
                                    <td className="p-3"><TaskLink task={task} /></td>
                                    <td className="p-3"><span className={cn("rounded px-1.5 py-0.5 text-xs", statusClass(task.status as TaskStatus))}>{humanize(task.status)}</span></td>
                                    <td className="p-3"><span className={cn("rounded px-1.5 py-0.5 text-xs", priorityClass(task.priority as Priority))}>{humanize(task.priority)}</span></td>
                                    <td className="p-3 text-xs text-muted-foreground">{dueAt ? <span className={cn("rounded px-1.5 py-0.5", dueClass(dueAt))}>{formatInTimeZone(dueAt, DEFAULT_TIME_ZONE, "MMM d, yyyy")}</span> : "No due date"}</td>
                                    <td className="p-3 text-xs" dir="auto">{task.assignments.length > 0 ? task.assignments.map((assignment) => assignment.user?.name || assignment.userId).join(", ") : "Unassigned"}</td>
                                    <td className="p-3 text-xs text-muted-foreground" dir="auto">{task.project?.name || "No project"}</td>
                                </tr>;
                            })}
                        </React.Fragment>)}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function calendarParts(value: Date): { year: number; month: number; label: string } {
    return {
        year: Number(formatInTimeZone(value, DEFAULT_TIME_ZONE, "yyyy")),
        month: Number(formatInTimeZone(value, DEFAULT_TIME_ZONE, "M")) - 1,
        label: formatInTimeZone(value, DEFAULT_TIME_ZONE, "LLLL yyyy"),
    };
}

function CalendarView({ rows, groupBy, currentDate, setCurrentDate }: { rows: TaskViewTask[]; groupBy?: string; currentDate: Date; setCurrentDate: (next: Date) => void }) {
    const { year, month, label } = calendarParts(currentDate);
    const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const days = Array.from({ length: 42 }, (_, index) => {
        const day = index - firstDay + 1;
        return day > 0 && day <= daysInMonth ? day : null;
    });
    const groups = groupsForRows(rows, groupBy);
    const tasksForDay = (day: number) => {
        const datePart = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        return rows.filter((task) => {
            const dueAt = taskDate(task);
            return dueAt ? formatInTimeZone(dueAt, DEFAULT_TIME_ZONE, "yyyy-MM-dd") === datePart : false;
        });
    };
    const shiftMonth = (delta: number) => setCurrentDate(new Date(Date.UTC(year, month + delta, 1, 12)));

    return (
        <div className="space-y-3 rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
                <div className="flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" /><h3 className="font-semibold" aria-live="polite">{label}</h3></div>
                <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => shiftMonth(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
                    <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => shiftMonth(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
                </div>
            </div>
            {groupBy && groupBy !== "none" && <div className="flex flex-wrap gap-2 px-3" aria-label="Loaded group counts">{groups.map((group) => <Badge key={group.key} variant="secondary">{group.label}: {group.tasks.length} loaded</Badge>)}</div>}
            <div className="grid grid-cols-7 border-y border-border bg-muted/30" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="border-r border-border p-2 text-center text-xs font-medium last:border-r-0">{day}</div>)}</div>
            <div className="grid grid-cols-7">{days.map((day, index) => <div key={index} className="min-h-[100px] border-b border-r border-border p-1 last:border-r-0" aria-label={day ? `${label} ${day}` : undefined}>
                {day && <><div className="px-1 text-xs font-semibold text-muted-foreground">{day}</div><div className="mt-1 space-y-1">{tasksForDay(day).map((task) => <TaskLink key={task.id} task={task} compact />)}</div></>}
            </div>)}</div>
        </div>
    );
}

export function TaskViewBlock({ block, userId, color, filterConflict = null }: TaskViewBlockProps) {
    void userId;
    const [rows, setRows] = useState<TaskViewTask[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [nextOffset, setNextOffset] = useState<number | null>(null);
    const [loadState, setLoadState] = useState<LoadState>("loading");
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);
    const [retryToken, setRetryToken] = useState(0);
    const [currentDate, setCurrentDate] = useState(new Date());
    const generation = useRef(0);
    const loadMoreController = useRef<AbortController | null>(null);
    const viewType = block.viewType || "board";
    const unsupported = viewType === "gallery" || viewType === "timeline";
    const projectSetupRequired = block.projectSelectionRequired === true && !configuredProject(block);
    const queryUrl = useMemo(() => buildViewTaskUrl(block, 0), [block]);

    useEffect(() => {
        const controller = new AbortController();
        const currentGeneration = ++generation.current;
        loadMoreController.current?.abort();
        loadMoreController.current = null;
        setLoadingMore(false);
        setRows([]);
        setTotalCount(0);
        setNextOffset(null);
        setLoadMoreError(null);
        setLoadError(null);

        if (unsupported || projectSetupRequired || filterConflict) {
            setLoadState("ready");
            return () => {
                controller.abort();
                loadMoreController.current?.abort();
                loadMoreController.current = null;
            };
        }

        setLoadState("loading");
        void requestPage(queryUrl, controller.signal).then((result) => {
            if (controller.signal.aborted || generation.current !== currentGeneration) return;
            setRows(result.rows);
            setTotalCount(result.totalCount);
            setNextOffset(result.nextOffset);
            setLoadState("ready");
        }).catch((error: unknown) => {
            if (controller.signal.aborted || generation.current !== currentGeneration) return;
            setLoadState("error");
            setLoadError(error instanceof Error ? error.message : "The task view request failed.");
        });

        return () => {
            controller.abort();
            loadMoreController.current?.abort();
            loadMoreController.current = null;
            setLoadingMore(false);
        };
    }, [filterConflict, projectSetupRequired, queryUrl, retryToken, unsupported]);

    const loadMore = useCallback(async () => {
        if (nextOffset === null || loadingMore || loadState !== "ready") return;
        const currentGeneration = generation.current;
        const controller = new AbortController();
        loadMoreController.current = controller;
        setLoadingMore(true);
        setLoadMoreError(null);
        try {
            const result = await requestPage(buildViewTaskUrl(block, nextOffset), controller.signal);
            if (controller.signal.aborted || generation.current !== currentGeneration) return;
            setRows((previous) => uniqueTasks([...previous, ...result.rows]));
            setTotalCount(result.totalCount);
            setNextOffset(result.nextOffset);
        } catch (error: unknown) {
            if (!controller.signal.aborted && generation.current === currentGeneration) setLoadMoreError(error instanceof Error ? error.message : "The task view request failed.");
        } finally {
            if (loadMoreController.current === controller) {
                loadMoreController.current = null;
                setLoadingMore(false);
            }
        }
    }, [block, loadState, loadingMore, nextOffset]);

    const groupBy = typeof block.groupBy === "string"
        ? block.groupBy
        : typeof block.filters?.groupBy === "string" ? block.filters.groupBy : undefined;
    const loadedLabel = `${rows.length} loaded of ${totalCount} matching tasks`;
    const commonProps = { rows, groupBy };

    if (unsupported) return <div role="status" className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">This saved task view uses the legacy <strong>{viewType}</strong> presentation, which is unsupported. Choose Board, Table, or Calendar in the editor to migrate it.</div>;
    if (projectSetupRequired) return <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground">Setup required: choose a project in the task-view editor before this Project War Room block can show tasks.</div>;
    if (filterConflict) return <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground">{filterConflict}</div>;

    return (
        <section className="space-y-4" data-task-view-color={color} aria-label="Task view">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-medium tabular-nums text-muted-foreground" aria-live="polite">{loadedLabel}</p>
                {loadState === "ready" && rows.length > 0 && nextOffset !== null && <Button type="button" variant="outline" className="min-h-11" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{loadingMore ? "Loading more…" : "Load more"}</Button>}
            </div>
            {loadState === "loading" && <div role="status" aria-live="polite" className="rounded-lg border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">Loading tasks…</div>}
            {loadState === "error" && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"><p>Could not load tasks. {loadError}</p><Button type="button" variant="outline" className="mt-3 min-h-11" onClick={() => setRetryToken((value) => value + 1)}>Retry</Button></div>}
            {loadState === "ready" && rows.length === 0 && <div role="status" aria-live="polite" className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">No tasks match these filters.</div>}
            {loadState === "ready" && rows.length > 0 && (viewType === "table" ? <TableView {...commonProps} /> : viewType === "calendar" ? <CalendarView {...commonProps} currentDate={currentDate} setCurrentDate={setCurrentDate} /> : <BoardView {...commonProps} />)}
            {loadMoreError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"><span>Could not load more tasks. {loadMoreError}</span><Button type="button" variant="outline" className="min-h-11" onClick={() => void loadMore()}>Retry load more</Button></div>}
        </section>
    );
}
