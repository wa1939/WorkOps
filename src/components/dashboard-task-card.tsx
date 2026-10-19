"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar, Check, Loader2 } from "lucide-react";
import { formatRelativeDate, getInitials, cn } from "@/lib/utils";
import { TaskCompleteBurst } from "@/components/celebrations/task-complete-burst";
import { useToast } from "@/hooks/use-toast";
import { LogTimeChips } from "@/components/log-time-chips";

interface DashboardTaskCardProps {
    task: {
        id: string;
        title: string;
        status: string;
        priority: string;
        type: string;
        dueAt: Date | null;
        project: { name: string } | null;
        assignments: Array<{ id: string; user: { name: string; image: string | null } }>;
    };
}

const priorityColors: Record<string, string> = {
    URGENT: "priority-urgent",
    HIGH: "priority-high",
    MEDIUM: "priority-medium",
    LOW: "priority-low",
};

const statusColors: Record<string, string> = {
    TODO: "status-todo",
    DOING: "status-doing",
    BLOCKED: "status-blocked",
    WAITING: "status-waiting",
    DONE: "status-done",
    CANCELED: "status-canceled",
};

export function DashboardTaskCard({ task }: DashboardTaskCardProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const [showBurst, setShowBurst] = useState(false);

    const handleMarkDone = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setLoading(true);
        try {
            const res = await fetch(`/api/tasks/${task.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "DONE" }),
            });

            if (res.ok) {
                setShowBurst(true);
                toast({
                    title: "Task marked done",
                    description: <LogTimeChips taskId={task.id} />,
                    duration: 10000,
                });
                setTimeout(() => router.refresh(), 600);
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
        <div className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors task-card relative">
            <TaskCompleteBurst trigger={showBurst} />
            {/* Mark Done Button */}
            {task.type !== "EXTERNAL_ACTION" ? <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full border-2 border-muted-foreground/30 hover:border-green-500 hover:bg-green-500/10"
                onClick={handleMarkDone}
                disabled={loading}
            >
                {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Check className="h-4 w-4 text-muted-foreground" />
                )}
            </Button> : <Badge variant="secondary">PMO action</Badge>}

            <Link href={`/tasks/${task.id}`} className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <Badge className={cn("text-xs", priorityColors[task.priority])}>
                        {task.priority}
                    </Badge>
                    <Badge variant="outline" className={cn("text-xs", statusColors[task.status])}>
                        {task.status}
                    </Badge>
                </div>
                <p className="font-medium truncate">{task.title}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    {task.dueAt && (
                        <span className={cn(
                            new Date(task.dueAt) < new Date() && "text-red-500 font-medium"
                        )}>
                            <Calendar className="inline h-3 w-3 mr-1" />
                            {formatRelativeDate(task.dueAt)}
                        </span>
                    )}
                    {task.project && (
                        <span>• {task.project.name}</span>
                    )}
                </div>
            </Link>

            <div className="flex -space-x-2">
                {task.assignments.slice(0, 3).map((assignment) => (
                    <Avatar key={assignment.id} className="h-8 w-8 border-2 border-background">
                        <AvatarImage src={assignment.user.image || ""} />
                        <AvatarFallback className="text-xs bg-primary/10">
                            {getInitials(assignment.user.name)}
                        </AvatarFallback>
                    </Avatar>
                ))}
            </div>
        </div>
    );
}
