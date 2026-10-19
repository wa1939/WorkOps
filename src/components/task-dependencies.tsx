"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, X, Link as LinkIcon, AlertCircle } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface Task {
    id: string;
    title: string;
    status: string;
}

interface Dependency {
    id: string; // The ID of the dependency relation
    taskId: string;
    dependsOnId: string;
    dependsOn: {
        id: string;
        title: string;
        status: string;
    };
}

interface Blocker {
    id: string; // The ID of the dependency relation
    taskId: string;
    dependsOnId: string;
    task: { // The task that is blocked by the current task
        id: string;
        title: string;
        status: string;
    };
}

interface TaskDependenciesProps {
    taskId: string;
    dependencies: Dependency[];
    blockers: Blocker[];
    availableTasks: Task[]; // All tasks that can be dependent on (excluding self)
}

export function TaskDependencies({ taskId, dependencies, blockers, availableTasks }: TaskDependenciesProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [selectedTaskId, setSelectedTaskId] = useState<string>("none");
    const [adding, setAdding] = useState(false);

    const handleAddDependency = async () => {
        if (selectedTaskId === "none") return;

        setAdding(true);
        try {
            const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ dependsOnId: selectedTaskId }),
            });

            if (res.ok) {
                router.refresh();
                setSelectedTaskId("none");
            } else {
                toast({ title: "Error", description: "Failed to add dependency", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
        } finally {
            setAdding(false);
        }
    };

    const handleRemoveDependency = async (dependencyId: string) => {
        if (!confirm("Are you sure you want to remove this dependency?")) return;

        try {
            const res = await fetch(`/api/tasks/${taskId}/dependencies?id=${dependencyId}`, {
                method: "DELETE",
            });

            if (res.ok) {
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to remove dependency", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
        }
    };

    // Filter out tasks that are already dependencies or blockers to avoid cycles (simple check)
    // and exclude self
    const filteredTasks = availableTasks.filter(t =>
        t.id !== taskId &&
        !dependencies.some(d => d.dependsOn.id === t.id)
    );

    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <Select value={selectedTaskId} onValueChange={setSelectedTaskId}>
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a task to depend on..." />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">Select a task...</SelectItem>
                            {filteredTasks.map((t) => (
                                <SelectItem key={t.id} value={t.id}>
                                    {t.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        onClick={handleAddDependency}
                        disabled={adding || selectedTaskId === "none"}
                        size="sm"
                    >
                        {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Add Dependency
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <LinkIcon className="h-4 w-4" />
                        Blocked By (Dependencies)
                    </div>
                    {dependencies.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">No dependencies</p>
                    ) : (
                        <div className="space-y-2">
                            {dependencies.map((dep) => (
                                <div key={dep.id} className="flex items-center justify-between p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors">
                                    <div className="space-y-1">
                                        <Link href={`/tasks/${dep.dependsOn.id}`} className="font-medium hover:underline flex items-center gap-2">
                                            {dep.dependsOn.title}
                                        </Link>
                                        <Badge variant="outline" className="text-xs">{dep.dependsOn.status}</Badge>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => handleRemoveDependency(dep.id)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <AlertCircle className="h-4 w-4" />
                        Blocking (Downstream Tasks)
                    </div>
                    {blockers.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">Not blocking any tasks</p>
                    ) : (
                        <div className="space-y-2">
                            {blockers.map((blocker) => (
                                <div key={blocker.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/50">
                                    <div className="space-y-1">
                                        <Link href={`/tasks/${blocker.task.id}`} className="font-medium hover:underline flex items-center gap-2">
                                            {blocker.task.title}
                                        </Link>
                                        <Badge variant="outline" className="text-xs">{blocker.task.status}</Badge>
                                    </div>
                                    {/* Cannot remove blockers directly from here usually, but context dependent */}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
