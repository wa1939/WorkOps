"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { elapsedMinutes } from "@/lib/time/tracker";

const TIMER_CHANGED_EVENT = "departmenthub:timer-changed";

type ActiveTimer = {
    taskId: string;
    startedAt: string;
    elapsedMinutes?: number;
};

type TimerResponse = {
    activeTimer?: ActiveTimer | null;
    log?: { minutes: number } | null;
};

function minutesLabel(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

function dispatchTimerChanged(): void {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(TIMER_CHANGED_EVENT));
}

export interface TimerCellProps {
    taskId: string;
    taskTitle?: string;
}

export function TimerCell({ taskId, taskTitle }: TimerCellProps) {
    const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
    const [elapsed, setElapsed] = useState(0);
    const [lastLoggedMinutes, setLastLoggedMinutes] = useState<number | null>(null);
    const [pending, setPending] = useState(false);

    const syncActiveTimer = useCallback(async () => {
        try {
            const response = await fetch("/api/users/me/active-timer", { cache: "no-store" });
            if (!response.ok) return;
            const body = (await response.json()) as ActiveTimer | null;
            setActiveTimer(body);
        } catch {
            // A polling failure should not make the task row unusable.
        }
    }, []);

    useEffect(() => {
        void syncActiveTimer();
        const interval = window.setInterval(() => void syncActiveTimer(), 15_000);
        const onTimerChanged = () => void syncActiveTimer();
        window.addEventListener(TIMER_CHANGED_EVENT, onTimerChanged);
        return () => {
            window.clearInterval(interval);
            window.removeEventListener(TIMER_CHANGED_EVENT, onTimerChanged);
        };
    }, [syncActiveTimer]);

    const isActive = activeTimer?.taskId === taskId;

    useEffect(() => {
        if (!isActive || !activeTimer) {
            setElapsed(0);
            return;
        }
        const update = () => setElapsed(elapsedMinutes(activeTimer.startedAt, new Date()));
        update();
        const interval = window.setInterval(update, 1_000);
        return () => window.clearInterval(interval);
    }, [activeTimer, isActive]);

    const toggleTimer = async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (pending) return;
        setPending(true);
        try {
            const action = isActive ? "stop" : "start";
            const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/timer`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ action }),
            });
            if (!response.ok) return;
            const body = (await response.json()) as TimerResponse;
            if (action === "stop") {
                setLastLoggedMinutes(body.log?.minutes ?? elapsed);
                setActiveTimer(null);
            } else {
                setLastLoggedMinutes(null);
                setActiveTimer(body.activeTimer ?? null);
            }
            dispatchTimerChanged();
        } finally {
            setPending(false);
        }
    };

    const shownMinutes = isActive ? elapsed : lastLoggedMinutes;
    const label = taskTitle ? `${isActive ? "Stop" : "Start"} timer for ${taskTitle}` : `${isActive ? "Stop" : "Start"} timer`;

    return (
        <div role="gridcell" className="flex min-w-0 items-center gap-1.5 px-2">
            <button
                type="button"
                aria-label={label}
                title={isActive ? "Stop timer" : "Start timer (stops another active timer)"}
                disabled={pending}
                onClick={toggleTimer}
                className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors after:absolute after:inset-[-8px] after:content-[''] hover:bg-accent hover:text-foreground disabled:cursor-wait disabled:opacity-50"
            >
                {isActive ? <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> : <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />}
            </button>
            {shownMinutes !== null && <span className="truncate text-xs tabular-nums text-muted-foreground">{minutesLabel(shownMinutes)}</span>}
        </div>
    );
}
