"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, PencilLine, Timer, X } from "lucide-react";
import { TaskDrawer } from "@/components/tasks/drawer/TaskDrawer";
import { TaskDrawerListProvider } from "@/components/tasks/drawer/useTaskDrawer";
import { variance, type VarianceState } from "@/lib/time/variance";

export type TimeEntriesMemberOption = { id: string; name: string | null; email: string };
export type TimeEntriesProjectOption = { id: string; name: string };
export type TimeEntriesTaskOption = { id: string; taskKey: string | null; title: string };

type TimeEntry = {
    id: string;
    taskId: string;
    userId: string;
    startedAt: string;
    minutes: number;
    note: string | null;
    source: string;
    task: {
        id: string;
        taskKey: string | null;
        title: string;
        parentTaskId: string | null;
        estimateMinutes: number | null;
        project: { id: string; name: string } | null;
    };
    user: { id: string; name: string | null; email: string; image: string | null };
};

type TimeEntriesResponse = {
    logs: TimeEntry[];
    dayTotals: Record<string, number>;
    weekTotal: number;
};

type Props = {
    canFilterMembers: boolean;
    initialFrom: string;
    initialTo: string;
    initialMemberId: string;
    initialProjectId: string;
    initialTaskId: string;
    members: TimeEntriesMemberOption[];
    projects: TimeEntriesProjectOption[];
    tasks: TimeEntriesTaskOption[];
};

function parseDay(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

function dayString(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function startOfWeek(date: Date): Date {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - start.getUTCDay());
    return start;
}

function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}:${String(remainder).padStart(2, "0")}`;
}

function formatDate(value: string, options: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat("en", { timeZone: "UTC", ...options }).format(parseDay(value));
}

function formatEntryDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatDelta(hours: number, state: VarianceState): string {
    if (state === "on") return "On estimate";
    const sign = hours > 0 ? "+" : "−";
    return `${sign}${Math.abs(hours).toFixed(1)}h ${state}`;
}

function VarianceChip({ estimateMinutes, loggedMinutes }: { estimateMinutes: number; loggedMinutes: number }) {
    const result = variance(estimateMinutes, loggedMinutes);
    const style = result.state === "over"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : result.state === "under"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700"
            : "border-border bg-muted text-muted-foreground";

    return <span className={`inline-flex items-center border px-1.5 py-0.5 text-[10px] font-medium ${style}`}>{formatDelta(result.deltaHours, result.state)}</span>;
}

export function TimeEntriesClient({
    canFilterMembers,
    initialFrom,
    initialTo,
    initialMemberId,
    initialProjectId,
    initialTaskId,
    members,
    projects,
    tasks,
}: Props) {
    const [from, setFrom] = useState(initialFrom);
    const [to, setTo] = useState(initialTo);
    const [memberId, setMemberId] = useState(initialMemberId);
    const [projectId, setProjectId] = useState(initialProjectId);
    const [taskId, setTaskId] = useState(initialTaskId);
    const [data, setData] = useState<TimeEntriesResponse>({ logs: [], dayTotals: {}, weekTotal: 0 });
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const queryString = useMemo(() => {
        const params = new URLSearchParams({ from, to });
        if (canFilterMembers && memberId) params.set("userId", memberId);
        if (projectId) params.set("projectId", projectId);
        if (taskId) params.set("taskId", taskId);
        return params.toString();
    }, [canFilterMembers, from, memberId, projectId, taskId, to]);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        fetch(`/api/time-entries?${queryString}`, { cache: "no-store", signal: controller.signal })
            .then(async (response) => {
                const body = await response.json().catch(() => null) as Partial<TimeEntriesResponse> & { error?: string } | null;
                if (!response.ok) throw new Error(body?.error || "Could not load time entries");
                return body;
            })
            .then((body) => {
                setData({ logs: body?.logs ?? [], dayTotals: body?.dayTotals ?? {}, weekTotal: body?.weekTotal ?? 0 });
                setError(null);
            })
            .catch((cause: unknown) => {
                if (cause instanceof DOMException && cause.name === "AbortError") return;
                setError(cause instanceof Error ? cause.message : "Could not load time entries");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [queryString]);

    const loggedByTask = useMemo(() => {
        const totals: Record<string, number> = {};
        for (const log of data.logs) totals[log.taskId] = (totals[log.taskId] ?? 0) + log.minutes;
        return totals;
    }, [data.logs]);

    const drawerTaskIds = useMemo(() => {
        const ids: string[] = [];
        for (const log of data.logs) {
            if (!ids.includes(log.taskId)) ids.push(log.taskId);
        }
        return ids;
    }, [data.logs]);

    const shiftWeek = (amount: number) => {
        const nextFrom = parseDay(from);
        nextFrom.setUTCDate(nextFrom.getUTCDate() + amount * 7);
        const nextTo = new Date(nextFrom);
        nextTo.setUTCDate(nextTo.getUTCDate() + 7);
        setFrom(dayString(nextFrom));
        setTo(dayString(nextTo));
    };

    const goToToday = () => {
        const today = startOfWeek(new Date());
        const todayTo = new Date(today);
        todayTo.setUTCDate(todayTo.getUTCDate() + 7);
        setFrom(dayString(today));
        setTo(dayString(todayTo));
    };

    const exportEntries = async () => {
        setExporting(true);
        try {
            const payload: Record<string, string> = { from, to };
            if (canFilterMembers && memberId) payload.userId = memberId;
            if (projectId) payload.projectId = projectId;
            if (taskId) payload.taskId = taskId;
            const response = await fetch("/api/time-entries/export", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!response.ok) throw new Error("Could not export time entries");
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "time-entries.xlsx";
            anchor.click();
            URL.revokeObjectURL(url);
        } catch (cause: unknown) {
            setError(cause instanceof Error ? cause.message : "Could not export time entries");
        } finally {
            setExporting(false);
        }
    };

    const taskHref = (id: string) => {
        const params = new URLSearchParams(queryString);
        params.set("task", id);
        return `/time-entries?${params.toString()}`;
    };

    const lastDay = new Date(parseDay(to));
    lastDay.setUTCDate(lastDay.getUTCDate() - 1);
    const weekLabel = `${formatDate(from, { month: "short", day: "numeric" })} – ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(lastDay)}`;

    return (
        <TaskDrawerListProvider ids={drawerTaskIds}>
            <main className="space-y-6 p-4 md:p-6">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Time tracking</p>
                        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Time entries</h1>
                        <p className="mt-1 text-sm text-muted-foreground">Review logged work by week, member, project, or task.</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-md border bg-card p-1">
                        <button type="button" onClick={() => shiftWeek(-1)} className="inline-flex h-8 w-8 items-center justify-center rounded-sm hover:bg-accent" aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></button>
                        <button type="button" onClick={goToToday} className="h-8 px-3 text-sm font-medium hover:bg-accent">Today</button>
                        <button type="button" onClick={() => shiftWeek(1)} className="inline-flex h-8 w-8 items-center justify-center rounded-sm hover:bg-accent" aria-label="Next week"><ChevronRight className="h-4 w-4" /></button>
                    </div>
                </header>

                <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-4">
                    <div>
                        <p className="text-sm font-medium">{weekLabel}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Week total</p>
                    </div>
                    <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatDuration(data.weekTotal)} <span className="text-sm font-normal text-muted-foreground">h:mm</span></p>
                </section>

                <section aria-label="Time entry filters" className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
                    {canFilterMembers && (
                        <label className="min-w-44 space-y-1 text-xs font-medium text-muted-foreground">
                            <span>Member</span>
                            <select value={memberId} onChange={(event) => setMemberId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring">
                                <option value="">All members</option>
                                {members.map((member) => <option key={member.id} value={member.id}>{member.name || member.email}</option>)}
                            </select>
                        </label>
                    )}
                    <label className="min-w-44 space-y-1 text-xs font-medium text-muted-foreground">
                        <span>Project</span>
                        <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring">
                            <option value="">All projects</option>
                            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                        </select>
                    </label>
                    <label className="min-w-52 space-y-1 text-xs font-medium text-muted-foreground">
                        <span>Task</span>
                        <select value={taskId} onChange={(event) => setTaskId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring">
                            <option value="">All tasks</option>
                            {tasks.map((task) => <option key={task.id} value={task.id}>{task.taskKey ? `${task.taskKey} · ` : ""}{task.title}</option>)}
                        </select>
                    </label>
                    <button type="button" onClick={() => void exportEntries()} disabled={exporting || loading} className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent disabled:cursor-wait disabled:opacity-60">
                        <Download className="h-4 w-4" />
                        {exporting ? "Exporting…" : "Export XLSX"}
                    </button>
                </section>

                {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}

                <section className="overflow-hidden rounded-lg border bg-card">
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-sm">
                            <thead className="border-b bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">Task</th>
                                    <th className="px-4 py-3">Project</th>
                                    <th className="px-4 py-3">User</th>
                                    <th className="px-4 py-3 text-right">Minutes</th>
                                    <th className="px-4 py-3">Note</th>
                                    <th className="px-4 py-3">Source</th>
                                    <th className="px-4 py-3 text-right">Day subtotal</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/70">
                                {loading && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">Loading time entries…</td></tr>}
                                {!loading && data.logs.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">No time entries for this week and filter set.</td></tr>}
                                {!loading && data.logs.map((log, index) => {
                                    const day = dayString(new Date(log.startedAt));
                                    const previousDay = index > 0 ? dayString(new Date(data.logs[index - 1]?.startedAt ?? "")) : null;
                                    const isFirstForDay = day !== previousDay;
                                    const sourceIsTimer = log.source === "timer";
                                    const SourceIcon = sourceIsTimer ? Timer : PencilLine;
                                    return (
                                        <tr key={log.id} className="align-top hover:bg-muted/20">
                                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatEntryDate(log.startedAt)}</td>
                                            <td className="max-w-[280px] px-4 py-3">
                                                <Link href={taskHref(log.taskId)} className="block font-medium text-foreground hover:text-primary hover:underline">
                                                    {log.task.taskKey && <span className="mr-1 text-xs text-muted-foreground">{log.task.taskKey}</span>}
                                                    <span>{log.task.title}</span>
                                                </Link>
                                                {log.task.estimateMinutes !== null && <div className="mt-1"><VarianceChip estimateMinutes={log.task.estimateMinutes} loggedMinutes={loggedByTask[log.taskId] ?? 0} /></div>}
                                            </td>
                                            <td className="max-w-[180px] truncate px-4 py-3 text-muted-foreground">{log.task.project?.name || "—"}</td>
                                            <td className="max-w-[160px] truncate px-4 py-3">{log.user.name || log.user.email}</td>
                                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{formatDuration(log.minutes)}</td>
                                            <td className="max-w-[220px] truncate px-4 py-3 text-muted-foreground" title={log.note || undefined}>{log.note || "—"}</td>
                                            <td className="px-4 py-3 text-muted-foreground"><span className="inline-flex items-center gap-1.5" title={sourceIsTimer ? "Timer" : "Manual"}><SourceIcon className="h-4 w-4" /><span className="sr-only">{sourceIsTimer ? "Timer" : "Manual"}</span></span></td>
                                            <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums">{isFirstForDay ? formatDuration(data.dayTotals[day] ?? 0) : "—"}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </section>

                <p className="text-xs text-muted-foreground">Minutes are shown as h:mm. Task variance compares this week&apos;s logged time with the task estimate.</p>
            </main>
            <TaskDrawer />
        </TaskDrawerListProvider>
    );
}
