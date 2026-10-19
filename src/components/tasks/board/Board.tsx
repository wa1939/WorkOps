"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    closestCorners,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { Priority, TaskStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
    canChangeStatus,
    findIncompleteDependency,
    type DependencyGuardDependency,
} from "@/lib/tasks/dependency-guard";
import { Column } from "./Column";
import { groupTasksByStatus } from "./board-grouping";

export const BOARD_STATUSES = [
    "TODO",
    "DOING",
    "BLOCKED",
    "WAITING",
    "DONE",
    "CANCELED",
] as const satisfies readonly TaskStatus[];

export type BoardAssignee = {
    id: string;
    name?: string | null;
    image?: string | null;
};

export type BoardTask = {
    id: string;
    taskKey: string | null;
    title: string;
    status: TaskStatus;
    priority: Priority;
    dueDate: string | null;
    assignees: BoardAssignee[];
    dependencies: DependencyGuardDependency[];
    subtaskCount: number;
    completedSubtasks: number;
};

type BoardResponse = {
    tasks?: unknown;
    error?: unknown;
};

type BoardProps = {
    initialTasks?: BoardTask[];
    endpoint?: string;
};

function isTaskStatus(value: unknown): value is TaskStatus {
    return typeof value === "string" && BOARD_STATUSES.includes(value as TaskStatus);
}

function statusFromDrop(over: DragEndEvent["over"]): TaskStatus | null {
    if (!over) return null;
    const dataStatus = over.data.current?.status;
    if (isTaskStatus(dataStatus)) return dataStatus;

    const overId = String(over.id);
    const columnStatus = overId.startsWith("column:") ? overId.slice("column:".length) : overId;
    return isTaskStatus(columnStatus) ? columnStatus : null;
}

function boardRequestUrl(endpoint: string): string {
    if (typeof window === "undefined") return endpoint;
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    params.delete("legacy");
    params.delete("cursor");
    const query = params.toString();
    return query ? `${endpoint}?${query}` : endpoint;
}

export function Board({ initialTasks, endpoint = "/api/tasks/board" }: BoardProps = {}) {
    const { toast } = useToast();
    const [tasks, setTasks] = useState<BoardTask[]>(initialTasks ?? []);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [loading, setLoading] = useState(initialTasks === undefined);
    const [error, setError] = useState<string | null>(null);
    const [reloadToken, setReloadToken] = useState(0);
    const moveTokensRef = useRef(new Map<string, number>());
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const tasksByStatus = useMemo(() => groupTasksByStatus(tasks, BOARD_STATUSES), [tasks]);

    useEffect(() => {
        if (initialTasks !== undefined) {
            setTasks(initialTasks);
            setLoading(false);
            setError(null);
            return;
        }

        const controller = new AbortController();
        let active = true;
        setLoading(true);
        setError(null);

        fetch(boardRequestUrl(endpoint), { cache: "no-store", signal: controller.signal })
            .then(async (response) => {
                const payload = await response.json() as BoardResponse;
                if (!response.ok) {
                    const message = typeof payload.error === "string" ? payload.error : "Failed to fetch task board";
                    throw new Error(message);
                }
                if (!Array.isArray(payload.tasks)) throw new Error("Invalid task board response");
                return payload.tasks as BoardTask[];
            })
            .then((nextTasks) => {
                if (active) setTasks(nextTasks);
            })
            .catch((requestError: unknown) => {
                if (!active || (requestError as { name?: string }).name === "AbortError") return;
                setError(requestError instanceof Error ? requestError.message : "Failed to fetch task board");
            })
            .finally(() => {
                if (active) setLoading(false);
            });

        return () => {
            active = false;
            controller.abort();
        };
    }, [endpoint, initialTasks, reloadToken]);

    const persistMove = useCallback(async (
        task: BoardTask,
        previousStatus: TaskStatus,
        nextStatus: TaskStatus,
    ) => {
        const token = (moveTokensRef.current.get(task.id) ?? 0) + 1;
        moveTokensRef.current.set(task.id, token);

        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: nextStatus }),
            });
            const payload = await response.json().catch(() => null) as BoardResponse | null;
            if (!response.ok) {
                const message = typeof payload?.error === "string" ? payload.error : "Failed to update task status";
                throw new Error(message);
            }
        } catch (requestError: unknown) {
            if (moveTokensRef.current.get(task.id) !== token) return;
            setTasks((current) => current.map((currentTask) => (
                currentTask.id === task.id
                    ? { ...currentTask, status: previousStatus }
                    : currentTask
            )));
            toast({
                title: "Could not move task",
                description: requestError instanceof Error ? requestError.message : "Failed to update task status",
                variant: "destructive",
            });
        }
    }, [toast]);

    const handleDragStart = useCallback((event: DragStartEvent) => {
        setActiveId(String(event.active.id));
    }, []);

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        setActiveId(null);
        const targetStatus = statusFromDrop(event.over);
        if (!targetStatus) return;

        const taskId = String(event.active.id);
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task || task.status === targetStatus) return;

        if (!canChangeStatus(task, task.dependencies, targetStatus)) {
            const blocker = findIncompleteDependency(task.dependencies);
            const blockerKey = blocker?.taskKey ?? blocker?.id ?? "unknown";
            toast({
                title: `blocked by incomplete dependency: ${blockerKey}`,
                variant: "destructive",
            });
            return;
        }

        const previousStatus = task.status;
        setTasks((current) => current.map((currentTask) => (
            currentTask.id === task.id
                ? { ...currentTask, status: targetStatus }
                : currentTask
        )));
        void persistMove(task, previousStatus, targetStatus);
    }, [persistMove, tasks, toast]);

    const handleDragCancel = useCallback(() => setActiveId(null), []);

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Task board</h2>
                    <p className="text-sm text-muted-foreground">Drag cards between statuses.</p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-sm tabular-nums text-muted-foreground">
                    {tasks.length} tasks
                </span>
            </div>

            {loading && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading task board">
                    {BOARD_STATUSES.map((status) => (
                        <div key={status} className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                            <div className="h-7 w-32 animate-pulse rounded-md bg-muted" />
                            <div className="h-20 animate-pulse rounded-lg bg-muted/70" />
                            <div className="h-20 animate-pulse rounded-lg bg-muted/70" />
                        </div>
                    ))}
                </div>
            )}

            {error && !loading && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
                    <p className="text-sm text-destructive">{error}</p>
                    <Button className="mt-4" variant="outline" size="sm" onClick={() => setReloadToken((token) => token + 1)}>
                        Retry
                    </Button>
                </div>
            )}
            {!loading && !error && (
                <>
                    <p className="mb-2 text-xs text-muted-foreground md:hidden">Swipe horizontally to move between status columns.</p>
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCorners}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                        onDragCancel={handleDragCancel}
                    >
                    <div className="flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain pb-4 touch-pan-x [-webkit-overflow-scrolling:touch]" role="region" aria-label="Task board columns">
                        {BOARD_STATUSES.map((status) => (
                            <Column
                                key={status}
                                status={status}
                                tasks={tasksByStatus.get(status) ?? []}
                            />
                        ))}
                    </div>
                </DndContext>
                </>
            )}

            {activeId && (
                <span className="sr-only" aria-live="polite">
                    Moving task {activeId}
                </span>
            )}
        </div>
    );
}

export default Board;
