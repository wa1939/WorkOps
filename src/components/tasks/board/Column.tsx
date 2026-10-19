"use client";

import { useDroppable } from "@dnd-kit/core";
import {
    SortableContext,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TaskStatus } from "@prisma/client";
import { CheckCircle2, Circle, Clock3, Inbox, PauseCircle, XCircle, type LucideIcon } from "lucide-react";
import { statusClass } from "@/lib/ui/status-tokens";
import { cn } from "@/lib/utils";
import { Card } from "./Card";
import type { BoardTask } from "./Board";

const STATUS_LABELS: Record<TaskStatus, string> = {
    TODO: "To do",
    DOING: "In progress",
    BLOCKED: "Blocked",
    WAITING: "Waiting",
    DONE: "Done",
    CANCELED: "Canceled",
};

const STATUS_ICONS: Record<TaskStatus, LucideIcon> = {
    TODO: Circle,
    DOING: Clock3,
    BLOCKED: PauseCircle,
    WAITING: Clock3,
    DONE: CheckCircle2,
    CANCELED: XCircle,
};

export function Column({ status, tasks }: { status: TaskStatus; tasks: BoardTask[] }) {
    const { isOver, setNodeRef } = useDroppable({
        id: `column:${status}`,
        data: { type: "column", status },
    });
    const StatusIcon = STATUS_ICONS[status];

    return (
        <section
            ref={setNodeRef}
            aria-label={`${STATUS_LABELS[status]} tasks`}
            className={cn(
                "flex min-h-[18rem] min-w-[min(86vw,22rem)] shrink-0 snap-start flex-col rounded-lg border bg-muted/30 p-3 transition-[background-color,border-color,box-shadow] duration-150",
                "md:min-w-0",
                isOver && "border-primary/60 bg-primary/5 ring-2 ring-primary/20",
            )}
        >
            <header className="mb-3 flex items-center justify-between gap-2 rounded-md px-2 py-1.5">
                <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", statusClass(status))}>
                        <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{STATUS_LABELS[status]}</span>
                    </span>
                </div>
                <span className="shrink-0 rounded-full bg-background/70 px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {tasks.length} WIP
                </span>
            </header>

            <SortableContext
                items={tasks.map((task) => task.id)}
                strategy={verticalListSortingStrategy}
            >
                <div className="flex flex-1 flex-col gap-2">
                    {tasks.length > 0 ? (
                        tasks.map((task) => <Card key={task.id} task={task} />)
                    ) : (
                        <div className="flex min-h-24 flex-1 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-3 text-center">
                            <span className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                <Inbox className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <span className="text-xs font-medium">Ready for tasks</span>
                            <span className="text-[11px] text-muted-foreground">Drop tasks here</span>
                        </div>
                    )}
                </div>
            </SortableContext>
        </section>
    );
}

export default Column;
