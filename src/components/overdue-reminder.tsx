"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Check, HelpCircle, Play, X } from "lucide-react";
import { formatRelativeDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useSabahMaybe } from "@/components/sabah/state/sabah-context";

interface OverdueTask {
    id: string;
    title: string;
    dueAt: string;
    priority: string;
    type: string;
    project?: { name: string } | null;
}

interface OverdueReminderProps {
    userId: string;
}

export function OverdueReminder({ userId }: OverdueReminderProps) {
    const router = useRouter();
    const { toast } = useToast();
    const sabah = useSabahMaybe();
    const sabahOpen = sabah !== null && sabah.state.shell.mode !== "CLOSED";
    const [open, setOpen] = useState(false);
    const [tasks, setTasks] = useState<OverdueTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [actioningTask, setActioningTask] = useState<string | null>(null);

    useEffect(() => {
        // Check if user has already dismissed today
        const dismissedDate = localStorage.getItem("overdueReminderDismissed");
        const today = new Date().toDateString();

        if (dismissedDate === today) {
            setLoading(false);
            return;
        }

        // Fetch overdue tasks (>1 week) ONLY for the current user
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        fetch(`/api/tasks?due=overdue&assigneeId=${userId}`)
            .then((r) => r.json())
            .then((data: OverdueTask[]) => {
                const veryOverdue = data.filter((t) => {
                    const dueDate = new Date(t.dueAt);
                    return dueDate < oneWeekAgo;
                });

                if (veryOverdue.length > 0) {
                    setTasks(veryOverdue);
                }
                setLoading(false);
            })
            .catch((err) => {
                console.error("Failed to fetch overdue tasks:", err);
                setLoading(false);
            });
    }, [userId]);

    useEffect(() => {
        if (sabahOpen) {
            setOpen(false);
            return;
        }

        if (tasks.length > 0 && localStorage.getItem("overdueReminderDismissed") !== new Date().toDateString()) {
            setOpen(true);
        }
    }, [sabahOpen, tasks]);

    const handleAction = async (taskId: string, action: "done" | "doing" | "support") => {
        setActioningTask(taskId);

        try {
            if (action === "done") {
                await fetch(`/api/tasks/${taskId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "DONE", doneAt: new Date().toISOString() }),
                });
            } else if (action === "doing") {
                await fetch(`/api/tasks/${taskId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "DOING" }),
                });
            } else if (action === "support") {
                await fetch("/api/support", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        taskId,
                        title: `Support needed for overdue task`,
                        description: `This task is overdue and needs assistance`,
                    }),
                });
            }

            // Remove task from list
            setTasks((prev) => prev.filter((t) => t.id !== taskId));
            router.refresh();
        } catch (error) {
            console.error("Action failed:", error);
            toast({ title: "Error", description: "Failed to perform action", variant: "destructive" });
        } finally {
            setActioningTask(null);
        }
    };

    const handleDismiss = () => {
        localStorage.setItem("overdueReminderDismissed", new Date().toDateString());
        setOpen(false);
    };

    if (loading || tasks.length === 0) return null;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-red-600">
                        <AlertCircle className="h-5 w-5" />
                        Overdue Tasks Requiring Attention
                    </DialogTitle>
                    <DialogDescription>
                        You have {tasks.length} task{tasks.length > 1 ? "s" : ""} overdue by more than a week. Please take action.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mt-4">
                    {tasks.map((task) => (
                        <div key={task.id} className="border rounded-lg p-4 space-y-3">
                            <div>
                                <div className="flex items-start justify-between gap-2">
                                    <h4 className="font-medium">{task.title}</h4>
                                    <Badge variant="destructive" className="text-xs">
                                        {task.priority}
                                    </Badge>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                    {task.project && (
                                        <Badge variant="outline" className="text-xs">
                                            {task.project.name}
                                        </Badge>
                                    )}
                                    <span className="text-red-500 font-medium">
                                        Due {formatRelativeDate(new Date(task.dueAt))}
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {task.type !== "EXTERNAL_ACTION" && <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => handleAction(task.id, "done")}
                                    disabled={actioningTask === task.id}
                                >
                                    <Check className="h-4 w-4 mr-1" />
                                    Mark Done
                                </Button>}
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAction(task.id, "doing")}
                                    disabled={actioningTask === task.id}
                                >
                                    <Play className="h-4 w-4 mr-1" />
                                    I&apos;ll Work On It
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAction(task.id, "support")}
                                    disabled={actioningTask === task.id}
                                >
                                    <HelpCircle className="h-4 w-4 mr-1" />
                                    Request Support
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="flex justify-end gap-2 mt-4">
                    <Button variant="outline" onClick={handleDismiss}>
                        <X className="h-4 w-4 mr-1" />
                        Dismiss for Today
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
