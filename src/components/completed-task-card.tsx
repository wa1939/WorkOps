"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar, RotateCcw, Loader2 } from "lucide-react";
import { formatRelativeDate, getInitials, cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface CompletedTaskCardProps {
    task: {
        id: string;
        title: string;
        description: string | null;
        status: string;
        priority: string;
        dueAt: Date | null;
        doneAt: Date | null;
        project: { name: string } | null;
        assignments: Array<{ id: string; user: { name: string; image: string | null } }>;
        tags: Array<{ id: string; tag: { name: string; color: string } }>;
    };
}

const priorityColors: Record<string, string> = {
    URGENT: "priority-urgent",
    HIGH: "priority-high",
    MEDIUM: "priority-medium",
    LOW: "priority-low",
};

export function CompletedTaskCard({ task }: CompletedTaskCardProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);

    const handleUndo = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setLoading(true);
        try {
            const res = await fetch(`/api/tasks/${task.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "TODO" }),
            });

            if (res.ok) {
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to undo task completion", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error updating task", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="block p-4 rounded-lg border bg-card hover:shadow-md transition-all task-card opacity-70">
            <div className="flex items-start justify-between gap-2 mb-2">
                <Link href={`/tasks/${task.id}`} className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600">
                            Done
                        </Badge>
                        <Badge className={cn("text-xs", priorityColors[task.priority])}>
                            {task.priority}
                        </Badge>
                        {task.project && (
                            <Badge variant="outline" className="text-xs">
                                {task.project.name}
                            </Badge>
                        )}
                    </div>
                </Link>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={handleUndo}
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                        <RotateCcw className="h-3 w-3" />
                    )}
                    Undo
                </Button>
            </div>

            <Link href={`/tasks/${task.id}`}>
                <h3 className="font-medium mb-2 line-clamp-2 line-through text-muted-foreground">{task.title}</h3>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {task.doneAt && (
                            <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                Completed {formatRelativeDate(task.doneAt)}
                            </span>
                        )}
                    </div>

                    <div className="flex -space-x-2">
                        {task.assignments.slice(0, 3).map((a) => (
                            <Avatar key={a.id} className="h-6 w-6 border-2 border-background">
                                <AvatarImage src={a.user.image || ""} />
                                <AvatarFallback className="text-xs">{getInitials(a.user.name)}</AvatarFallback>
                            </Avatar>
                        ))}
                    </div>
                </div>
            </Link>
        </div>
    );
}
