"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, X } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";

interface User {
    id: string;
    name: string;
    email: string;
}

interface Task {
    id: string;
    title: string;
    status: string;
}

export default function NewLeavePage() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [myTasks, setMyTasks] = useState<Task[]>([]);
    const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
    const [handoverNote, setHandoverNote] = useState("");

    useEffect(() => {
        Promise.all([
            fetch("/api/users").then((res) => res.json()),
            fetch("/api/tasks?status=TODO,DOING,BLOCKED,WAITING&assigneeId=me").then((res) => res.json()),
        ]).then(([usersData, tasksData]) => {
            setUsers(usersData || []);
            setMyTasks(Array.isArray(tasksData) ? tasksData.filter((t: Task) => !["DONE", "CANCELED"].includes(t.status)) : []);
        }).catch(console.error);
    }, []);

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
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            startAt: new Date(formData.get("startAt") as string).toISOString(),
            endAt: new Date(formData.get("endAt") as string).toISOString(),
            delegateId: formData.get("delegateId") as string,
            reason: formData.get("reason") as string,
            handoverNote: handoverNote,
            handoverTaskIds: selectedTasks,
        };

        try {
            const res = await fetch("/api/leave", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                router.push("/leave");
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to create leave request", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error creating leave request", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

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
                    <CardTitle>Request Leave & Create Handover</CardTitle>
                    <CardDescription>Submit a leave request and hand over your tasks</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="startAt">Start Date *</Label>
                                <Input
                                    id="startAt"
                                    name="startAt"
                                    type="date"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="endAt">End Date *</Label>
                                <Input
                                    id="endAt"
                                    name="endAt"
                                    type="date"
                                    required
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="delegateId">Delegate *</Label>
                            <Select name="delegateId" required>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select someone to cover for you" />
                                </SelectTrigger>
                                <SelectContent>
                                    {users.map((user) => (
                                        <SelectItem key={user.id} value={user.id}>
                                            {user.name} ({user.email})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground">
                                This person will handle your tasks while you&apos;re away
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="reason">Reason (optional)</Label>
                            <Textarea
                                id="reason"
                                name="reason"
                                placeholder="Vacation, sick leave, personal..."
                                rows={2}
                            />
                        </div>

                        {/* Handover Section */}
                        <div className="border-t pt-6">
                            <h3 className="text-lg font-semibold mb-4">Task Handover</h3>

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
                                                <input
                                                    type="checkbox"
                                                    checked={selectedTasks.includes(task.id)}
                                                    readOnly
                                                    className="h-4 w-4 rounded border-primary"
                                                />
                                                <span className="flex-1 text-sm">{task.title}</span>
                                                <Badge variant="outline" className="text-xs">{task.status}</Badge>
                                            </div>
                                        ))
                                    )}
                                </div>

                                {selectedTasks.length > 0 && (
                                    <p className="text-sm text-muted-foreground">
                                        {selectedTasks.length} task(s) will be handed over to your delegate
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
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={loading}>
                                {loading ? "Submitting..." : "Submit Leave & Handover"}
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
