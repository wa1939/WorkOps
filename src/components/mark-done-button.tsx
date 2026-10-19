"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ToastAction } from "@/components/ui/toast";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { LogTimeChips } from "@/components/log-time-chips";

interface MarkDoneButtonProps {
    taskId: string;
    currentStatus: string;
    taskType?: string;
    size?: "sm" | "default";
}

export function MarkDoneButton({ taskId, currentStatus, taskType = "STANDARD", size = "sm" }: MarkDoneButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [optimisticDone, setOptimisticDone] = useState(false);
    const [, startTransition] = useTransition();
    const previousStatus = useRef(currentStatus);

    const restore = async () => {
        setOptimisticDone(false);
        try {
            await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: previousStatus.current, doneAt: null }),
            });
        } catch {
            /* best effort */
        }
        startTransition(() => router.refresh());
    };

    const handleMarkDone = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (optimisticDone) return;
        previousStatus.current = currentStatus;
        setOptimisticDone(true);

        toast({
            title: "Task marked done",
            description: <LogTimeChips taskId={taskId} />,
            action: (
                <ToastAction altText="Undo" onClick={restore}>
                    Undo
                </ToastAction>
            ),
            duration: 10000,
        });

        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "DONE", doneAt: new Date().toISOString() }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Let the toast breathe; refresh in the background so the row is removed from the list.
            setTimeout(() => startTransition(() => router.refresh()), 400);
        } catch (error) {
            console.error("Error marking task done:", error);
            setOptimisticDone(false);
            toast({ variant: "destructive", title: "Failed", description: "Could not mark the task done." });
        }
    };

    if (taskType === "EXTERNAL_ACTION" || currentStatus === "DONE" || currentStatus === "CANCELED" || optimisticDone) {
        return null;
    }

    return (
        <Button
            size={size}
            variant="ghost"
            onClick={handleMarkDone}
            className={cn(
                "transition-opacity text-green-600 hover:text-green-700 hover:bg-green-50",
            )}
        >
            <CheckCircle2 className="h-4 w-4" />
            <span className="sr-only">Mark Done</span>
        </Button>
    );
}
