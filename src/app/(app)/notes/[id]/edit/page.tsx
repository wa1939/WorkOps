"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarkdownToolbar } from "@/components/notes/markdown-toolbar";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { FieldAssist } from "@/components/sabah/forms/field-assist";

const COLORS = ["default", "blue", "green", "purple", "pink", "yellow", "orange"];

export default function EditNotePage() {
    const router = useRouter();
    const params = useParams();
    const id = params.id as string;
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [isShared, setIsShared] = useState(true);
    const [isPinned, setIsPinned] = useState(false);
    const [color, setColor] = useState("default");
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);

    useEffect(() => {
        fetch(`/api/notes/${id}`)
            .then((r) => r.json())
            .then((note) => {
                setTitle(note.title);
                setBody(note.body);
                setIsShared(note.isShared);
                setIsPinned(note.isPinned ?? false);
                setColor(note.color ?? "default");
                setUpdatedAt(note.updatedAt ? new Date(note.updatedAt).toISOString() : null);
                setLoading(false);
            })
            .catch(() => {
                router.push("/notes");
            });
    }, [id, router]);

    const handleSave = async () => {
        if (!title.trim()) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/notes/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, body, isShared, isPinned, color, expectedUpdatedAt: updatedAt }),
            });
            if (res.ok) {
                router.push(`/notes/${id}`);
                router.refresh();
            }
        } catch {
            // silent
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    return (
        <SabahFormProvider formId={`note-edit-${id}`} entityType="note" entityId={id} recordVersion={updatedAt} fields={[]} suggestions={{}}>
        <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" asChild>
                    <Link href={`/notes/${id}`}>
                        <ArrowLeft className="h-4 w-4" />
                    </Link>
                </Button>
                <h1 className="text-2xl font-bold">Edit Note</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Note Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <FormAssistMenu />
                    <div className="flex items-center gap-2"><FieldAssist fieldName="title" /><Input
                        placeholder="Title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                    /></div>

                    <Tabs defaultValue="write">
                        <TabsList>
                            <TabsTrigger value="write">Write</TabsTrigger>
                            <TabsTrigger value="preview">Preview</TabsTrigger>
                        </TabsList>
                        <TabsContent value="write" className="space-y-2">
                            <div className="flex items-center gap-2"><FieldAssist fieldName="body" /><MarkdownToolbar textareaRef={textareaRef} onUpdate={setBody} /></div>
                            <Textarea
                                ref={textareaRef}
                                placeholder="Write your note in Markdown..."
                                value={body}
                                onChange={(e) => setBody(e.target.value)}
                                rows={15}
                                className="font-mono text-sm"
                            />
                        </TabsContent>
                        <TabsContent value="preview">
                            <div className="prose prose-sm dark:prose-invert max-w-none p-4 border rounded-md min-h-[300px]">
                                <ReactMarkdown>{body || "*Nothing to preview*"}</ReactMarkdown>
                            </div>
                        </TabsContent>
                    </Tabs>

                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex items-center gap-2">
                            <Switch
                                id="shared"
                                checked={isShared}
                                onCheckedChange={setIsShared}
                            />
                            <Label htmlFor="shared">Shared</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Switch
                                id="pinned"
                                checked={isPinned}
                                onCheckedChange={setIsPinned}
                            />
                            <Label htmlFor="pinned">Pinned</Label>
                        </div>
                        <div className="flex items-center gap-2">
                            <Label>Color</Label>
                            <div className="flex gap-1.5">
                                {COLORS.map((c) => (
                                    <button
                                        key={c}
                                        onClick={() => setColor(c)}
                                        className={`h-5 w-5 rounded-full border-2 transition-all ${
                                            color === c ? "border-foreground scale-110" : "border-transparent"
                                        }`}
                                        style={{
                                            backgroundColor:
                                                c === "default"
                                                    ? "hsl(var(--muted))"
                                                    : c === "blue"
                                                    ? "#3b82f6"
                                                    : c === "green"
                                                    ? "#22c55e"
                                                    : c === "purple"
                                                    ? "#8b5cf6"
                                                    : c === "pink"
                                                    ? "#ec4899"
                                                    : c === "yellow"
                                                    ? "#eab308"
                                                    : "#f97316",
                                        }}
                                        title={c}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    <Button onClick={handleSave} disabled={saving || !title.trim()}>
                        {saving ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Save Changes
                    </Button>
                </CardContent>
            </Card>
        </div>
        </SabahFormProvider>
    );
}
