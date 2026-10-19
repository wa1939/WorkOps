"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ListTodo, AlertCircle, Users, Folder, Target, BarChart3, Undo2, Loader2 } from "lucide-react";
import type { ChatToolCall } from "@/app/api/ai/chat/route";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";

function iconFor(tool: string) {
    switch (tool) {
        case "createTask":
        case "updateTaskStatus":
            return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
        case "listMyTasks":
        case "searchTasks":
        case "getTask":
            return <ListTodo className="h-4 w-4 text-violet-400" />;
        case "getTaskStats":
            return <BarChart3 className="h-4 w-4 text-sky-400" />;
        case "listTeamMembers":
            return <Users className="h-4 w-4 text-amber-400" />;
        case "listProjects":
            return <Folder className="h-4 w-4 text-blue-400" />;
        case "listKpis":
            return <Target className="h-4 w-4 text-rose-400" />;
        default:
            return <ListTodo className="h-4 w-4 text-muted-foreground" />;
    }
}

type TaskItem = {
    id: string;
    title: string;
    status?: string;
    priority?: string;
    dueAt?: string | null;
    projectName?: string | null;
    url?: string;
};

function UndoButton({ taskIds, onUndone }: { taskIds: string[]; onUndone: () => void }) {
    const { toast } = useToast();
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);

    const handleUndo = async () => {
        setLoading(true);
        try {
            const resp = await fetch("/api/ai/tasks/undo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskIds }),
            });
            if (resp.ok) {
                const data = (await resp.json()) as { canceledCount: number };
                toast({
                    title: "Undone",
                    description: `Cancelled ${data.canceledCount} task${data.canceledCount === 1 ? "" : "s"}.`,
                    variant: "success",
                });
                onUndone();
                router.refresh();
                setOpen(false);
            } else {
                const data = await resp.json().catch(() => ({ error: "Failed" }));
                toast({ title: "Undo failed", description: data.error, variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Undo failed", description: (e as Error).message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
                <button
                    type="button"
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-300/80 hover:text-red-400 transition-colors"
                    title="Undo — cancel these tasks"
                >
                    <Undo2 className="h-3 w-3" />
                    Undo
                </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Undo this action?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {taskIds.length === 1
                            ? "This will cancel the task Sabah just created."
                            : `This will cancel all ${taskIds.length} tasks Sabah just created. They'll be marked CANCELED, not permanently deleted.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Keep them</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleUndo}
                        disabled={loading}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {loading && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Cancel tasks
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export function ToolCard({ call }: { call: ChatToolCall }) {
    const [undone, setUndone] = useState(false);

    if (!call.result.ok) {
        return (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                        <p className="font-medium text-red-300">Action failed</p>
                        <p className="text-xs text-red-300/80 mt-1 break-words">{call.result.error}</p>
                    </div>
                </div>
            </div>
        );
    }

    const data = call.result.data;

    if (call.name === "createTasks" && data && typeof data === "object") {
        const batch = data as {
            createdCount: number;
            failedCount: number;
            tasks: TaskItem[];
            errors: { index: number; title: string; error: string }[];
        };
        const taskIds = batch.tasks.map((t) => t.id).filter(Boolean);
        const canUndo = !undone && taskIds.length > 0;
        return (
            <div className={`rounded-lg border p-3 text-sm space-y-2 ${undone ? "border-border bg-muted/30 opacity-70" : "border-emerald-500/30 bg-emerald-500/10"}`}>
                <div className="flex items-start gap-2">
                    <CheckCircle2 className={`h-4 w-4 mt-0.5 flex-shrink-0 ${undone ? "text-muted-foreground" : "text-emerald-400"}`} />
                    <div className="min-w-0 flex-1">
                        <p className={`font-medium ${undone ? "text-muted-foreground line-through" : "text-emerald-300"}`}>
                            {undone ? "Undone" : `Created ${batch.createdCount} task${batch.createdCount === 1 ? "" : "s"}`}
                            {!undone && batch.failedCount > 0 && ` · ${batch.failedCount} failed`}
                        </p>
                    </div>
                    {canUndo && <UndoButton taskIds={taskIds} onUndone={() => setUndone(true)} />}
                </div>
                <div className="space-y-1">
                    {batch.tasks.slice(0, 8).map((t) => (
                        <Link
                            key={t.id}
                            href={t.url ?? `/tasks/${t.id}`}
                            className="block rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 hover:bg-emerald-500/10 transition-colors"
                        >
                            <p className="text-foreground truncate text-xs">{t.title}</p>
                            <div className="flex flex-wrap gap-1 mt-0.5 text-[10px] text-muted-foreground">
                                {t.priority && <span>{t.priority}</span>}
                                {t.dueAt && <span>· due {new Date(t.dueAt).toLocaleDateString()}</span>}
                            </div>
                        </Link>
                    ))}
                    {batch.tasks.length > 8 && (
                        <p className="text-[10px] text-muted-foreground">+{batch.tasks.length - 8} more</p>
                    )}
                </div>
                {batch.errors.length > 0 && (
                    <div className="pt-1 border-t border-emerald-500/20 space-y-1">
                        {batch.errors.slice(0, 3).map((e) => (
                            <p key={e.index} className="text-[10px] text-red-300/80">
                                ✕ <strong>{e.title}</strong>: {e.error}
                            </p>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (call.name === "createTask" && data && typeof data === "object") {
        const task = data as TaskItem & { assignees?: { name: string }[] };
        const canUndo = !undone && !!task.id;
        return (
            <div className={`rounded-lg border p-3 text-sm ${undone ? "border-border bg-muted/30 opacity-70" : "border-emerald-500/30 bg-emerald-500/10"}`}>
                <div className="flex items-start gap-2">
                    {iconFor(call.name)}
                    <div className="min-w-0 flex-1">
                        <p className={`font-medium ${undone ? "text-muted-foreground line-through" : "text-emerald-300"}`}>
                            {undone ? "Undone" : "Task created"}
                        </p>
                        <p className={`mt-0.5 truncate ${undone ? "text-muted-foreground line-through" : "text-foreground"}`}>{task.title}</p>
                        {!undone && (
                            <div className="flex flex-wrap gap-1.5 mt-1.5 text-xs text-muted-foreground">
                                {task.priority && <span>priority: {task.priority}</span>}
                                {task.projectName && <span>· {task.projectName}</span>}
                                {task.dueAt && <span>· due {new Date(task.dueAt).toLocaleDateString()}</span>}
                            </div>
                        )}
                        {!undone && task.url && (
                            <Link href={task.url} className="inline-block mt-2 text-xs text-emerald-400 hover:underline">
                                View task →
                            </Link>
                        )}
                    </div>
                    {canUndo && <UndoButton taskIds={[task.id]} onUndone={() => setUndone(true)} />}
                </div>
            </div>
        );
    }

    if (call.name === "updateTaskStatus" && data && typeof data === "object") {
        const task = data as { id: string; title: string; status: string };
        return (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                    {iconFor(call.name)}
                    <div className="min-w-0 flex-1">
                        <p className="font-medium text-emerald-300">Status updated</p>
                        <p className="text-foreground mt-0.5 truncate">{task.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">now: {task.status}</p>
                    </div>
                </div>
            </div>
        );
    }

    const taskItems = Array.isArray(data) ? data : data && typeof data === "object" ? (data as { items?: unknown }).items : undefined;
        if ((call.name === "listMyTasks" || call.name === "searchTasks") && Array.isArray(taskItems)) {
            const tasks = taskItems as TaskItem[];
            const hasMore = !Array.isArray(data) && (data as { hasMore?: boolean }).hasMore === true;
        if (tasks.length === 0) {
            return (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    No tasks found.
                </div>
            );
        }
        const shown = tasks.slice(0, 5);
        return (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {iconFor(call.name)}
                    <span>{tasks.length} task{tasks.length > 1 ? "s" : ""} returned{hasMore ? " · more matches available" : ""}</span>
                </div>
                {shown.map((t) => (
                    <Link
                        key={t.id}
                        href={t.url ?? `/tasks/${t.id}`}
                        className="block rounded-md border border-border/60 bg-background/50 px-2.5 py-1.5 hover:bg-background transition-colors"
                    >
                        <p className="text-foreground truncate">{t.title}</p>
                        <div className="flex flex-wrap gap-1.5 mt-0.5 text-xs text-muted-foreground">
                            {t.status && <span>{t.status}</span>}
                            {t.priority && <span>· {t.priority}</span>}
                            {t.projectName && <span>· {t.projectName}</span>}
                            {t.dueAt && <span>· {new Date(t.dueAt).toLocaleDateString()}</span>}
                        </div>
                    </Link>
                ))}
                {tasks.length > 5 && (
                    <p className="text-xs text-muted-foreground">+{tasks.length - 5} more</p>
                )}
            </div>
        );
    }

    if (call.name === "getTaskStats" && data && typeof data === "object") {
        const stats = data as { total: number; byStatus: Record<string, number> };
        const entries = Object.entries(stats.byStatus);
        return (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-2 mb-2">
                    {iconFor(call.name)}
                    <span className="font-medium">{stats.total} total</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {entries.map(([status, count]) => (
                        <span
                            key={status}
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                        >
                            {status}: <strong>{count}</strong>
                        </span>
                    ))}
                </div>
            </div>
        );
    }

    if ((call.name === "listProjects" || call.name === "listTeamMembers" || call.name === "listKpis") && Array.isArray(data)) {
        const items = data as { id: string; name?: string; title?: string; email?: string; perspective?: string }[];
        if (items.length === 0) {
            return (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Nothing found.
                </div>
            );
        }
        return (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    {iconFor(call.name)}
                    <span>{items.length} result{items.length > 1 ? "s" : ""}</span>
                </div>
                {items.slice(0, 8).map((item) => (
                    <div key={item.id} className="text-xs">
                        <span className="text-foreground">{item.name ?? item.title ?? item.email}</span>
                        {item.email && item.name && <span className="text-muted-foreground"> · {item.email}</span>}
                        {item.perspective && <span className="text-muted-foreground"> · {item.perspective}</span>}
                    </div>
                ))}
                {items.length > 8 && <p className="text-xs text-muted-foreground">+{items.length - 8} more</p>}
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 mb-1">
                {iconFor(call.name)}
                <span className="font-medium">{call.name}</span>
            </div>
            <pre className="overflow-x-auto text-[10px] opacity-70">
                {JSON.stringify(data, null, 2).slice(0, 400)}
            </pre>
        </div>
    );
}
