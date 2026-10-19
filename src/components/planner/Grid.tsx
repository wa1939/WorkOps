"use client";

import { useMemo } from "react";
import { closestCenter, DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemberRow } from "./MemberRow";
import { ProjectRow } from "./ProjectRow";
import { TeamTotalRow } from "./TeamTotalRow";
import type { PlannerGridProps, PlannerTaskDragData } from "./types";

export function PlannerGrid({
    data,
    range,
    dateColumns,
    projectRows,
    getTaskEstimateHours,
    getTaskPlannedRange,
    onEmptyCell,
    onTaskContextMenu,
    onDrop,
    onResize,
}: PlannerGridProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    );
    const gridTemplateColumns = range === "month"
        ? "minmax(220px, 1fr) minmax(360px, 2fr) minmax(190px, 190px)"
        : `minmax(220px, 1.1fr) repeat(${dateColumns.length}, minmax(132px, 1fr)) minmax(190px, 190px)`;
    const gridDateParts = useMemo(() => dateColumns.map((column) => column.datePart), [dateColumns]);

    function handleDragEnd(event: { active: { data: { current: unknown } }; over: { data: { current: unknown } } | null }) {
        const drag = event.active.data.current as PlannerTaskDragData | undefined;
        const overData = event.over?.data.current as { type?: string; memberId?: string; datePart?: string } | undefined;
        if (!drag || drag.type !== "task" || !overData?.memberId) return;
        if (overData.type === "cell" && overData.datePart) {
            onDrop(drag, { type: "cell", memberId: overData.memberId, datePart: overData.datePart });
        } else if (overData.type === "member") {
            onDrop(drag, { type: "member", memberId: overData.memberId });
        }
    }

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
        >
            <div className="min-w-0 overflow-auto overscroll-x-contain rounded-lg border border-border bg-card shadow-sm touch-pan-x [-webkit-overflow-scrolling:touch]" role="region" aria-label="Workload planner grid">
                <div className="min-w-[770px]">
                    <div
                        role="row"
                        className="sticky top-0 z-30 grid border-b bg-card/95 text-xs font-semibold backdrop-blur"
                        style={{ gridTemplateColumns }}
                    >
                        <div className="sticky left-0 z-30 flex h-12 items-center gap-2 border-r bg-card px-3 text-muted-foreground">
                            <Users className="h-4 w-4" />
                            <span>{range === "month" ? "Planner" : "Member"}</span>
                        </div>
                        {range === "month" ? (
                            <div className="flex h-12 items-center border-r px-4 text-muted-foreground">4-week rollup meters</div>
                        ) : dateColumns.map((column) => (
                            <div
                                key={column.datePart}
                                className={cn(
                                    "flex h-12 flex-col justify-center border-r px-3",
                                    column.isWeekend && "bg-muted/45 text-muted-foreground",
                                )}
                            >
                                <span>{column.label}</span>
                                <span className="text-[10px] font-normal text-muted-foreground">{column.weekday}</span>
                            </div>
                        ))}
                        <div className="flex h-12 min-w-[190px] shrink-0 items-center px-3 text-muted-foreground">Utilization</div>
                    </div>

                    {data.members.map((member) => (
                        <MemberRow
                            key={member.id}
                            member={member}
                            dateColumns={dateColumns}
                            gridDateParts={gridDateParts}
                            gridTemplateColumns={gridTemplateColumns}
                            range={range}
                            getTaskEstimateHours={getTaskEstimateHours}
                            getTaskPlannedRange={getTaskPlannedRange}
                            onEmptyCell={onEmptyCell}
                            onTaskContextMenu={onTaskContextMenu}
                            onResize={onResize}
                        />
                    ))}

                    {projectRows.length > 0 && (
                        <div className="border-t-2 border-primary/20 bg-muted/20">
                            <div className="flex h-9 items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                <span>Project axis</span>
                                <span className="font-normal normal-case">{projectRows.length} projects</span>
                            </div>
                            {projectRows.map((project) => (
                                <ProjectRow
                                    key={project.projectId}
                                    project={project}
                                    dateColumns={dateColumns}
                                    gridTemplateColumns={gridTemplateColumns}
                                    range={range}
                                    getTaskEstimateHours={getTaskEstimateHours}
                                    getTaskPlannedRange={getTaskPlannedRange}
                                    onTaskContextMenu={onTaskContextMenu}
                                    onResize={onResize}
                                />
                            ))}
                        </div>
                    )}

                    <TeamTotalRow
                        teamTotal={data.teamTotal}
                        dateColumns={dateColumns}
                        gridTemplateColumns={gridTemplateColumns}
                        range={range}
                    />
                </div>
            </div>
            <DragOverlay dropAnimation={null}>
                <div className="rounded-md border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold shadow-lg">
                    Move task
                </div>
            </DragOverlay>
        </DndContext>
    );
}
