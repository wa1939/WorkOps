"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw } from "lucide-react";
import { ReassignPanel, type HeatCellTask, type MoveTarget } from "@/components/team/reassign-panel";
import type { WorkloadBreakdownProps, WorkloadBreakdownState } from "@/components/team/workload-breakdown";

export interface HeatWeek {
    weekStart: string;
    label: string;
}

export interface HeatCell {
    loadPercent: number;
    onLeave: boolean;
    tasks: HeatCellTask[];
    drivers?: { title: string; hours: number; source: string }[];
    plannedHours?: number;
    availableHours?: number;
    capacityHours?: number;
    state?: WorkloadBreakdownState;
    unknownTaskCount?: number | null;
    backlogCount?: number | null;
    confidence?: string | null;
    computedAt?: string | null;
}

export interface HeatUser {
    id: string;
    name: string;
    /** weekStart ISO → projected workload and contributing tasks */
    cells: Record<string, HeatCell>;
}

interface CapacityHeatmapProps {
    weeks: HeatWeek[];
    users: HeatUser[];
    canManage: boolean;
    hasData: boolean;
}

function tint(pct: number): string {
    if (pct > 100) return "bg-red-500/20 text-red-600 dark:text-red-400";
    if (pct > 85) return "bg-orange-500/15 text-orange-600 dark:text-orange-400";
    if (pct >= 60) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
    if (pct > 0) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    return "text-muted-foreground/40";
}

function stateForCell(cell: HeatCell | undefined): WorkloadBreakdownState {
    const percent = cell?.loadPercent ?? 0;
    if (cell?.state) return cell.state;
    if (cell?.capacityHours === 0 || (cell?.capacityHours == null && percent === 200)) return "no-capacity";
    if (percent > 100) return "overloaded";
    if ((cell?.unknownTaskCount ?? 0) > 0) return "unestimated";
    if (percent === 100) return "booked";
    return "available";
}

function cellLabel(cell: HeatCell | undefined, state: WorkloadBreakdownState): string {
    if (state === "no-capacity") return "No available hours";
    if (state === "unestimated") return "Estimate needed";
    const percent = cell?.loadPercent ?? 0;
    return percent > 0 ? `${percent}%` : "—";
}

function workloadForCell(user: HeatUser, weekStart: string): WorkloadBreakdownProps | undefined {
    const cell = user.cells[weekStart];
    if (!cell) return undefined;
    const state = stateForCell(cell);
    return {
        personName: user.name,
        plannedHours: cell.plannedHours ?? 0,
        availableHours: cell.availableHours ?? 0,
        percent: cell.loadPercent,
        state,
        unknownTasks: cell.unknownTaskCount ?? 0,
        backlogCount: cell.backlogCount ?? 0,
        confidence: cell.confidence,
        computedAt: cell.computedAt,
        perTask: cell.tasks
            .filter((task) => task.effortHours != null)
            .map((task) => ({ taskId: task.id, title: task.title, hours: task.effortHours! })),
    };
}

const leaveStripes =
    "bg-[length:8px_8px] bg-[linear-gradient(45deg,transparent_46%,hsl(var(--muted-foreground)/0.25)_46%,hsl(var(--muted-foreground)/0.25)_54%,transparent_54%)]";

export function CapacityHeatmap({ weeks, users, canManage, hasData }: CapacityHeatmapProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [computing, setComputing] = useState(false);
    const [panel, setPanel] = useState<{ user: HeatUser; week: HeatWeek } | null>(null);

    const compute = async () => {
        setComputing(true);
        try {
            const res = await fetch("/api/cron/team-load", { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            toast({ title: "Capacity computed", description: `${data.rowsWritten} cells updated.` });
            router.refresh();
        } catch (err) {
            toast({ variant: "destructive", title: "Compute failed", description: (err as Error).message });
        } finally {
            setComputing(false);
        }
    };

    if (!hasData) {
        return (
            <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="text-sm font-medium mb-1">No capacity snapshot yet</p>
                <p className="text-sm text-muted-foreground mb-4">
                    Compute the 4-week forward load to see who is booking up.
                </p>
                {canManage && (
                    <Button size="sm" onClick={compute} disabled={computing}>
                        {computing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Compute now
                    </Button>
                )}
            </div>
        );
    }

    // For the reassign panel: for the selected week, build sorted move targets.
    const buildTargets = (excludeUserId: string, weekStart: string): MoveTarget[] =>
        users
            .filter((u) => u.id !== excludeUserId)
            .map((u) => ({ userId: u.id, name: u.name, loadPercent: u.cells[weekStart]?.loadPercent ?? 0 }))
            .sort((a, b) => a.loadPercent - b.loadPercent);

    return (
        <div className="rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
                <h2 className="text-sm font-semibold">4-week capacity</h2>
                {canManage && (
                    <Button variant="ghost" size="sm" onClick={compute} disabled={computing} className="h-7 text-xs">
                        {computing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1.5 h-3 w-3" />}
                        Refresh
                    </Button>
                )}
            </div>
            <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                    {/* Header row */}
                    <div className="grid grid-cols-[160px_repeat(4,1fr)] border-b bg-muted/10 text-[11px] text-muted-foreground">
                        <div className="px-3 py-2 font-medium">Teammate</div>
                        {weeks.map((w) => (
                            <div key={w.weekStart} className="px-3 py-2 text-center font-medium">{w.label}</div>
                        ))}
                    </div>
                    {/* Rows */}
                    {users.map((u) => (
                        <div key={u.id} className="grid grid-cols-[160px_repeat(4,1fr)] border-b last:border-0 items-stretch">
                            <div className="px-3 py-2 text-sm truncate flex items-center">{u.name.split(" ").slice(0, 2).join(" ")}</div>
                            {weeks.map((w) => {
                                const cell = u.cells[w.weekStart];
                                const pct = cell?.loadPercent ?? 0;
                                const state = stateForCell(cell);
                                const unknownTaskCount = cell?.unknownTaskCount ?? 0;
                                const backlogCount = cell?.backlogCount ?? 0;

                                const onLeave = cell?.onLeave ?? false;
                                const clickable = canManage && (cell?.tasks.length ?? 0) > 0;
                                return (
                                    <button
                                        key={w.weekStart}
                                        type="button"
                                        disabled={!clickable}
                                        onClick={() => clickable && setPanel({ user: u, week: w })}
                                        className={cn(
                                            "px-3 py-2 text-center text-sm tabular-nums font-medium transition-colors border-l",
                                            tint(pct),
                                            onLeave && leaveStripes,
                                            clickable && "hover:ring-2 hover:ring-inset hover:ring-primary/40 cursor-pointer",
                                        )}
                                        title={[
                                            cell?.drivers?.length
                                                ? cell.drivers.map((d) => `${d.title} — ${d.hours}h${d.source === "ai" ? " (AI est)" : d.source !== "manual" ? " (est)" : ""}`).join("\n")
                                                : null,
                                            state === "no-capacity" ? "No available hours" : null,
                                            state === "unestimated" ? "Estimate needed" : null,
                                            state === "overloaded" && pct > 0 ? `${pct}%` : null,
                                            unknownTaskCount > 0 && state !== "unestimated" ? "Estimate needed" : null,
                                            backlogCount > 0 ? `Plus ${backlogCount} unscheduled backlog` : null,
                                            cell?.computedAt ? `Last updated ${cell.computedAt}` : null,
                                            onLeave ? "On leave this week" : null,
                                            clickable ? "Click to reassign work" : null,
                                        ].filter(Boolean).join("\n")}
                                    >
                                        <span>{cellLabel(cell, state)}</span>
                                        {unknownTaskCount > 0 && state !== "unestimated" && (
                                            <span className="block text-[10px] font-normal text-amber-700 dark:text-amber-400">
                                                Estimate needed
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </div>

            {panel && (
                <ReassignPanel
                    open={!!panel}
                    onOpenChange={(o) => !o && setPanel(null)}
                    userName={panel.user.name}
                    weekLabel={panel.week.label}
                    tasks={panel.user.cells[panel.week.weekStart]?.tasks ?? []}
                    targets={buildTargets(panel.user.id, panel.week.weekStart)}
                    canMove={canManage}
                    workload={workloadForCell(panel.user, panel.week.weekStart)}
                />
            )}
        </div>
    );
}
