"use client";

import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PlannerDateColumn, PlannerTeamTotal } from "./types";
import type { PlannerRange } from "./range-utils";

export type TeamTotalRowProps = {
    teamTotal: PlannerTeamTotal;
    dateColumns: PlannerDateColumn[];
    gridTemplateColumns: string;
    range: PlannerRange;
};

function utilizationColor(percent: number | null): string {
    if (percent != null && percent > 100) return "bg-[hsl(var(--status-blocked-fg))]";
    if (percent != null && percent >= 80) return "bg-[hsl(var(--status-waiting-fg))]";
    return "bg-[hsl(var(--status-done-fg))]";
}

export function TeamTotalRow({ teamTotal, dateColumns, gridTemplateColumns, range }: TeamTotalRowProps) {
    const allocated = teamTotal.days.reduce((sum, day) => sum + day.allocatedHours, 0);
    const capacity = teamTotal.days.reduce((sum, day) => sum + (day.capacityHours ?? 0), 0);
    const percent = teamTotal.periodUtilizationPercent ?? (capacity > 0 ? (allocated / capacity) * 100 : null);
    const normalizedPercent = Math.max(0, Math.min(percent ?? 0, 100));

    return (
        <div
            role="row"
            className="sticky bottom-0 z-20 grid border-t-2 bg-card shadow-sm"
            style={{ gridTemplateColumns }}
        >
            <div className="sticky left-0 z-10 flex min-h-[72px] items-center gap-3 border-r bg-card px-3 py-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Users className="h-4 w-4" />
                </div>
                <div>
                    <div className="text-sm font-semibold">Team Total</div>
                    <div className="text-[10px] text-muted-foreground">{allocated.toFixed(1)}h allocated</div>
                </div>
            </div>

            {range === "month" ? (
                <div className="flex min-h-[72px] items-center border-r px-4">
                    <div className="w-full">
                        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                            <span>4-week rollup</span>
                            <span>{percent == null ? "—" : `${Math.round(percent)}%`}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                            <div
                                className={cn("h-full rounded-full transition-[width] duration-200", utilizationColor(percent))}
                                style={{ width: `${normalizedPercent}%` }}
                            />
                        </div>
                    </div>
                </div>
            ) : dateColumns.map((column) => {
                const day = teamTotal.days.find((candidate) => candidate.datePart === column.datePart);
                const dayAllocated = day?.allocatedHours ?? 0;
                const dayCapacity = day?.capacityHours ?? 0;
                const over = dayCapacity > 0 && dayAllocated > dayCapacity;
                return (
                    <div
                        key={`team-total-${column.datePart}`}
                        className={cn(
                            "flex min-h-[72px] flex-col justify-center border-r px-3",
                            column.isWeekend && "bg-muted/45",
                            over && "bg-destructive/10 text-destructive",
                        )}
                    >
                        <span className="text-xs font-semibold">{dayAllocated.toFixed(1)}h</span>
                        <span className="text-[10px] text-muted-foreground">
                            {dayCapacity > 0 ? `${day?.utilizationPercent == null ? "—" : `${Math.round(day.utilizationPercent)}%`} of ${dayCapacity.toFixed(1)}h` : "No capacity"}
                        </span>
                    </div>
                );
            })}

            <div className="flex min-h-[72px] items-center px-3">
                <div>
                    <div className={cn("text-sm font-semibold", percent != null && percent > 100 ? "text-destructive" : "text-foreground")}>
                        {percent == null ? "—" : `${Math.round(percent)}%`}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                        {capacity > 0 ? `${Math.max(0, capacity - allocated).toFixed(1)}h free` : "No capacity"}
                    </div>
                </div>
            </div>
        </div>
    );
}
