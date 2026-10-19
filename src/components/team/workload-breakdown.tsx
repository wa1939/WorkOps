import React from "react";
import { cn } from "@/lib/utils";
import type { WorkloadSummary } from "@/lib/workload/summary";

export type WorkloadBreakdownState = WorkloadSummary["state"];

export interface WorkloadBreakdownProps {
    personName: string;
    plannedHours: number;
    availableHours: number;
    percent: number | null;
    state: WorkloadBreakdownState;
    unknownTasks: number;
    backlogCount?: number;
    confidence?: string | null;
    computedAt?: string | Date | null;
    perTask?: Array<{ taskId: string; title: string; hours: number }>;
}

const stateLabels: Record<WorkloadBreakdownState, string> = {
    unestimated: "Estimate needed",
    "no-capacity": "No available hours",
    available: "Available",
    booked: "Booked",
    overloaded: "Overloaded",
};

function formatHours(hours: number): string {
    return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10);
}

function formatFreshness(value: string | Date): string {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) return "time unavailable";

    const difference = Date.now() - date.getTime();
    const absoluteDifference = Math.abs(difference);
    const units: Array<[number, string]> = [
        [24 * 60 * 60 * 1000, "day"],
        [60 * 60 * 1000, "hour"],
        [60 * 1000, "minute"],
    ];
    const unit = units.find(([size]) => absoluteDifference >= size);
    if (!unit) return "just now";

    const amount = Math.round(absoluteDifference / unit[0]);
    const label = `${amount} ${unit[1]}${amount === 1 ? "" : "s"}`;
    return difference >= 0 ? `${label} ago` : `in ${label}`;
}

export function WorkloadBreakdown({
    personName,
    plannedHours,
    availableHours,
    percent,
    state,
    unknownTasks,
    backlogCount = 0,
    confidence,
    computedAt,
    perTask = [],
}: WorkloadBreakdownProps) {
    const showPercent = percent !== null && state !== "no-capacity" && state !== "unestimated";

    return (
        <article className="rounded-lg border p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="font-medium truncate">{personName}</h3>
                    <p
                        data-testid="workload-state"
                        className={cn(
                            "text-sm font-medium",
                            state === "overloaded" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                        )}
                    >
                        {stateLabels[state]}
                        {showPercent && <span className="text-muted-foreground"> · {percent}%</span>}
                    </p>
                </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                    <dt className="text-xs text-muted-foreground">Planned</dt>
                    <dd className="font-medium tabular-nums">{formatHours(plannedHours)}h</dd>
                </div>
                <div>
                    <dt className="text-xs text-muted-foreground">Available</dt>
                    <dd className="font-medium tabular-nums">{formatHours(availableHours)}h</dd>
                </div>
            </dl>

            {unknownTasks > 0 && (
                <p data-testid="estimate-warning" className="text-sm text-amber-700 dark:text-amber-400">
                    Estimate needed for {unknownTasks} task{unknownTasks === 1 ? "" : "s"}.
                </p>
            )}

            {backlogCount > 0 && (
                <p data-testid="backlog-note" className="text-sm text-muted-foreground">
                    Plus {backlogCount} unscheduled backlog
                </p>
            )}

            {computedAt != null && (
                <p data-testid="freshness" className="text-xs text-muted-foreground">
                    Last updated {formatFreshness(computedAt)}
                    {confidence != null && <> · Confidence {confidence}</>}
                </p>
            )}

            {perTask.length > 0 && (
                <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Work breakdown</p>
                    <ul className="space-y-1">
                        {perTask.map((task) => (
                            <li key={task.taskId} className="flex items-center justify-between gap-3 text-sm">
                                <span className="truncate">{task.title}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">{formatHours(task.hours)}h</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </article>
    );
}
