"use client";

import { memo, useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn, getInitials } from "@/lib/utils";
import type { PlannerResizeRequest, PlannerTaskDragData } from "./types";
import { clampEstimateHours, resizePlannedDateRange, type PlannedDateRange } from "./interactions/planner-math";
import { projectColor } from "./project-color";

export { projectColor } from "./project-color";

const STATUS_MARKS: Record<string, string> = {
    TODO: "bg-[hsl(var(--status-todo-fg))]",
    DOING: "bg-[hsl(var(--status-doing-fg))]",
    BLOCKED: "bg-[hsl(var(--status-blocked-fg))]",
    WAITING: "bg-[hsl(var(--status-waiting-fg))]",
    DONE: "bg-[hsl(var(--status-done-fg))]",
    CANCELED: "bg-[hsl(var(--status-canceled-fg))]",
};

type TaskChipProps = {
    chip: PlannerTaskDragData["chip"];
    memberId: string;
    memberName?: string;
    memberImage?: string | null;
    datePart: string;
    estimateHours: number;
    plannedRange: PlannedDateRange;
    onContextMenu: (event: React.MouseEvent, taskId: string, memberId: string, datePart: string) => void;
    onResize: (request: PlannerResizeRequest) => void;
};

export const TaskChip = memo(function TaskChip({
    chip,
    memberId,
    memberName,
    memberImage,
    datePart,
    estimateHours,
    plannedRange,
    onContextMenu,
    onResize,
}: TaskChipProps) {
    const dragData: PlannerTaskDragData = {
        type: "task",
        taskId: chip.taskId,
        sourceMemberId: memberId,
        sourceDate: datePart,
        chip,
    };
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `planner-task-${chip.taskId}-${memberId}-${datePart}`,
        data: dragData,
    });
    const project = projectColor(chip.projectName);
    const statusMark = STATUS_MARKS[chip.status] ?? STATUS_MARKS.TODO;
    const activeResizeCleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => () => {
        activeResizeCleanupRef.current?.();
    }, []);

    function beginResize(
        event: React.PointerEvent<HTMLButtonElement>,
        onMove: (moveEvent: PointerEvent) => void,
        onComplete: () => void,
    ) {
        event.preventDefault();
        event.stopPropagation();
        activeResizeCleanupRef.current?.();

        const resizeTarget = event.currentTarget;
        const pointerId = event.pointerId;
        let finished = false;

        function cleanup() {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancel);
            window.removeEventListener("blur", cancel);
            resizeTarget.removeEventListener("lostpointercapture", handleLostPointerCapture);
            if (resizeTarget.hasPointerCapture?.(pointerId)) {
                resizeTarget.releasePointerCapture?.(pointerId);
            }
            if (activeResizeCleanupRef.current === cleanup) activeResizeCleanupRef.current = null;
        }

        function cancel() {
            if (finished) return;
            finished = true;
            cleanup();
        }

        function complete() {
            if (finished) return;
            finished = true;
            cleanup();
            onComplete();
        }

        function handlePointerMove(moveEvent: PointerEvent) {
            if (moveEvent.pointerId !== pointerId) return;
            onMove(moveEvent);
        }

        function handlePointerUp(upEvent: PointerEvent) {
            if (upEvent.pointerId !== pointerId) return;
            complete();
        }

        function handleLostPointerCapture() {
            cancel();
        }

        activeResizeCleanupRef.current = cleanup;
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancel);
        window.addEventListener("blur", cancel);
        resizeTarget.addEventListener("lostpointercapture", handleLostPointerCapture);
        try {
            resizeTarget.setPointerCapture(pointerId);
        } catch {
            // Pointer capture is unavailable in some test and embedded contexts.
        }
    }

    function beginEstimateResize(event: React.PointerEvent<HTMLButtonElement>) {
        const startY = event.clientY;
        const initialEstimate = estimateHours;
        let finalEstimate = initialEstimate;

        beginResize(
            event,
            (moveEvent) => {
                const deltaHours = Math.round(((startY - moveEvent.clientY) / 24) * 2) / 2;
                finalEstimate = clampEstimateHours(initialEstimate + deltaHours);
            },
            () => {
                if (finalEstimate !== initialEstimate) {
                    onResize({ kind: "estimate", taskId: chip.taskId, hours: finalEstimate });
                }
            },
        );
    }

    function beginDateResize(event: React.PointerEvent<HTMLButtonElement>, edge: "start" | "end") {
        const startX = event.clientX;
        const initialRange = plannedRange;
        let finalRange = initialRange;

        beginResize(
            event,
            (moveEvent) => {
                const deltaDays = Math.round((moveEvent.clientX - startX) / 96);
                finalRange = resizePlannedDateRange(initialRange, edge, deltaDays);
            },
            () => {
                if (
                    finalRange.plannedStartAt !== initialRange.plannedStartAt
                    || finalRange.plannedEndAt !== initialRange.plannedEndAt
                ) {
                    onResize({ kind: "date", taskId: chip.taskId, edge, range: finalRange });
                }
            },
        );
    }

    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            data-planner-task-chip="true"
            onContextMenu={(event) => onContextMenu(event, chip.taskId, memberId, datePart)}
            className={cn(
                "group relative min-h-12 cursor-grab select-none rounded-md border border-border border-l-4 bg-muted px-2 py-1.5 text-left text-foreground shadow-sm transition-[box-shadow,transform] duration-150 hover:-translate-y-px hover:shadow-sm active:cursor-grabbing",
                isDragging && "opacity-30",
            )}
            style={{
                transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
            }}
            title={`${chip.taskKey ?? "Task"}: ${chip.title} (${chip.hours.toFixed(1)}h)`}
        >
            <div className="flex items-start gap-1.5 pr-2">
                <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", statusMark)} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-foreground">
                        <span className="truncate">{chip.taskKey ?? "Unkeyed"}</span>
                        <span className="ml-auto shrink-0 rounded-md bg-background/75 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-foreground">{chip.hours.toFixed(1)}h</span>
                    </div>
                    <div className="line-clamp-2 text-xs font-medium leading-4 text-foreground">
                        {chip.title}
                    </div>
                    {chip.projectName && (
                        <div className="flex min-w-0 items-center gap-1 truncate pt-0.5 text-[10px] text-muted-foreground">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: project.dotColor }} aria-hidden="true" />
                            <span className="truncate">{chip.projectName}</span>
                        </div>
                    )}
                </div>
                {memberName && (
                    <Avatar className="h-5 w-5 shrink-0" title={memberName}>
                        <AvatarImage src={memberImage ?? ""} alt={memberName} />
                        <AvatarFallback className="text-[8px]">{getInitials(memberName)}</AvatarFallback>
                    </Avatar>
                )}
            </div>
            <button
                type="button"
                aria-label={`Resize ${chip.title} start date`}
                title="Drag to change start date"
                onPointerDown={(event) => beginDateResize(event, "start")}
                className="group/resize absolute inset-y-0 left-0 z-10 flex min-h-11 min-w-11 w-11 touch-none items-center justify-start rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
                <span className="h-[calc(100%-1rem)] w-1 rounded-full bg-primary" aria-hidden="true" />
            </button>
            <button
                type="button"
                aria-label={`Resize ${chip.title} end date`}
                title="Drag to change end date"
                onPointerDown={(event) => beginDateResize(event, "end")}
                className="group/resize absolute inset-y-0 right-0 z-10 flex min-h-11 min-w-11 w-11 touch-none items-center justify-end rounded-md opacity-0 transition-opacity duration-150 group-hover:opacity-70 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
                <span className="h-[calc(100%-1rem)] w-1 rounded-full bg-primary" aria-hidden="true" />
            </button>
            <button
                type="button"
                aria-label={`Resize ${chip.title} estimate`}
                title="Drag to change estimate by 0.5 hours"
                onPointerDown={beginEstimateResize}
                className="group/resize absolute bottom-0 left-1/2 z-10 flex h-11 min-h-11 w-11 min-w-11 -translate-x-1/2 translate-y-1/2 touch-none items-center justify-center rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
                <span className="flex h-2 w-8 items-center justify-center rounded-full bg-muted-foreground/50 hover:bg-primary" aria-hidden="true">
                    <GripVertical className="h-2.5 w-2.5 rotate-90 text-primary-foreground" />
                </span>
            </button>
        </div>
    );
});
