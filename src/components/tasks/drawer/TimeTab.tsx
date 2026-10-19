"use client";

import { useCallback, useEffect, useState } from "react";
import { elapsedMinutes } from "@/lib/time/tracker";

const TIMER_CHANGED_EVENT = "departmenthub:timer-changed";

type ActiveTimer = {
    taskId: string;
    startedAt: string;
};

type TimeLog = {
    id: string;
    taskId: string;
    userId: string;
    startedAt: string;
    minutes: number;
    note: string | null;
    source: string;
    createdAt: string;
    user: { id: string; name: string; email: string; image: string | null };
};

function minutesLabel(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function timeLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(date);
}

export interface TimeTabProps {
    taskId: string;
}

export function TimeTab({ taskId }: TimeTabProps) {
    const [logs, setLogs] = useState<TimeLog[]>([]);
    const [totalMinutes, setTotalMinutes] = useState(0);
    const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [minutes, setMinutes] = useState("30");
    const [note, setNote] = useState("");
    const [loading, setLoading] = useState(true);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const refresh = useCallback(async (signal?: AbortSignal) => {
        try {
            const [logsResponse, timerResponse] = await Promise.all([
                fetch(`/api/tasks/${encodeURIComponent(taskId)}/time-logs`, { cache: "no-store", signal }),
                fetch("/api/users/me/active-timer", { cache: "no-store", signal }),
            ]);
            const logsBody = (await logsResponse.json().catch(() => null)) as { logs?: TimeLog[]; totalMinutes?: number } | null;
            const timerBody = (await timerResponse.json().catch(() => null)) as ActiveTimer | null;
            if (!logsResponse.ok) throw new Error("Could not load time logs");
            if (!timerResponse.ok) throw new Error("Could not load active timer");
            setLogs(logsBody?.logs ?? []);
            setTotalMinutes(logsBody?.totalMinutes ?? 0);
            setActiveTimer(timerBody?.taskId === taskId ? timerBody : null);
            setError(null);
        } catch (cause) {
            if (cause instanceof DOMException && cause.name === "AbortError") return;
            setError(cause instanceof Error ? cause.message : "Could not load time tracking");
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [taskId]);

    useEffect(() => {
        const controller = new AbortController();
        void refresh(controller.signal);
        const interval = window.setInterval(() => void refresh(), 15_000);
        const onTimerChanged = () => void refresh();
        window.addEventListener(TIMER_CHANGED_EVENT, onTimerChanged);
        return () => {
            controller.abort();
            window.clearInterval(interval);
            window.removeEventListener(TIMER_CHANGED_EVENT, onTimerChanged);
        };
    }, [refresh]);

    useEffect(() => {
        if (!activeTimer) {
            setElapsed(0);
            return;
        }
        const update = () => setElapsed(elapsedMinutes(activeTimer.startedAt, new Date()));
        update();
        const interval = window.setInterval(update, 1_000);
        return () => window.clearInterval(interval);
    }, [activeTimer]);

    const toggleTimer = async () => {
        setPending(true);
        setMessage(null);
        try {
            const action = activeTimer ? "stop" : "start";
            const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/timer`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const body = (await response.json().catch(() => null)) as { stoppedLog?: { minutes: number } | null } | null;
            if (!response.ok) throw new Error("Could not update timer");
            setMessage(action === "start" && body?.stoppedLog ? "The previous timer was stopped and logged." : action === "start" ? "Timer started." : "Timer stopped.");
            await refresh();
            if (typeof window !== "undefined") window.dispatchEvent(new Event(TIMER_CHANGED_EVENT));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not update timer");
        } finally {
            setPending(false);
        }
    };

    const addManualLog = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setPending(true);
        setMessage(null);
        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/time-logs`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ minutes: Number(minutes), note }),
            });
            if (!response.ok) throw new Error("Could not add time log");
            setMinutes("30");
            setNote("");
            setMessage("Time log added.");
            await refresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not add time log");
        } finally {
            setPending(false);
        }
    };

    return (
        <div className="space-y-5">
            <div className="rounded-lg border border-border/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-sm font-medium">Timer</p>
                        <p className="text-xs text-muted-foreground">
                            {activeTimer ? `Running for ${minutesLabel(elapsed)}` : "No active timer for this task"}
                        </p>
                    </div>
                    <button
                        type="button"
                        disabled={pending}
                        onClick={() => void toggleTimer()}
                        className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-60"
                    >
                        {activeTimer ? "Stop timer" : "Start timer"}
                    </button>
                </div>
            </div>

            {message && <p className="text-xs text-muted-foreground" role="status">{message}</p>}
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

            <section aria-labelledby="today-time-heading" className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 id="today-time-heading" className="text-sm font-medium">Today</h3>
                    <span className="text-sm font-semibold tabular-nums">{minutesLabel(totalMinutes)}</span>
                </div>
                {loading && <p className="text-xs text-muted-foreground">Loading time logs…</p>}
                {!loading && logs.length === 0 && <p className="rounded-md border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">No time logged today.</p>}
                {logs.length > 0 && (
                    <ul className="divide-y divide-border rounded-md border border-border/70">
                        {logs.map((log) => (
                            <li key={log.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                                <div className="min-w-0">
                                    <p className="truncate text-foreground">{log.note || "Time logged"}</p>
                                    <p className="text-xs text-muted-foreground">{log.user.name || log.user.email} · {timeLabel(log.startedAt)} · {log.source}</p>
                                </div>
                                <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{minutesLabel(log.minutes)}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <form onSubmit={(event) => void addManualLog(event)} className="space-y-3 rounded-lg border border-border/70 p-4">
                <div>
                    <h3 className="text-sm font-medium">Add time manually</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Record time spent without starting a timer.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                    <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        <span>Minutes</span>
                        <input
                            type="number"
                            min={1}
                            max={1440}
                            required
                            value={minutes}
                            onChange={(event) => setMinutes(event.target.value)}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                        />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-muted-foreground">
                        <span>Note</span>
                        <input
                            type="text"
                            maxLength={2000}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="What did you work on?"
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                        />
                    </label>
                </div>
                <button
                    type="submit"
                    disabled={pending}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-wait disabled:opacity-60"
                >
                    Add log
                </button>
            </form>
        </div>
    );
}
