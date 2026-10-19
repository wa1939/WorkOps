"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Check, Loader2 } from "lucide-react";
import { formatDate, getInitials, cn, isOverdue } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface ProjectTaskItemProps {
    task: {
        id: string;
        title: string;
        status: string;
        priority: string;
        type: string;
        dueAt: Date | null;
        assignments: Array<{ id: string; user: { name: string; image: string | null } }>;
    };
    isOwner: boolean;
}

const priorityColors: Record<string, string> = {
    URGENT: "priority-urgent",
    HIGH: "priority-high",
    MEDIUM: "priority-medium",
    LOW: "priority-low",
};

export function ProjectTaskItem({ task, isOwner }: ProjectTaskItemProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const isDone = task.status === "DONE";

    const handleMarkDone = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (isDone || !isOwner) return;

        setLoading(true);
        try {
            const res = await fetch(`/api/tasks/${task.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "DONE" }),
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

    return (
        <div
            className={cn(
                "flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors",
                isDone && "opacity-60"
            )}
        >
            {/* Mark Done Button - only for owners and non-done tasks */}
            {isOwner && !isDone && task.type !== "EXTERNAL_ACTION" ? (
                <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 rounded-full border-2 border-muted-foreground/30 hover:border-green-500 hover:bg-green-500/10"
                    onClick={handleMarkDone}
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <Check className="h-3 w-3 text-muted-foreground" />
                    )}
                </Button>
            ) : (
                <div className={cn(
                    "h-5 w-5 rounded-full border-2 flex items-center justify-center",
                    isDone ? "bg-green-500 border-green-500" : "border-muted-foreground/30"
                )}>
                    {isDone && <Check className="h-3 w-3 text-white" />}
                </div>
            )}
            {task.type === "EXTERNAL_ACTION" && <Badge variant="secondary">PMO action</Badge>}

            <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0">
                <p className={cn("font-medium", isDone && "line-through")}>
                    {task.title}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge className={cn("text-xs", priorityColors[task.priority])}>
                        {task.priority}
                    </Badge>
                    {task.dueAt && (
                        <span className={cn(isOverdue(task.dueAt) && !isDone && "text-red-500")}>
                            Due {formatDate(task.dueAt)}
                        </span>
                    )}
                </div>
            </Link>

            <div className="flex -space-x-1">
                {task.assignments.slice(0, 3).map((a) => (
                    <Avatar key={a.id} className="h-6 w-6 border-2 border-background">
                        <AvatarImage src={a.user.image || ""} />
                        <AvatarFallback className="text-xs">{getInitials(a.user.name)}</AvatarFallback>
                    </Avatar>
                ))}
            </div>
        </div>
    );
}
