"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar, Hand, MoreHorizontal } from "lucide-react";
import { formatRelativeDate, getInitials, cn, isOverdue } from "@/lib/utils";


interface TaskCardClientProps {
    task: {
        id: string;
        title: string;
        description: string | null;
        status: string;
        priority: string;
        dueAt: Date | null;
        project: { name: string } | null;
        assignments: Array<{ id: string; user: { name: string; image: string | null } }>;
        tags: Array<{ id: string; tag: { name: string; color: string } }>;
    };
}

export function TaskCardClient({ task }: TaskCardClientProps) {
    const overdue = isOverdue(task.dueAt) && task.status !== "DONE" && task.status !== "CANCELED";

    const priorityColors: Record<string, string> = {
        URGENT: "priority-urgent",
        HIGH: "priority-high",
        MEDIUM: "priority-medium",
        LOW: "priority-low",
    };

    return (
        <div
            className={cn(
                "block p-4 rounded-lg border bg-card hover:shadow-md transition-all task-card",
                overdue && "border-red-500/50"
            )}
        >
            <div className="flex items-start justify-between gap-2 mb-2">
                <Link href={`/tasks/${task.id}`} className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
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

            </div>

            <Link href={`/tasks/${task.id}`}>
                <h3 className="font-medium mb-2 line-clamp-2">{task.title}</h3>

                {task.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                        {task.description}
                    </p>
                )}

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {task.dueAt && (
                            <span className={cn("flex items-center gap-1", overdue && "text-red-500 font-medium")}>
                                <Calendar className="h-3 w-3" />
                                {formatRelativeDate(task.dueAt)}
                            </span>
                        )}
                    </div>

                    <div className="flex -space-x-2">
                        {task.assignments.length === 0 ? (
                            <Badge variant="outline" className="text-xs gap-1">
                                <Hand className="h-3 w-3" />
                                Floating
                            </Badge>
                        ) : (
                            task.assignments.slice(0, 3).map((a) => (
                                <Avatar key={a.id} className="h-6 w-6 border-2 border-background">
                                    <AvatarImage src={a.user.image || ""} />
                                    <AvatarFallback className="text-xs">{getInitials(a.user.name)}</AvatarFallback>
                                </Avatar>
                            ))
                        )}
                    </div>
                </div>

                {task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                        {task.tags.slice(0, 3).map((tt) => (
                            <Badge
                                key={tt.id}
                                variant="secondary"
                                className="text-xs"
                                style={{ backgroundColor: tt.tag.color + "20", color: tt.tag.color }}
                            >
                                {tt.tag.name}
                            </Badge>
                        ))}
                    </div>
                )}
            </Link>
        </div>
    );
}
