"use client";

import { useEffect, useState } from "react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { DrawerSubtask, TaskDrawerPayload } from "../types";
import { humanize, initials, userLabel } from "./shared";

interface SubtasksSectionProps {
    task: TaskDrawerPayload;
    onRefresh: () => Promise<void>;
}

function responseError(value: unknown): string {
    if (value && typeof value === "object" && "error" in value) {
        const error = (value as { error?: unknown }).error;
        if (typeof error === "string") return error;
    }
    return "AI request failed";
}

function SortableSubtaskRow({ item }: { item: DrawerSubtask }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
    const style = { transform: CSS.Transform.toString(transform), transition };
    const assignee = item.assignments[0]?.user;
    return (
        <div ref={setNodeRef} style={style} className={cn("flex items-center gap-2 rounded-md border border-border/70 bg-background px-2 py-2", isDragging && "opacity-60 shadow-sm")}>
            <button type="button" aria-label={`Reorder ${item.title}`} {...attributes} {...listeners} className="cursor-grab px-1 text-muted-foreground active:cursor-grabbing">⋮⋮</button>
            <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
            <span className="text-[11px] text-muted-foreground">{humanize(item.status)}</span>
            {assignee && <span title={userLabel(assignee)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{initials(assignee)}</span>}
        </div>
    );
}

export function SubtasksSection({ task, onRefresh }: SubtasksSectionProps) {
    const [items, setItems] = useState(task.subtasks);
    const [newTitle, setNewTitle] = useState("");
    const [busy, setBusy] = useState(false);
    const [aiBusy, setAiBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { toast } = useToast();
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    useEffect(() => setItems(task.subtasks), [task.subtasks]);

    const reorder = async ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return;
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        const next = [...items];
        const [moved] = next.splice(oldIndex, 1);
        if (!moved) return;
        next.splice(newIndex, 0, moved);
        setItems(next);
        setError(null);
        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/subtasks/reorder`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ orderedIds: next.map((item) => item.id) }),
            });
            if (!response.ok) throw new Error("Could not save subtask order");
            await onRefresh();
        } catch (cause) {
            setItems(items);
            setError(cause instanceof Error ? cause.message : "Could not save subtask order");
        }
    };

    const addSubtask = async () => {
        const title = newTitle.trim();
        if (!title || busy) return;
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/subtasks`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title }),
            });
            if (!response.ok) throw new Error("Could not add subtask");
            setNewTitle("");
            await onRefresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not add subtask");
        } finally {
            setBusy(false);
        }
    };

    const breakIntoSubtasks = async () => {
        if (aiBusy || busy) return;
        setAiBusy(true);
        try {
            const response = await fetch("/api/ai/task-actions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "breakdown", taskId: task.id }),
            });
            const payload = await response.json().catch(() => null) as unknown;
            if (!response.ok) throw new Error(responseError(payload));
            const created = payload && typeof payload === "object" && "created" in payload
                ? (payload as { created?: unknown }).created
                : null;
            if (!Array.isArray(created)) throw new Error("Invalid AI breakdown response");
            await onRefresh();
            toast({ title: `${created.length} subtasks created` });
        } catch (cause: unknown) {
            toast({
                title: "AI breakdown failed",
                description: cause instanceof Error ? cause.message : "Try again.",
                variant: "destructive",
            });
        } finally {
            setAiBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">Subtasks</span>
                <button
                    type="button"
                    disabled={aiBusy || busy}
                    onClick={() => void breakIntoSubtasks()}
                    className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {aiBusy ? "✦ Breaking down…" : "✦ AI: break into subtasks"}
                </button>
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void reorder(event)}>
                <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2">
                        {items.length === 0 && <p className="text-sm text-muted-foreground">No subtasks yet.</p>}
                        {items.map((item) => <SortableSubtaskRow key={item.id} item={item} />)}
                    </div>
                </SortableContext>
            </DndContext>
            <div className="flex gap-2">
                <input
                    value={newTitle}
                    disabled={busy || aiBusy}
                    onChange={(event) => setNewTitle(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addSubtask(); } }}
                    placeholder="Add a subtask…"
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                    aria-label="New subtask title"
                />
                <button type="button" disabled={!newTitle.trim() || busy || aiBusy} onClick={() => void addSubtask()} className="h-9 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">Add</button>
            </div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
