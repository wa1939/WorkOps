"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { SabahFormProvider, useSabahForm } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";
import type { SabahFieldDescriptor } from "@/components/sabah/forms/contracts";
import { updateTaskSchema } from "@/lib/tasks/schemas";

interface User {
    id: string;
    name: string;
    email: string;
}

interface Tag {
    id: string;
    name: string;
    color: string;
}

interface Task {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    dueAt: string | null;
    effortHours: number | null;
    projectId: string | null;
    caseStudyId: string | null;
    assignments: { userId: string }[];
    tags: { tagId: string }[];
}

function TaskEditSabahFields({ fields }: { fields: SabahFieldDescriptor[] }) {
    const { registerField, unregisterField } = useSabahForm();
    useEffect(() => {
        fields.forEach(registerField);
        return () => fields.forEach((field) => unregisterField(field.name));
    }, [fields, registerField, unregisterField]);
    return <FormAssistMenu />;
}

export default function EditTaskPage() {
    const params = useParams();
    const id = params.id as string;
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [task, setTask] = useState<Task | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [status, setStatus] = useState("");
    const [priority, setPriority] = useState("");
    const [dueAt, setDueAt] = useState("");
    const [effortHours, setEffortHours] = useState("");

    useEffect(() => {
        Promise.all([
            fetch(`/api/tasks/${id}`).then((r) => r.json()),
            fetch("/api/users").then((r) => r.json()),
            fetch("/api/tags").then((r) => r.json()),
        ]).then(([taskData, usersData, tagsData]) => {
            setTask(taskData);
            setUsers(usersData || []);
            setTags(tagsData || []);
            setSelectedAssignees(taskData.assignments?.map((a: { userId: string }) => a.userId) || []);
            setSelectedTags(taskData.tags?.map((t: { tagId: string }) => t.tagId) || []);
            setTitle(taskData.title || ""); setDescription(taskData.description || ""); setStatus(taskData.status || "TODO"); setPriority(taskData.priority || "MEDIUM"); setDueAt(taskData.dueAt ? taskData.dueAt.slice(0, 16) : ""); setEffortHours(taskData.effortHours == null ? "" : String(taskData.effortHours));
            setLoading(false);
        }).catch(console.error);
    }, [id]);

    const toggleAssignee = (userId: string) => {
        setSelectedAssignees((prev) =>
            prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
        );
    };

    const toggleTag = (tagId: string) => {
        setSelectedTags((prev) =>
            prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
        );
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setSaving(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            title: formData.get("title") as string,
            description: formData.get("description") as string,
            priority: formData.get("priority") as string,
            status: formData.get("status") as string,
            dueAt: formData.get("dueAt") ? new Date(formData.get("dueAt") as string).toISOString() : null,
            effortHours: formData.get("effortHours") ? parseFloat(formData.get("effortHours") as string) : null,
            assigneeIds: selectedAssignees,
            tagIds: selectedTags,
        };

        try {
            const res = await fetch(`/api/tasks/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                router.push(`/tasks/${id}`);
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to update task", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error updating task", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const fields = useMemo<SabahFieldDescriptor[]>(() => {
        const field = <T,>(name: string, label: string, value: T, setValue: (value: T) => void, schema: { safeParse(value: unknown): { success: boolean } }): SabahFieldDescriptor<T> => ({ name, label, value, empty: value === "" || value == null || (Array.isArray(value) && value.length === 0), protected: false, risk: "DRAFT", actions: ["SUGGEST"], validate: async (next) => schema.safeParse(next).success ? { ok: true, value: next as T } : { ok: false, message: `Invalid ${label}` }, commit: async (next) => ({ value: next }), setValue });
        return [field("title", "Title", title, setTitle, updateTaskSchema.shape.title), field("description", "Description", description, setDescription, updateTaskSchema.shape.description), field("status", "Status", status, setStatus, updateTaskSchema.shape.status), field("priority", "Priority", priority, setPriority, updateTaskSchema.shape.priority), field("dueAt", "Due date", dueAt, setDueAt, updateTaskSchema.shape.dueAt), field("effortHours", "Effort", effortHours, setEffortHours, { safeParse: (value: unknown) => updateTaskSchema.shape.effortHours.safeParse(value === "" ? null : Number(value)) }), field("assigneeIds", "Assignees", selectedAssignees, setSelectedAssignees, updateTaskSchema.shape.assigneeIds), field("tagIds", "Tags", selectedTags, setSelectedTags, updateTaskSchema.shape.tagIds)];
    }, [title, description, status, priority, dueAt, effortHours, selectedAssignees, selectedTags]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!task) {
        return <p>Task not found</p>;
    }

    return (
        <SabahFormProvider formId={`task-edit-${id}`} entityType="task" entityId={id} recordVersion={(task as Task & { updatedAt?: string }).updatedAt ? new Date((task as Task & { updatedAt?: string }).updatedAt!).toISOString() : null} fields={fields} suggestions={{}}>
        <TaskEditSabahFields fields={fields} />
        <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href={`/tasks/${id}`}>
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Task
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Edit Task</CardTitle>
                    <CardDescription>Update task details</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="title">Title *</Label>
                                <FieldAssist fieldName="title" />
                            </div>
                            <Input
                                id="title"
                                name="title"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="description">Description</Label>
                                <FieldAssist fieldName="description" />
                            </div>
                            <Textarea
                                id="description"
                                name="description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                rows={4}
                            />
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="status">Status</Label>
                                <Select name="status" value={status} onValueChange={setStatus}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="TODO">To Do</SelectItem>
                                        <SelectItem value="DOING">Doing</SelectItem>
                                        <SelectItem value="BLOCKED">Blocked</SelectItem>
                                        <SelectItem value="WAITING">Waiting</SelectItem>
                                        <SelectItem value="DONE">Done</SelectItem>
                                        <SelectItem value="CANCELED">Canceled</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="priority">Priority</Label>
                                <Select name="priority" value={priority} onValueChange={setPriority}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select priority" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="LOW">Low</SelectItem>
                                        <SelectItem value="MEDIUM">Medium</SelectItem>
                                        <SelectItem value="HIGH">High</SelectItem>
                                        <SelectItem value="URGENT">Urgent</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="dueAt">Due Date</Label>
                                <Input
                                    id="dueAt"
                                    name="dueAt"
                                    type="datetime-local"
                                    value={dueAt}
                                    onChange={(e) => setDueAt(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="effortHours">Effort (hours)</Label>
                                <Input
                                    id="effortHours"
                                    name="effortHours"
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    value={effortHours}
                                    onChange={(e) => setEffortHours(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Assignees */}
                        <div className="space-y-2">
                            <Label>Assign to</Label>
                            <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px]">
                                {selectedAssignees.length === 0 && (
                                    <span className="text-sm text-muted-foreground">No assignees (floating task)</span>
                                )}
                                {selectedAssignees.map((userId) => {
                                    const user = users.find((u) => u.id === userId);
                                    return user ? (
                                        <Badge key={userId} variant="secondary" className="gap-1">
                                            {user.name}
                                            <X className="h-3 w-3 cursor-pointer" onClick={() => toggleAssignee(userId)} />
                                        </Badge>
                                    ) : null;
                                })}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {users.filter((u) => !selectedAssignees.includes(u.id)).map((user) => (
                                    <Button
                                        key={user.id}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleAssignee(user.id)}
                                    >
                                        + {user.name}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        {/* Tags */}
                        <div className="space-y-2">
                            <Label>Tags</Label>
                            <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[40px]">
                                {selectedTags.map((tagId) => {
                                    const tag = tags.find((t) => t.id === tagId);
                                    return tag ? (
                                        <Badge
                                            key={tagId}
                                            variant="secondary"
                                            className="gap-1"
                                            style={{ backgroundColor: tag.color + "20", color: tag.color }}
                                        >
                                            {tag.name}
                                            <X className="h-3 w-3 cursor-pointer" onClick={() => toggleTag(tagId)} />
                                        </Badge>
                                    ) : null;
                                })}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {tags.filter((t) => !selectedTags.includes(t.id)).map((tag) => (
                                    <Button
                                        key={tag.id}
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleTag(tag.id)}
                                        style={{ borderColor: tag.color, color: tag.color }}
                                    >
                                        + {tag.name}
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={saving}>
                                {saving ? "Saving..." : "Save Changes"}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => router.back()}>
                                Cancel
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
        </SabahFormProvider>
    );
}
