"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";

interface Task {
    id: string;
    title: string;
}

interface CaseStudy {
    id: string;
    name: string;
}

export default function NewNotePage() {
    const router = useRouter();
    const { toast } = useToast();
    const [loading, setLoading] = useState(false);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [caseStudies, setCaseStudies] = useState<CaseStudy[]>([]);
    const [selectedTask, setSelectedTask] = useState<string>("");
    const [selectedCaseStudy, setSelectedCaseStudy] = useState<string>("");

    useEffect(() => {
        // Fetch tasks and case studies for dropdowns
        fetch("/api/tasks?status=all")
            .then(r => r.json())
            .then(data => setTasks(data.slice(0, 50)))
            .catch(console.error);

        fetch("/api/case-studies")
            .then(r => r.json())
            .then(data => setCaseStudies(data))
            .catch(console.error);
    }, []);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const data = {
            title: formData.get("title") as string,
            body: formData.get("body") as string,
            isShared: true,
            taskId: selectedTask || null,
            caseStudyId: selectedCaseStudy || null,
        };

        try {
            const res = await fetch("/api/notes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });

            if (res.ok) {
                router.push("/notes");
                router.refresh();
            } else {
                toast({ title: "Error", description: "Failed to create note", variant: "destructive" });
            }
        } catch (error) {
            console.error(error);
            toast({ title: "Error", description: "Error creating note", variant: "destructive" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <SabahFormProvider formId="note-new" entityType="note" entityId={null} recordVersion={null} fields={[]} suggestions={{}}>
        <div className="max-w-3xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href="/notes">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Notes
                    </Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Create New Note</CardTitle>
                    <CardDescription>Add to the knowledge base</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <FormAssistMenu />
                        <div className="space-y-2">
                            <div className="flex items-center gap-2"><Label htmlFor="title">Title *</Label><FieldAssist fieldName="title" /></div>
                            <Input
                                id="title"
                                name="title"
                                placeholder="Enter note title"
                                required
                            />
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Link to Task (Optional)</Label>
                                <Select value={selectedTask} onValueChange={setSelectedTask}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a task..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="">None</SelectItem>
                                        {tasks.map(task => (
                                            <SelectItem key={task.id} value={task.id}>
                                                {task.title}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Link to Case Study (Optional)</Label>
                                <Select value={selectedCaseStudy} onValueChange={setSelectedCaseStudy}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select a case study..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="">None</SelectItem>
                                        {caseStudies.map(cs => (
                                            <SelectItem key={cs.id} value={cs.id}>
                                                {cs.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="body">Content (Markdown supported)</Label>
                            <Textarea
                                id="body"
                                name="body"
                                placeholder="Write your note here... (Markdown supported)"
                                rows={15}
                                className="font-mono"
                            />
                        </div>

                        <div className="flex gap-4 pt-4">
                            <Button type="submit" disabled={loading}>
                                {loading ? "Creating..." : "Create Note"}
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
