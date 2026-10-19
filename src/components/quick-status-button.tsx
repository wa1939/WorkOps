"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface QuickStatusButtonProps {
    taskId: string;
    currentStatus: string;
    variant?: "default" | "ghost" | "outline";
    size?: "default" | "sm" | "lg" | "icon";
    showLabel?: boolean;
    taskType?: string;
}

export function QuickStatusButton({
    taskId,
    currentStatus,
    variant = "outline",
    size = "sm",
    showLabel = true,
    taskType = "STANDARD"
}: QuickStatusButtonProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const isDone = currentStatus === "DONE";

    const handleMarkDone = async () => {
        if (isDone) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "DONE", doneAt: new Date().toISOString() }),
            });

            if (res.ok) {
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to mark task as done", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error updating task", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    if (taskType === "EXTERNAL_ACTION") return null;
    if (isDone) {
        return (
            <Button
                variant={variant}
                size={size}
                disabled
                className="text-green-600"
            >
                <Check className="h-4 w-4" />
                {showLabel && <span className="ml-2">Done</span>}
            </Button>
        );
    }

    return (
        <Button
            variant={variant}
            size={size}
            onClick={handleMarkDone}
            disabled={loading}
        >
            {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
                <Check className="h-4 w-4" />
            )}
            {showLabel && <span className="ml-2">Mark Done</span>}
        </Button>
    );
}
