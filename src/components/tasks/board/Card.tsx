"use client";

import { memo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Priority } from "@prisma/client";
import { ArrowUp } from "lucide-react";
import { dueClass, priorityClass } from "@/lib/ui/status-tokens";
import { cn, getInitials } from "@/lib/utils";
import type { BoardTask } from "./Board";

const PRIORITY_ACCENTS: Record<Priority, string> = {
    LOW: "border-l-[hsl(var(--priority-low-fg))]",
    MEDIUM: "border-l-[hsl(var(--priority-medium-fg))]",
    HIGH: "border-l-[hsl(var(--priority-high-fg))]",
    URGENT: "border-l-[hsl(var(--priority-urgent-fg))]",
};

export const Card = memo(function Card({ task }: { task: BoardTask }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: task.id,
        data: { type: "card", status: task.status },
    });

    const dueDate = task.dueDate ? new Date(task.dueDate) : null;
    const hasValidDueDate = dueDate !== null && !Number.isNaN(dueDate.getTime());
    const completedSubtasks = Math.min(
        Math.max(task.completedSubtasks, 0),
        task.subtaskCount,
    );
    const progress = task.subtaskCount > 0
        ? Math.round((completedSubtasks / task.subtaskCount) * 100)
        : 0;
    const priorityAccentClass = PRIORITY_ACCENTS[task.priority];

    return (
        <article
            ref={setNodeRef}
            style={{
                transform: CSS.Transform.toString(transform),
                transition,
            }}
            {...attributes}
            {...listeners}
            data-testid={`board-card-${task.id}`}
            className={cn(
                "rounded-lg border border-l-2 bg-card p-3 shadow-sm transition-[box-shadow,transform] duration-150",
                priorityAccentClass,
                "hover:-translate-y-px hover:shadow-sm focus-within:ring-2 focus-within:ring-ring",
                "cursor-grab active:cursor-grabbing",
                task.status === "DONE" && !isDragging && "opacity-75",
                isDragging && "opacity-50",
            )}
        >
            <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="block min-w-0">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-muted-foreground">
                        {task.taskKey ?? "No key"}
                    </span>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", priorityClass(task.priority))}>
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        {task.priority.toLowerCase()}
                    </span>
                </div>

                <h3 className="line-clamp-2 text-sm font-semibold leading-5" dir="auto">
                    {task.title}
                </h3>

                <div className="mt-3 flex min-h-6 items-center justify-between gap-2">
                    {hasValidDueDate ? (
                        <span className={cn(
                            "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-150",
                            dueClass(dueDate),
                        )}>
                            {format(dueDate, "MMM d")}
                        </span>
                    ) : (
                        <span />
                    )}

                    <div className="flex -space-x-2" aria-label="Assignees">
                        {task.assignees.length === 0 ? (
                            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed bg-background text-[10px] text-muted-foreground">
                                ?
                            </span>
                        ) : (
                            task.assignees.slice(0, 4).map((assignee) => (
                                <span
                                    key={assignee.id}
                                    className="flex h-6 w-6 overflow-hidden rounded-full border-2 border-card bg-muted text-[10px] font-medium"
                                    title={assignee.name ?? "Assignee"}
                                >
                                    {assignee.image ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={assignee.image} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="flex h-full w-full items-center justify-center">
                                            {getInitials(assignee.name ?? "")}
                                        </span>
                                    )}
                                </span>
                            ))
                        )}
                        {task.assignees.length > 4 && (
                            <span className="flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-card bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
                                +{task.assignees.length - 4}
                            </span>
                        )}
                    </div>
                </div>

                {task.subtaskCount > 0 && (
                    <div className="mt-3 flex items-center gap-2" aria-label={`${completedSubtasks} of ${task.subtaskCount} subtasks complete`}>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full rounded-full bg-primary transition-[width]"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                            {completedSubtasks}/{task.subtaskCount}
                        </span>
                    </div>
                )}
            </Link>
        </article>
    );
});

export type { Priority };
export default Card;
