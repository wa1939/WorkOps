"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Copy, Link2, Loader2, Timer, Play, Square, HandHelping } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface TaskRowMenuProps {
    taskId: string;
    taskTitle: string;
    canEdit?: boolean;
    taskType?: string;
}

/**
 * Compact "..." dropdown on task rows. Small quick-wins: copy link, duplicate,
 * start/stop focus timer that fills actualHours on stop.
 */
export function TaskRowMenu({ taskId, taskTitle, canEdit = true, taskType = "STANDARD" }: TaskRowMenuProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [, startTransition] = useTransition();
    const [duplicating, setDuplicating] = useState(false);
    const [timerRunning, setTimerRunning] = useState(false);
    const [timerStart, setTimerStart] = useState<number | null>(null);

    const stopEvent = (e: React.MouseEvent | React.SyntheticEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const copyLink = (e: React.MouseEvent) => {
        stopEvent(e);
        const url = `${window.location.origin}/tasks/${taskId}`;
        navigator.clipboard.writeText(url).then(
            () => toast({ title: "Link copied", description: taskTitle.slice(0, 80) }),
            () => toast({ variant: "destructive", title: "Copy failed" }),
        );
    };

    const duplicate = async (e: React.MouseEvent) => {
        stopEvent(e);
        if (duplicating) return;
        setDuplicating(true);
        try {
            const res = await fetch(`/api/tasks/${taskId}/duplicate`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            toast({ title: "Task duplicated", description: data.task?.title });
            startTransition(() => router.refresh());
        } catch (err) {
            toast({ variant: "destructive", title: "Duplicate failed", description: (err as Error).message });
        } finally {
            setDuplicating(false);
        }
    };

    const shareLoad = async (e: React.MouseEvent) => {
        stopEvent(e);
        try {
            const res = await fetch(`/api/support`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ taskId, title: taskTitle.slice(0, 200) }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            toast({ title: "Share the load", description: "Team can now offer help on this task." });
            startTransition(() => router.refresh());
        } catch (err) {
            toast({ variant: "destructive", title: "Could not post", description: (err as Error).message });
        }
    };

    const toggleTimer = async (e: React.MouseEvent) => {
        stopEvent(e);
        if (!timerRunning) {
            setTimerRunning(true);
            setTimerStart(Date.now());
            toast({ title: "Focus timer started", description: "Click again to stop and log actual hours." });
            return;
        }
        const elapsed = Date.now() - (timerStart ?? Date.now());
        const hours = Math.max(0.05, Math.round((elapsed / 3_600_000) * 100) / 100);
        setTimerRunning(false);
        setTimerStart(null);
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actualHours: hours }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast({ title: "Timer stopped", description: `Logged ${hours}h to this task.` });
            startTransition(() => router.refresh());
        } catch (err) {
            toast({ variant: "destructive", title: "Could not log time", description: (err as Error).message });
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={stopEvent}>
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    aria-label="Task actions"
                >
                    {duplicating ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52" onClick={stopEvent}>
                <DropdownMenuItem onClick={copyLink} className="gap-2">
                    <Link2 className="h-4 w-4" />
                    Copy link
                </DropdownMenuItem>
                {canEdit && taskType !== "EXTERNAL_ACTION" && (
                    <DropdownMenuItem onClick={duplicate} className="gap-2" disabled={duplicating}>
                        <Copy className="h-4 w-4" />
                        Duplicate task
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={shareLoad} className="gap-2">
                    <HandHelping className="h-4 w-4 text-purple-600" />
                    Share the load
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={toggleTimer} className="gap-2">
                    {timerRunning ? <Square className="h-4 w-4 text-red-500" /> : <Play className="h-4 w-4" />}
                    {timerRunning ? "Stop focus timer" : "Start focus timer"}
                    {timerRunning && <Timer className="h-3 w-3 ml-auto animate-pulse" />}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
