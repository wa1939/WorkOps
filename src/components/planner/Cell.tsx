"use client";

import { memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import type { PlannerCellProps } from "./types";
import { TaskChip } from "./TaskChip";

export const Cell = memo(function Cell({
    memberId,
    memberName,
    datePart,
    day,
    gridDateParts,
    getTaskEstimateHours,
    getTaskPlannedRange,
    onEmptyCell,
    onTaskContextMenu,
    onResize,
}: PlannerCellProps) {
    const { isOver, setNodeRef } = useDroppable({
        id: `planner-cell-${memberId}-${datePart}`,
        data: { type: "cell", memberId, datePart },
    });
    const isOverCapacity = day.capacityHours > 0 && day.allocatedHours > day.capacityHours;
    const isWeekend = day.isWeekend || !gridDateParts.includes(datePart);

    function openEmptyCell(): void {
        onEmptyCell(memberId, datePart);
    }

    function handleClick(event: React.MouseEvent<HTMLDivElement>) {
        const target = event.target;
        if (target instanceof Element && target.closest("[data-planner-task-chip]")) return;
        openEmptyCell();
    }

    function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
        if (event.target instanceof Element && event.target.closest("[data-planner-task-chip]")) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openEmptyCell();
    }

    return (
        <div
            ref={setNodeRef}
            role="gridcell"
            tabIndex={0}
            aria-label={`Add task for ${memberName} on ${datePart}`}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className={cn(
                "group relative min-h-[116px] border-l border-t p-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                isWeekend && "bg-muted/45",
                day.isTimeOff && "bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0px,hsl(var(--muted))_5px,hsl(var(--muted-foreground)/.12)_5px,hsl(var(--muted-foreground)/.12)_7px)]",
                isOverCapacity && "bg-destructive/10",
                isOver && "ring-2 ring-inset ring-primary/70 bg-primary/5",
            )}
        >
            <div className={cn(
                "mb-1 flex items-center justify-between gap-1 text-[10px] font-medium",
                isOverCapacity ? "text-destructive" : "text-muted-foreground",
            )}>
                <span>{day.allocatedHours.toFixed(1)}h</span>
                <span>{day.capacityHours > 0 ? `/ ${day.capacityHours.toFixed(1)}h` : "—"}</span>
            </div>
            {day.isTimeOff && (
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Time off</div>
            )}
            <div className="space-y-1">
                {day.taskChips.map((chip, index) => (
                    <TaskChip
                        key={`${chip.taskId}-${datePart}-${index}`}
                        chip={chip}
                        memberId={memberId}
                        datePart={datePart}
                        estimateHours={getTaskEstimateHours(chip.taskId)}
                        plannedRange={getTaskPlannedRange(chip.taskId)}
                        onContextMenu={onTaskContextMenu}
                        onResize={onResize}
                    />
                ))}
            </div>
            {day.taskChips.length === 0 && !day.isTimeOff && (
                <div aria-hidden="true" className="flex min-h-[58px] items-center justify-center rounded-md border border-dashed border-transparent text-[10px] text-muted-foreground/0 transition-[border-color,color] duration-150 group-hover:text-muted-foreground/60 hover:border-muted-foreground/30">
                    Add task
                </div>
            )}
        </div>
    );
});
