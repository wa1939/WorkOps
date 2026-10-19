"use client";

import { useDroppable } from "@dnd-kit/core";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";
import type { PlannerMember, PlannerMemberDay } from "@/lib/workload/planner-read-model";
import { Cell } from "./Cell";
import type { PlannerMemberRowProps } from "./types";

function stateColor(state: PlannerMember["state"]): string {
    if (state === "overloaded") return "bg-[hsl(var(--status-blocked-fg))]";
    if (state === "booked") return "bg-[hsl(var(--status-waiting-fg))]";
    return "bg-[hsl(var(--status-done-fg))]";
}

function stateTextColor(state: PlannerMember["state"]): string {
    if (state === "overloaded") return "text-[hsl(var(--status-blocked-fg))]";
    if (state === "booked") return "text-[hsl(var(--status-waiting-fg))]";
    return "text-[hsl(var(--status-done-fg))]";
}

function utilizationColor(percent: number | null, state: PlannerMember["state"]): string {
    if (percent != null && percent > 100) return "bg-[hsl(var(--status-blocked-fg))]";
    if (percent != null && percent >= 80) return "bg-[hsl(var(--status-waiting-fg))]";
    if (percent != null) return "bg-[hsl(var(--status-done-fg))]";
    return stateColor(state);
}

function totalHours(member: PlannerMember): { capacity: number; allocated: number } {
    return member.days.reduce(
        (totals, day) => ({
            capacity: totals.capacity + day.capacityHours,
            allocated: totals.allocated + day.allocatedHours,
        }),
        { capacity: 0, allocated: 0 },
    );
}

export function UtilizationMeter({ member }: { member: PlannerMember }) {
    const totals = totalHours(member);
    const percent = member.periodUtilizationPercent;
    const balance = totals.capacity - totals.allocated;
    const balanceLabel = balance >= 0 ? `${balance.toFixed(1)}h free` : `${Math.abs(balance).toFixed(1)}h over`;
    const normalizedPercent = Math.max(0, Math.min(percent ?? 0, 100));

    return (
        <div className="min-w-[150px] px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className={cn("font-semibold", stateTextColor(member.state))}>
                    {percent == null ? "—" : `${Math.round(percent)}%`}
                </span>
                <span className="text-muted-foreground">{balanceLabel}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`${percent ?? 0}% utilized`}>
                <div
                    className={cn("h-full rounded-full transition-[width] duration-200", utilizationColor(percent, member.state))}
                    style={{ width: `${normalizedPercent}%` }}
                />
            </div>
        </div>
    );
}

function emptyDay(datePart: string): PlannerMemberDay {
    return {
        datePart,
        capacityHours: 0,
        allocatedHours: 0,
        availableHours: 0,
        utilizationPercent: null,
        isTimeOff: false,
        isWeekend: false,
        taskChips: [],
    };
}

export function MemberRow({
    member,
    dateColumns,
    gridDateParts,
    gridTemplateColumns,
    range,
    getTaskEstimateHours,
    getTaskPlannedRange,
    onEmptyCell,
    onTaskContextMenu,
    onResize,
}: PlannerMemberRowProps) {
    const { isOver, setNodeRef } = useDroppable({
        id: `planner-member-${member.id}`,
        data: { type: "member", memberId: member.id },
    });

    return (
        <div
            ref={setNodeRef}
            role="row"
            className={cn("grid border-b last:border-b-0 transition-colors duration-150", isOver && "bg-primary/5")}
            style={{ gridTemplateColumns }}
        >
            <div className="sticky left-0 z-10 flex min-h-[116px] items-start gap-3 border-t bg-card px-3 py-3">
                <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage src={member.image ?? ""} alt={member.name} />
                    <AvatarFallback className="text-xs">{getInitials(member.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{member.name}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className={cn("h-1.5 w-1.5 rounded-full", stateColor(member.state))} />
                        <span className="capitalize">{member.state}</span>
                    </div>
                </div>
            </div>

            {range === "month" ? (
                <div className="flex min-h-[116px] items-center border-l border-t px-4 py-3">
                    <div className="w-full">
                        <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>4-week rollup</span>
                            <span>{totalHours(member).allocated.toFixed(1)}h allocated</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-muted">
                            <div
                                className={cn("h-full rounded-full transition-[width] duration-200", utilizationColor(member.periodUtilizationPercent, member.state))}
                                style={{ width: `${Math.max(0, Math.min(member.periodUtilizationPercent ?? 0, 100))}%` }}
                            />
                        </div>
                    </div>
                </div>
            ) : dateColumns.map((column) => {
                const day = member.days.find((candidate) => candidate.datePart === column.datePart) ?? emptyDay(column.datePart);
                return (
                    <Cell
                        key={`${member.id}-${column.datePart}`}
                        memberId={member.id}
                        memberName={member.name}
                        datePart={column.datePart}
                        day={day}
                        gridDateParts={gridDateParts}
                        getTaskEstimateHours={getTaskEstimateHours}
                        getTaskPlannedRange={getTaskPlannedRange}
                        onEmptyCell={onEmptyCell}
                        onTaskContextMenu={onTaskContextMenu}
                        onResize={onResize}
                    />
                );
            })}

            <div className="flex min-h-[116px] items-center border-l border-t bg-card">
                <UtilizationMeter member={member} />
            </div>
        </div>
    );
}

export { totalHours };
