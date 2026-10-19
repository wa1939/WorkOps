"use client";

import { useState, useEffect, useMemo } from "react";
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
import { ArrowLeft, X, Plus, Lock, ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { SabahFormProvider, useSabahForm } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";
import type { SabahFieldDescriptor } from "@/components/sabah/forms/contracts";
import { createTaskSchema, taskDueDateInputSchema, taskDueTimeInputSchema } from "@/lib/tasks/schemas";

interface User {
    id: string;
    name: string;
    email: string;
}

interface Project {
    id: string;
    name: string;
}

interface CaseStudy {
    id: string;
    name: string;
}

interface Tag {
    id: string;
    name: string;
    color: string;
}

interface Task {
    id: string;
    title: string;
    status: string;
}

function TaskSabahFields({ fields }: { fields: SabahFieldDescriptor[] }) {
    const { registerField, unregisterField } = useSabahForm();
    useEffect(() => {
        fields.forEach(registerField);
        return () => fields.forEach((field) => unregisterField(field.name));
    }, [fields, registerField, unregisterField]);
    return <FormAssistMenu />;
}

export default function NewTaskPage() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [users, setUsers] = useState<User[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [availableTasks, setAvailableTasks] = useState<Task[]>([]);
    const [selectedAssignees, setSelectedAssignees] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedDependencies, setSelectedDependencies] = useState<string[]>([]);
    const [newTagName, setNewTagName] = useState("");
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [selectedCaseStudyId, setSelectedCaseStudyId] = useState<string | null>(null);
    const [selectedReminders, setSelectedReminders] = useState<number[]>([]);
    const [isRecurring, setIsRecurring] = useState(false);
    const [isPrivate, setIsPrivate] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [status, setStatus] = useState("TODO");
    const [priority, setPriority] = useState("MEDIUM");
    const [dueDate, setDueDate] = useState("");
    const [dueTime, setDueTime] = useState("09:00");
    const [effortHours, setEffortHours] = useState("");
    const [showMore, setShowMore] = useState(false);

    useEffect(() => {
        Promise.all([
            fetch("/api/users").then((r) => r.json()),
            fetch("/api/projects").then((r) => r.json()),
            fetch("/api/case-studies").then((r) => r.json()),
            fetch("/api/tags").then((r) => r.json()),
            fetch("/api/users/me").then((r) => r.json()),
        ]).then(([usersData, projectsData, caseStudiesData, tagsData, currentUser]) => {
            setUsers(usersData || []);
            setProjects(projectsData || []);
            setCaseStudies(caseStudiesData || []);
            setTags(tagsData || []);
            if (currentUser?.id) {
                setSelectedAssignees([currentUser.id]);
            }
        }).catch(console.error);
    }, []);

    // Fetch available tasks when project or case study changes
    useEffect(() => {
        if (!selectedProjectId && !selectedCaseStudyId) {
            setAvailableTasks([]);
            return;
        }

        const params = new URLSearchParams();
        if (selectedProjectId) params.append("projectId", selectedProjectId);
        if (selectedCaseStudyId) params.append("caseStudyId", selectedCaseStudyId);

        fetch(`/api/tasks?${params.toString()}`)
            .then((r) => r.json())
            .then((data) => setAvailableTasks(data || []))
            .catch(console.error);
    }, [selectedProjectId, selectedCaseStudyId]);

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

    const toggleDependency = (taskId: string) => {
        setSelectedDependencies((prev) =>
            prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
        );
    };

    const createNewTag = async () => {
        if (!newTagName.trim()) return;
        try {
            const res = await fetch("/api/tags", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newTagName.trim() }),
            });
            if (res.ok) {
                const newTag = await res.json();
                setTags((prev) => [...prev, newTag]);
                setSelectedTags((prev) => [...prev, newTag.id]);
                setNewTagName("");
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const dueDateValue = (formData.get("dueDate") as string | null) ?? "";
        const dueTimeValue = (formData.get("dueTime") as string | null) || "09:00";
        if (!taskDueDateInputSchema.safeParse(dueDateValue).success || !taskDueTimeInputSchema.safeParse(dueTimeValue).success) {
            toast({ title: "Invalid due date or time", description: "Enter a real calendar date and valid time.", variant: "destructive" });
            setLoading(false);
            return;
        }
        const data = {
            title: (formData.get("title") as string || "").trim(),
            description: (formData.get("description") as string) || "",
            priority: (formData.get("priority") as string) || "MEDIUM",
            status: (formData.get("status") as string) || "TODO",
            dueAt: dueDateValue
                ? new Date(`${dueDateValue}T${dueTimeValue}`).toISOString()
                : null,
            effortHours: formData.get("effortHours") ? parseFloat(formData.get("effortHours") as string) : null,
            projectId: selectedProjectId,
            caseStudyId: selectedCaseStudyId,
            assigneeIds: selectedAssignees,
            tagIds: selectedTags,
            dependencyIds: selectedDependencies,
            reminders: selectedReminders,
            isRecurring,
            isPrivate,
            recurrenceRule: isRecurring ? formData.get("recurrenceRule") as string : null,
        };

        try {
            const res = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                router.push("/tasks");
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to create task", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error creating task", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    const fields = useMemo<SabahFieldDescriptor[]>(() => {
        const field = <T,>(name: string, label: string, value: T, setValue: (value: T) => void, schema: { safeParse(value: unknown): { success: boolean } }): SabahFieldDescriptor<T> => ({ name, label, value, empty: value === "" || value == null || (Array.isArray(value) && value.length === 0), protected: false, risk: "DRAFT", actions: ["SUGGEST"], validate: async (next) => schema.safeParse(next).success ? { ok: true, value: next as T } : { ok: false, message: `Invalid ${label}` }, commit: async (next) => ({ value: next }), setValue });
        const uiDate = taskDueDateInputSchema;
        const uiTime = taskDueTimeInputSchema;
        return [field("title", "Title", title, setTitle, createTaskSchema.shape.title), field("description", "Description", description, setDescription, createTaskSchema.shape.description), field("status", "Status", status, setStatus, createTaskSchema.shape.status), field("priority", "Priority", priority, setPriority, createTaskSchema.shape.priority), field("dueDate", "Due date", dueDate, setDueDate, uiDate), field("dueTime", "Due time", dueTime, setDueTime, uiTime), field("effortHours", "Effort", effortHours, setEffortHours, { safeParse: (value: unknown) => createTaskSchema.shape.effortHours.safeParse(value === "" ? null : Number(value)) }), field("projectId", "Project", selectedProjectId, setSelectedProjectId, createTaskSchema.shape.projectId), field("caseStudyId", "Case study", selectedCaseStudyId, setSelectedCaseStudyId, createTaskSchema.shape.caseStudyId), field("assigneeIds", "Assignees", selectedAssignees, setSelectedAssignees, createTaskSchema.shape.assigneeIds), field("tagIds", "Tags", selectedTags, setSelectedTags, createTaskSchema.shape.tagIds), field("dependencyIds", "Dependencies", selectedDependencies, setSelectedDependencies, createTaskSchema.shape.dependencyIds), field("reminders", "Reminders", selectedReminders, setSelectedReminders, createTaskSchema.shape.reminders), field("isPrivate", "Privacy", isPrivate, setIsPrivate, createTaskSchema.shape.isPrivate)];
    }, [title, description, status, priority, dueDate, dueTime, effortHours, selectedProjectId, selectedCaseStudyId, selectedAssignees, selectedTags, selectedDependencies, selectedReminders, isPrivate]);

    return (
        <SabahFormProvider formId="task-new" entityType="task" entityId={null} recordVersion={null} fields={fields} suggestions={{}}>
        <TaskSabahFields fields={fields} />
        <div className="max-w-2xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href="/tasks">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Tasks
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>New task</CardTitle>
                    <CardDescription>Type a title and press Enter — everything else is optional.</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="title" className="sr-only">Title</Label>
                            <div className="flex items-center gap-2">
                                <Input
                                    id="title"
                                    name="title"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="What needs to be done?"
                                    required
                                    autoFocus
                                    className="flex-1 text-base"
                                />
                                <FieldAssist fieldName="title" />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Defaults: priority Medium, assigned to you, no due date. Expand below to customize.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowMore((v) => !v)}
                            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                        >
                            {showMore ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {showMore ? "Hide options" : "More options"}
                        </button>

                        {showMore && (<>
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
                                placeholder="Describe the task..."
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
                                <Label htmlFor="dueDate">Due Date</Label>
                                <Input id="dueDate" name="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="dueTime">Time (default 9:00 AM)</Label>
                                <Input id="dueTime" name="dueTime" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">

                            <div className="space-y-2">
                                <Label htmlFor="effortHours">Effort (hours)</Label>
                                <Input
                                    id="effortHours"
                                    name="effortHours"
                                    type="number"
                                    step="0.5"
                                    min="0"
                                    placeholder="e.g., 2"
                                    value={effortHours}
                                    onChange={(e) => setEffortHours(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Project / Case Study */}
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="projectId">Project (optional)</Label>
                                <Select
                                    name="projectId"
                                    value={selectedProjectId ?? "none"}
                                    onValueChange={(value) => setSelectedProjectId(value === "none" ? null : value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select project" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        {projects.map((p) => (
                                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="caseStudyId">Case Study (optional)</Label>
                                <Select
                                    name="caseStudyId"
                                    value={selectedCaseStudyId ?? "none"}
                                    onValueChange={(value) => setSelectedCaseStudyId(value === "none" ? null : value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select case study" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        {caseStudies.map((cs) => (
                                            <SelectItem key={cs.id} value={cs.id}>{cs.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* Assignees */}
                        <div className="space-y-2">
                            <Label>Assign to</Label>
                            <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px]">
                                {selectedAssignees.length === 0 && (
                                    <span className="text-sm text-muted-foreground">No assignees (floating task)</span>
                                )}
                                {selectedAssignees.map((id) => {
                                    const user = users.find((u) => u.id === id);
                                    return user ? (
                                        <Badge key={id} variant="secondary" className="gap-1">
                                            {user.name}
                                            <X className="h-3 w-3 cursor-pointer" onClick={() => toggleAssignee(id)} />
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

                        {/* Dependencies */}
                        <div className="space-y-2">
                            <Label>Dependencies (Blocked By)</Label>
                            <p className="text-xs text-muted-foreground">
                                {selectedProjectId || selectedCaseStudyId
                                    ? "Select tasks from the same project/case study that must be completed first"
                                    : "Select a project or case study above to see available tasks"}
                            </p>
                            <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[60px]">
                                {selectedDependencies.length === 0 && (
                                    <span className="text-sm text-muted-foreground">No dependencies</span>
                                )}
                                {selectedDependencies.map((id) => {
                                    const task = availableTasks.find((t) => t.id === id);
                                    return task ? (
                                        <Badge key={id} variant="secondary" className="gap-1">
                                            {task.title}
                                            <X className="h-3 w-3 cursor-pointer" onClick={() => toggleDependency(id)} />
                                        </Badge>
                                    ) : null;
                                })}
                            </div>
                            {availableTasks.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {availableTasks
                                        .filter((t) => !selectedDependencies.includes(t.id) && t.status !== "DONE" && t.status !== "CANCELED")
                                        .slice(0, 10)
                                        .map((task) => (
                                            <Button
                                                key={task.id}
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => toggleDependency(task.id)}
                                            >
                                                + {task.title}
                                            </Button>
                                        ))}
                                </div>
                            )}
                        </div>

                        {/* Tags */}
                        <div className="space-y-2">
                            <Label>Tags</Label>
                            <div className="flex flex-wrap gap-2 p-3 border rounded-md min-h-[40px]">
                                {selectedTags.map((id) => {
                                    const tag = tags.find((t) => t.id === id);
                                    return tag ? (
                                        <Badge
                                            key={id}
                                            variant="secondary"
                                            className="gap-1"
                                            style={{ backgroundColor: tag.color + "20", color: tag.color }}
                                        >
                                            {tag.name}
                                            <X className="h-3 w-3 cursor-pointer" onClick={() => toggleTag(id)} />
                                        </Badge>
                                    ) : null;
                                })}
                                <input
                                    className="flex-1 bg-transparent border-none outline-none h-6 min-w-full sm:w-[120px] text-sm"
                                    placeholder="Search or create tag..."
                                    value={newTagName}
                                    onChange={(e) => setNewTagName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            // Check if exact match exists
                                            const exactMatch = tags.find(t => t.name.toLowerCase() === newTagName.trim().toLowerCase());
                                            if (exactMatch) {
                                                if (!selectedTags.includes(exactMatch.id)) {
                                                    toggleTag(exactMatch.id);
                                                }
                                                setNewTagName("");
                                            } else {
                                                createNewTag();
                                            }
                                        }
                                    }}
                                />
                            </div>

                            {/* Filtered suggestions */}
                            {newTagName && (
                                <div className="border rounded-md p-2 mt-1 shadow-sm bg-popover max-h-[200px] overflow-auto">
                                    {tags.filter(t => t.name.toLowerCase().includes(newTagName.toLowerCase()) && !selectedTags.includes(t.id)).map(tag => (
                                        <div
                                            key={tag.id}
                                            className="flex items-center gap-2 p-2 hover:bg-accent rounded-sm cursor-pointer"
                                            onClick={() => {
                                                toggleTag(tag.id);
                                                setNewTagName("");
                                            }}
                                        >
                                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tag.color }} />
                                            <span className="text-sm">{tag.name}</span>
                                        </div>
                                    ))}
                                    {tags.filter(t => t.name.toLowerCase().includes(newTagName.toLowerCase()) && !selectedTags.includes(t.id)).length === 0 && (
                                        <div
                                            className="flex items-center gap-2 p-2 hover:bg-accent rounded-sm cursor-pointer text-muted-foreground"
                                            onClick={createNewTag}
                                        >
                                            <Plus className="h-4 w-4" />
                                            <span className="text-sm">{`Create "${newTagName}"`}</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Default list if no search */}
                            {!newTagName && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {tags.filter((t) => !selectedTags.includes(t.id)).slice(0, 10).map((tag) => (
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
                            )}
                        </div>

                        {/* Reminder & Recurring */}
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Reminders (before due date)</Label>
                                <div className="flex flex-wrap gap-2">
                                    {[
                                        { label: "30 min", value: 30 },
                                        { label: "1 hour", value: 60 },
                                        { label: "1 day", value: 1440 },
                                        { label: "2 days", value: 2880 },
                                    ].map((opt) => (
                                        <Button
                                            key={opt.value}
                                            type="button"
                                            size="sm"
                                            variant={selectedReminders.includes(opt.value) ? "default" : "outline"}
                                            onClick={() =>
                                                setSelectedReminders((prev) =>
                                                    prev.includes(opt.value)
                                                        ? prev.filter((v) => v !== opt.value)
                                                        : [...prev, opt.value]
                                                )
                                            }
                                        >
                                            {opt.label}
                                        </Button>
                                    ))}
                                </div>
                                {selectedReminders.length > 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        {selectedReminders.length} reminder(s) selected
                                    </p>
                                )}
                            </div>

                            <div className="flex items-center space-x-2">
                                <Checkbox
                                    id="isRecurring"
                                    checked={isRecurring}
                                    onCheckedChange={(checked) => setIsRecurring(checked as boolean)}
                                />
                                <Label htmlFor="isRecurring">Recurring task</Label>
                            </div>

                            {isRecurring && (
                                <div className="space-y-2 pl-6">
                                    <Label htmlFor="recurrenceRule">Recurrence</Label>
                                    <Select name="recurrenceRule" defaultValue="weekly">
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select recurrence" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="daily">Daily</SelectItem>
                                            <SelectItem value="weekly">Weekly</SelectItem>
                                            <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                                            <SelectItem value="monthly">Monthly</SelectItem>
                                            <SelectItem value="quarterly">Quarterly</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        {/* Private Task */}
                        <div className="flex items-center space-x-2 p-3 border rounded-md bg-muted/30">
                            <Checkbox
                                id="isPrivate"
                                checked={isPrivate}
                                onCheckedChange={(checked) => setIsPrivate(checked as boolean)}
                            />
                            <Lock className="h-4 w-4 text-muted-foreground" />
                            <div>
                                <Label htmlFor="isPrivate" className="cursor-pointer">Private Task</Label>
                                <p className="text-xs text-muted-foreground">Only visible to you and assignees</p>
                            </div>
                        </div>
                        </>)}

                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={loading}>
                                {loading ? "Creating..." : "Create task"}
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
