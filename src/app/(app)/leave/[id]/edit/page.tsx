"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";

interface Task {
    id: string;
    title: string;
    status: string;
}

interface LeaveRequest {
    id: string;
    startAt: string;
    endAt: string;
    delegateId: string;
    delegate: { name: string };
}

export default function EditLeavePage() {
    const params = useParams();
    const id = params.id as string;
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [leave, setLeave] = useState<LeaveRequest | null>(null);
    const [myTasks, setMyTasks] = useState<Task[]>([]);
    const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
    const [handoverNote, setHandoverNote] = useState("");

    useEffect(() => {
        Promise.all([
            fetch(`/api/leave/${id}`).then((r) => r.json()),
            fetch("/api/tasks?status=TODO,DOING,BLOCKED,WAITING&assigneeId=me").then((r) => r.json()),
        ]).then(([leaveData, tasksData]) => {
            setLeave(leaveData);
            setMyTasks(Array.isArray(tasksData) ? tasksData.filter((t: Task) => !["DONE", "CANCELED"].includes(t.status)) : []);
            setLoading(false);
        }).catch(console.error);
    }, [id]);

    const toggleTask = (taskId: string) => {
        setSelectedTasks((prev) =>
            prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
        );
    };

    const selectAllTasks = () => {
        setSelectedTasks(myTasks.map((t) => t.id));
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);

        try {
            const res = await fetch(`/api/leave/${id}/handover`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    handoverNote,
                    handoverTaskIds: selectedTasks,
                }),
            });

            if (res.ok) {
                router.push("/leave");
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to add handover", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error adding handover", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!leave) {
        return <p>Leave request not found</p>;
    }

    return (
        <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href="/leave">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Leave
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Add Handover Tasks</CardTitle>
                    <CardDescription>
                        Select tasks to hand over to {leave.delegate.name} during your leave
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <Label>Select tasks to hand over</Label>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={selectAllTasks}
                                >
                                    Select All ({myTasks.length})
                                </Button>
                            </div>

                            <div className="border rounded-lg p-3 max-h-60 overflow-y-auto space-y-2">
                                {myTasks.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-4">
                                        No active tasks to hand over
                                    </p>
                                ) : (
                                    myTasks.map((task) => (
                                        <div
                                            key={task.id}
                                            className="flex items-center gap-3 p-2 rounded hover:bg-accent cursor-pointer"
                                            onClick={() => toggleTask(task.id)}
                                        >
                                            <Checkbox
                                                checked={selectedTasks.includes(task.id)}
                                                onCheckedChange={() => toggleTask(task.id)}
                                            />
                                            <span className="flex-1 text-sm">{task.title}</span>
                                            <Badge variant="outline" className="text-xs">{task.status}</Badge>
                                        </div>
                                    ))
                                )}
                            </div>

                            {selectedTasks.length > 0 && (
                                <p className="text-sm text-muted-foreground">
                                    {selectedTasks.length} task(s) will be handed over
                                </p>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="handoverNote">Handover Notes</Label>
                                <Textarea
                                    id="handoverNote"
                                    value={handoverNote}
                                    onChange={(e) => setHandoverNote(e.target.value)}
                                    placeholder="Any additional instructions for your delegate..."
                                    rows={3}
                                />
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={saving || selectedTasks.length === 0}>
                                {saving ? "Saving..." : "Add Handover"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => router.back()}>
                                Cancel
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
