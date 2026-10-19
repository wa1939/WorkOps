"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
    DndContext,
    DragEndEvent,
    DragOverlay,
    DragStartEvent,
    closestCenter,
    useSensor,
    useSensors,
    PointerSensor,
    useDroppable,
} from "@dnd-kit/core";
import {
    SortableContext,
    useSortable,
    verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { TaskCardClient } from "@/components/task-card-client";
import { useToast } from "@/hooks/use-toast";

interface Task {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    type: string;
    dueAt: Date | null;
    project: { name: string } | null;
    assignments: Array<{ id: string; user: { name: string; image: string | null } }>;
    tags: Array<{ id: string; tag: { name: string; color: string } }>;
}

interface KanbanBoardProps {
    tasksByStatus: {
        TODO: Task[];
        DOING: Task[];
        BLOCKED: Task[];
        WAITING: Task[];
        DONE: Task[];
    };
}

const statusColors: Record<string, string> = {
    TODO: "bg-slate-500",
    DOING: "bg-blue-500",
    BLOCKED: "bg-red-500",
    WAITING: "bg-yellow-500",
    DONE: "bg-green-500",
};

const statusRing: Record<string, string> = {
    TODO: "ring-slate-500/20 bg-slate-500/5",
    DOING: "ring-blue-500/25 bg-blue-500/5",
    BLOCKED: "ring-red-500/25 bg-red-500/5",
    WAITING: "ring-yellow-500/25 bg-yellow-500/5",
    DONE: "ring-green-500/20 bg-green-500/5",
};

const statusLabels: Record<string, string> = {
    TODO: "To Do",
    DOING: "Doing",
    BLOCKED: "Blocked",
    WAITING: "Waiting",
    DONE: "Done",
};

function DraggableTask({ task }: { task: Task }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id: task.id,
        data: { status: task.status },
        disabled: task.type === "EXTERNAL_ACTION",
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            title={task.type === "EXTERNAL_ACTION" ? "Change external-action status from its PMO lifecycle controls" : undefined}
            className={task.type === "EXTERNAL_ACTION" ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}
        >
            <TaskCardClient task={task} />
        </div>
    );
}

function DroppableColumn({ status, tasks, onDrop }: { status: string; tasks: Task[]; onDrop: (taskId: string, newStatus: string) => void }) {
    const { setNodeRef } = useDroppable({ id: status });

    return (
        <div className="flex-1 min-w-[280px] max-w-[340px]">
            <div className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-t-lg ring-1",
                statusRing[status] || "ring-border",
            )}>
                <div className={cn("w-2 h-2 rounded-full", statusColors[status])} />
                <h3 className="font-semibold text-sm">{statusLabels[status]}</h3>
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                    {tasks.length}
                </Badge>
                {status === "TODO" && (
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 -mr-1"
                        asChild
                        title="Add task"
                    >
                        <Link href="/tasks/new">
                            <Plus className="h-3.5 w-3.5" />
                        </Link>
                    </Button>
                )}
            </div>
            <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div
                    ref={setNodeRef}
                    className={cn(
                        "kanban-column space-y-3 min-h-[400px] p-2 rounded-b-lg ring-1 ring-t-0 transition-colors",
                        statusRing[status] || "ring-border",
                    )}
                    data-status={status}
                >
                    {tasks.map((task) => (
                        <DraggableTask key={task.id} task={task} />
                    ))}
                    {tasks.length === 0 && (
                        <div className="text-center text-xs text-muted-foreground/50 py-12 italic">
                            Drop a task here
                        </div>
                    )}
                </div>
            </SortableContext>
        </div>
    );
}

export function KanbanBoard({ tasksByStatus }: KanbanBoardProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [activeTask, setActiveTask] = useState<Task | null>(null);
    const [localTasks, setLocalTasks] = useState(tasksByStatus);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const taskId = event.active.id as string;
        const allTasks = Object.values(localTasks).flat();
        const task = allTasks.find(t => t.id === taskId);
        if (task) {
            setActiveTask(task);
        }
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveTask(null);

        if (!over) return;

        const taskId = active.id as string;
        const allTasks = Object.values(localTasks).flat();
        const task = allTasks.find(t => t.id === taskId);

        if (!task) return;

        // Find the target status from the over element
        let newStatus = task.status;

        // Check if dropped over another task
        const overTask = allTasks.find(t => t.id === over.id);
        if (overTask) {
            newStatus = overTask.status;
        } else {
            // Check if dropped on a column
            const column = (over.id as string);
            if (["TODO", "DOING", "BLOCKED", "WAITING", "DONE"].includes(column)) {
                newStatus = column;
            }
        }

        if (newStatus === task.status) return;
        if (task.type === "EXTERNAL_ACTION") {
            toast({ title: "PMO action", description: "Change external-action status from its PMO lifecycle controls.", variant: "destructive" });
            return;
        }

        // Optimistic update
        const updatedTasks = { ...localTasks };
        const oldStatus = task.status as keyof typeof localTasks;
        updatedTasks[oldStatus] = updatedTasks[oldStatus].filter(t => t.id !== taskId);
        updatedTasks[newStatus as keyof typeof localTasks] = [
            ...updatedTasks[newStatus as keyof typeof localTasks],
            { ...task, status: newStatus }
        ];
        setLocalTasks(updatedTasks);

        // Update on server
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
            });

            if (res.ok) {
                router.refresh();
            } else {
                // Revert on error
                setLocalTasks(tasksByStatus);
                toast({ title: "Error", description: "Failed to update task status", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            setLocalTasks(tasksByStatus);
            toast({ title: "Error", description: "Error updating task", variant: "destructive" });
        }
    };

    const handleDrop = (taskId: string, newStatus: string) => {
        // This is handled by DragEnd
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="flex gap-6 overflow-x-auto pb-4">
                <DroppableColumn status="TODO" tasks={localTasks.TODO} onDrop={handleDrop} />
                <DroppableColumn status="DOING" tasks={localTasks.DOING} onDrop={handleDrop} />
                <DroppableColumn status="BLOCKED" tasks={localTasks.BLOCKED} onDrop={handleDrop} />
                <DroppableColumn status="WAITING" tasks={localTasks.WAITING} onDrop={handleDrop} />
                <DroppableColumn status="DONE" tasks={localTasks.DONE} onDrop={handleDrop} />
            </div>
            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
                {activeTask && (
                    <div className="rotate-3 scale-105 shadow-2xl ring-2 ring-primary/40 rounded-lg">
                        <TaskCardClient task={activeTask} />
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
}
