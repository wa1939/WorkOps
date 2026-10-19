"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DashboardTaskCard } from "@/components/dashboard-task-card";
import { cn } from "@/lib/utils";

export type FocusTask = {
    id: string;
    title: string;
    status: string;
    priority: string;
    type: string;
    dueAt: Date | null;
    urgencyScore: number;
    project: { name: string } | null;
    assignments: Array<{ id: string; user: { name: string; image: string | null } }>;
};

type RangeKey = "today" | "week" | "all";

const RANGES: Array<{ key: RangeKey; label: string; empty: string }> = [
    { key: "today", label: "Today", empty: "Nothing due today, and nothing overdue." },
    { key: "week", label: "This week", empty: "Nothing due in the next 7 days." },
    { key: "all", label: "All", empty: "No open tasks assigned to you." },
];

const endOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

/**
 * "Today" and "This week" both include overdue work — an overdue task is something you
 * still have to deal with today, and hiding it behind a separate filter is how it gets
 * forgotten. "All" is every open task assigned to you.
 */
export function matchesRange(dueAt: Date | string | null, range: RangeKey, now: Date): boolean {
    if (range === "all") return true;
    if (!dueAt) return false;

    const due = new Date(dueAt);
    if (due < now) return true; // overdue counts in both today and week

    const horizon = range === "today" ? endOfDay(now) : endOfDay(new Date(now.getTime() + 6 * 86400000));
    return due <= horizon;
}

export function FocusPanel({
    tasks,
    completedToday,
    dailyTarget,
}: {
    tasks: FocusTask[];
    completedToday: number;
    dailyTarget: number;
}) {
    const [range, setRange] = useState<RangeKey>("today");

    // One `now` per render keeps every range boundary consistent with the others.
    const now = useMemo(() => new Date(), []);

    const byRange = useMemo(() => {
        const sorted = [...tasks].sort((a, b) => b.urgencyScore - a.urgencyScore);
        return {
            today: sorted.filter((t) => matchesRange(t.dueAt, "today", now)),
            week: sorted.filter((t) => matchesRange(t.dueAt, "week", now)),
            all: sorted,
        } satisfies Record<RangeKey, FocusTask[]>;
    }, [tasks, now]);

    const visible = byRange[range];
    const activeRange = RANGES.find((r) => r.key === range)!;
    const dailyProgress = dailyTarget > 0 ? Math.round((completedToday / dailyTarget) * 100) : 0;

    return (
        <Card variant="elevated" className="relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/0 via-primary/60 to-primary/0" />

            <div className="px-5 pt-5 pb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <h2 className="text-lg font-semibold tracking-tight">Focus</h2>
                </div>

                <div className="flex items-center gap-2">
                    <div role="tablist" aria-label="Task range" className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
                        {RANGES.map((r) => (
                            <button
                                key={r.key}
                                type="button"
                                role="tab"
                                aria-selected={range === r.key}
                                onClick={() => setRange(r.key)}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                                    range === r.key
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground",
                                )}
                            >
                                {r.label}
                                <span className="tabular-nums text-[10px] text-muted-foreground">
                                    {byRange[r.key].length}
                                </span>
                            </button>
                        ))}
                    </div>

                    <Link
                        href="/tasks?tab=my&sort=due-asc"
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    >
                        Open list
                        <ArrowRight className="h-3 w-3" />
                    </Link>
                </div>
            </div>

            {visible.length === 0 ? (
                <div className="px-5 pb-8 pt-4 text-center">
                    <div className="inline-flex items-center justify-center h-11 w-11 rounded-full bg-emerald-500/10 mb-3">
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    </div>
                    <p className="text-sm text-muted-foreground">{activeRange.empty}</p>
                </div>
            ) : (
                // Cap the height rather than the item count so nothing is silently hidden.
                <div className="px-5 pb-5 space-y-2 max-h-[34rem] overflow-y-auto">
                    {visible.map((task) => (
                        <DashboardTaskCard key={task.id} task={task} />
                    ))}
                </div>
            )}

            <div className="border-t bg-muted/20 px-5 py-2.5 flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">Today&apos;s progress</span>
                <Progress value={dailyProgress} className="h-1.5 flex-1" />
                <span className="text-[11px] tabular-nums font-medium">
                    {completedToday}/{dailyTarget}
                </span>
            </div>
        </Card>
    );
}
