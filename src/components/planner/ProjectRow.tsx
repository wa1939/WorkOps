"use client";

import { FolderKanban } from "lucide-react";
import { cn } from "@/lib/utils";
import { isWeekendDate } from "./range-utils";
import { TaskChip } from "./TaskChip";
import type { PlannerProjectDisplayRow, PlannerResizeRequest } from "./types";
import type { PlannedDateRange } from "./interactions/planner-math";
import type { PlannerRange } from "./range-utils";

function allocatedHours(project: PlannerProjectDisplayRow): number {
    return project.days.reduce((sum, day) => sum + day.allocatedHours, 0);
}

export type ProjectRowProps = {
    project: PlannerProjectDisplayRow;
    dateColumns: { datePart: string; label: string; weekday: string; isWeekend: boolean }[];
    gridTemplateColumns: string;
    range: PlannerRange;
    getTaskEstimateHours: (taskId: string) => number;
    getTaskPlannedRange: (taskId: string) => PlannedDateRange;
    onTaskContextMenu: (event: React.MouseEvent, taskId: string, memberId: string, datePart: string) => void;
    onResize: (request: PlannerResizeRequest) => void;
};

function projectDay(project: PlannerProjectDisplayRow, datePart: string): number {
    return project.days.find((day) => day.datePart === datePart)?.allocatedHours ?? 0;
}

export function ProjectRow({
    project,
    dateColumns,
    gridTemplateColumns,
    range,
    getTaskEstimateHours,
    getTaskPlannedRange,
    onTaskContextMenu,
    onResize,
}: ProjectRowProps) {
    const total = allocatedHours(project);

    return (
        <div role="row" className="grid border-b transition-colors duration-150 last:border-b-0 hover:bg-muted/20" style={{ gridTemplateColumns }}>
            <div className="sticky left-0 z-10 flex min-h-[116px] items-start gap-3 border-t bg-card px-3 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FolderKanban className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{project.projectName}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">{total.toFixed(1)}h in range</div>
                </div>
            </div>

            {range === "month" ? (
                <div className="flex min-h-[116px] items-center border-l border-t px-4 py-3">
                    <div className="w-full">
                        <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                            <span>4-week rollup</span>
                            <span>{total.toFixed(1)}h</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, total * 4)}%` }} />
                        </div>
                    </div>
                </div>
            ) : dateColumns.map((column) => {
                const chips = project.chipsByDate[column.datePart] ?? [];
                const hours = projectDay(project, column.datePart);
                return (
                    <div
                        key={`${project.projectId}-${column.datePart}`}
                        role="gridcell"
                        className={cn(
                            "min-h-[116px] border-l border-t p-1.5",
                            (column.isWeekend || isWeekendDate(column.datePart)) && "bg-muted/45",
                        )}
                    >
                        <div className="mb-1 text-[10px] font-medium text-muted-foreground">{hours.toFixed(1)}h</div>
                        <div className="space-y-1">
                            {chips.map((chip, index) => (
                                <TaskChip
                                    key={`${chip.taskId}-${chip.memberId}-${column.datePart}-${index}`}
                                    chip={chip}
                                    memberId={chip.memberId}
                                    memberName={chip.memberName}
                                    memberImage={chip.memberImage}
                                    datePart={column.datePart}
                                    estimateHours={getTaskEstimateHours(chip.taskId)}
                                    plannedRange={getTaskPlannedRange(chip.taskId)}
                                    onContextMenu={onTaskContextMenu}
                                    onResize={onResize}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}

            <div className="flex min-h-[116px] items-center border-l border-t bg-card px-3">
                <div className="text-xs text-muted-foreground">
                    <div className="font-semibold text-foreground">{total.toFixed(1)}h</div>
                    <div>project load</div>
                </div>
            </div>
        </div>
    );
}
