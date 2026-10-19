"use client";

import type { PointerEvent } from "react";
import type { TaskStatus } from "@prisma/client";
import { cn } from "@/lib/utils";
import { statusClass } from "@/lib/ui/status-tokens";
import type { InteractionMode, TimelineProject } from "./types";

const HEALTH_STATUS: Record<string, TaskStatus> = {
    ON_TRACK: "DONE",
    AT_RISK: "WAITING",
    OFF_TRACK: "BLOCKED",
    NOT_SET: "DOING",
};

function statusForProject(project: TimelineProject): TaskStatus {
    const healthStatus = HEALTH_STATUS[project.health];
    if (healthStatus) return healthStatus;

    const normalized = project.status.toLowerCase();
    if (normalized.includes("block") || normalized.includes("risk")) return "BLOCKED";
    if (normalized.includes("done") || normalized.includes("complete")) return "DONE";
    if (normalized.includes("active") || normalized.includes("progress")) return "DOING";
    return "TODO";
}

type Segment = { count: number; status: TaskStatus };

function progressSegments(project: TimelineProject): Segment[] {
    if (project.stageProgress.total > 0) {
        return [
            { count: project.stageProgress.complete, status: "DONE" },
            { count: project.stageProgress.active, status: "DOING" },
            { count: project.stageProgress.blocked, status: "BLOCKED" },
            { count: project.stageProgress.planned, status: "TODO" },
        ];
    }
    if (project.taskProgress.total > 0) {
        return [
            { count: project.taskProgress.done, status: "DONE" },
            { count: project.taskProgress.total - project.taskProgress.done, status: "TODO" },
        ];
    }
    return [];
}

type ProjectBarProps = {
    project: TimelineProject;
    left: number;
    width: number;
    preview?: boolean;
    isDragging?: boolean;
    onPointerDown: (mode: InteractionMode, event: PointerEvent<HTMLDivElement>) => void;
    onKeyboardMove?: (days: number) => void;
};

export function ProjectBar({
    project,
    left,
    width,
    preview = false,
    isDragging = false,
    onPointerDown,
    onKeyboardMove,
}: ProjectBarProps) {
    const baseStatus = statusForProject(project);
    const segments = progressSegments(project);
    const total = segments.reduce((sum, segment) => sum + Math.max(segment.count, 0), 0);
    let segmentOffset = 0;

    return (
        <div
            className={cn(
                "absolute top-1/2 h-9 -translate-y-1/2 overflow-visible rounded-md border border-border shadow-sm",
                "select-none text-xs font-medium text-foreground",
                statusClass(baseStatus),
                preview && "border-dashed border-2",
                isDragging && "z-20 shadow-lg ring-2 ring-primary/40",
            )}
            style={{ left, width: Math.max(width, 24) }}
            title={`${project.name} · ${project.health.replaceAll("_", " ")}`}
            role="button"
            tabIndex={0}
            aria-label={`Move ${project.name}`}
            aria-keyshortcuts="ArrowLeft ArrowRight"
            onPointerDown={(event) => onPointerDown("move", event)}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    onKeyboardMove?.(event.key === "ArrowLeft" ? -1 : 1);
                    return;
                }
                if (event.key === "Enter" || event.key === " ") event.preventDefault();
            }}
        >
            <div className="absolute inset-0 overflow-hidden rounded-md">
                {total > 0 && (
                    <div className="pointer-events-none absolute inset-0 z-0 opacity-75">
                        {segments.map((segment) => {
                            const count = Math.max(segment.count, 0);
                            const segmentWidth = (count / total) * 100;
                            const result = (
                                <div
                                    key={segment.status}
                                    className={cn("absolute inset-y-0", statusClass(segment.status))}
                                    style={{ left: `${segmentOffset}%`, width: `${segmentWidth}%` }}
                                />
                            );
                            segmentOffset += segmentWidth;
                            return result;
                        })}
                    </div>
                )}
                <span className="pointer-events-none absolute inset-0 z-10 flex items-center truncate px-3">
                    {project.name}
                </span>
            </div>
            <button
                type="button"
                aria-label={`Resize ${project.name} start`}
                className="absolute left-0 top-1/2 z-20 flex h-11 min-h-11 min-w-11 -translate-y-1/2 cursor-col-resize touch-none items-center justify-start bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onPointerDown={(event) => {
                    event.stopPropagation();
                    onPointerDown("resize-start", event as unknown as PointerEvent<HTMLDivElement>);
                }}
            />
            <button
                type="button"
                aria-label={`Resize ${project.name} end`}
                className="absolute right-0 top-1/2 z-20 flex h-11 min-h-11 min-w-11 -translate-y-1/2 cursor-col-resize touch-none items-center justify-end bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                onPointerDown={(event) => {
                    event.stopPropagation();
                    onPointerDown("resize-end", event as unknown as PointerEvent<HTMLDivElement>);
                }}
            />
        </div>
    );
}
