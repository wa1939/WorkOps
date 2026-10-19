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
import { cn } from "@/lib/utils";
import { TaskCardClient } from "@/components/task-card-client";
import { useToast } from "@/hooks/use-toast";
import { NO_STAGE_KEY } from "@/lib/project-stages";

export interface PipelineTask {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    dueAt: Date | null;
    stageId: string | null;
    project: { name: string } | null;
    assignments: Array<{ id: string; user: { name: string; image: string | null } }>;
    tags: Array<{ id: string; tag: { name: string; color: string } }>;
}

export interface PipelineStage {
    id: string;
    name: string;
    color: string | null;
    order: number;
}

interface PipelineViewProps {
    projectId: string;
    stages: PipelineStage[];
    tasks: PipelineTask[];
}

/** A column is either the "No stage" bucket or a real stage. */
interface Column {
    key: string; // NO_STAGE_KEY or stage.id
    name: string;
    color: string;
    stageId: string | null;
}

function groupByColumn(tasks: PipelineTask[], columns: Column[]): Record<string, PipelineTask[]> {
    const grouped: Record<string, PipelineTask[]> = {};
    for (const col of columns) grouped[col.key] = [];
    for (const t of tasks) {
        const key = t.stageId && grouped[t.stageId] ? t.stageId : NO_STAGE_KEY;
        grouped[key].push(t);
    }
    return grouped;
}

function DraggableTask({ task }: { task: PipelineTask }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: task.id,
        data: { stageId: task.stageId },
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
            {/* project intentionally null — we are already inside the project */}
            <TaskCardClient task={{ ...task, project: null }} />
        </div>
    );
}

function DroppableColumn({ column, tasks }: { column: Column; tasks: PipelineTask[] }) {
    const { setNodeRef, isOver } = useDroppable({ id: column.key });

    return (
        <div className="flex-1 min-w-[280px] max-w-[340px]">
            <div className="flex items-center gap-2 px-3 py-2 rounded-t-lg ring-1 ring-border bg-muted/30">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />
                <h3 className="font-semibold text-sm">{column.name}</h3>
                <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
                    {tasks.length}
                </Badge>
            </div>
            <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <div
                    ref={setNodeRef}
                    className={cn(
                        "space-y-3 min-h-[400px] p-2 rounded-b-lg ring-1 ring-t-0 ring-border transition-colors",
                        isOver && "ring-primary/40 bg-primary/5",
                    )}
                >
                    {tasks.map((task) => (
                        <DraggableTask key={task.id} task={task} />
                    ))}
                    {tasks.length === 0 && (
                        <div className="text-center text-xs text-muted-foreground/50 py-12 italic">Drop a task here</div>
                    )}
                </div>
            </SortableContext>
        </div>
    );
}

export function PipelineView({ projectId, stages, tasks }: PipelineViewProps) {
    const router = useRouter();
    const { toast } = useToast();

    const columns: Column[] = [
        { key: NO_STAGE_KEY, name: "No stage", color: "#94a3b8", stageId: null },
        ...stages
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((s) => ({ key: s.id, name: s.name, color: s.color || "#8b5cf6", stageId: s.id })),
    ];
    const columnByKey = Object.fromEntries(columns.map((c) => [c.key, c]));

    const [localGroups, setLocalGroups] = useState<Record<string, PipelineTask[]>>(() => groupByColumn(tasks, columns));
    const [activeTask, setActiveTask] = useState<PipelineTask | null>(null);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

    const handleDragStart = (event: DragStartEvent) => {
        const taskId = event.active.id as string;
        const task = Object.values(localGroups).flat().find((t) => t.id === taskId);
        if (task) setActiveTask(task);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveTask(null);
        if (!over) return;

        const taskId = active.id as string;
        const allTasks = Object.values(localGroups).flat();
        const task = allTasks.find((t) => t.id === taskId);
        if (!task) return;

        // Resolve the target column: dropped on a card → that card's column; else a column key.
        let targetKey: string | null = null;
        const overTask = allTasks.find((t) => t.id === over.id);
        if (overTask) {
            targetKey = overTask.stageId ?? NO_STAGE_KEY;
        } else if (columnByKey[over.id as string]) {
            targetKey = over.id as string;
        }
        if (!targetKey) return;

        const currentKey = task.stageId ?? NO_STAGE_KEY;
        if (targetKey === currentKey) return;

        const targetStageId = columnByKey[targetKey].stageId;

        // Optimistic move
        const prevGroups = localGroups;
        const next: Record<string, PipelineTask[]> = {};
        for (const [key, list] of Object.entries(localGroups)) {
            next[key] = list.filter((t) => t.id !== taskId);
        }
        next[targetKey] = [...next[targetKey], { ...task, stageId: targetStageId }];
        setLocalGroups(next);

        // TODO(status-side-effects): dropping into "Wrap-up" could optionally mark DONE — not in v1.
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stageId: targetStageId }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            router.refresh();
        } catch (error) {
            setLocalGroups(prevGroups); // revert
            toast({ title: "Move failed", description: (error as Error).message, variant: "destructive" });
        }
    };

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4">
                {columns.map((col) => (
                    <DroppableColumn key={col.key} column={col} tasks={localGroups[col.key] ?? []} />
                ))}
            </div>
            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
                {activeTask && (
                    <div className="rotate-3 scale-105 shadow-2xl ring-2 ring-primary/40 rounded-lg">
                        <TaskCardClient task={{ ...activeTask, project: null }} />
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
}
