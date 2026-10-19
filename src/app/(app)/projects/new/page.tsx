"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { StrategicProjectFields, type StrategicProjectValue } from "@/components/projects/strategic-project-fields";

export default function NewProjectPage() {
    const router = useRouter(); const { toast } = useToast();
    const [value, setValue] = useState<StrategicProjectValue>({ sponsorStatus: "NOT_REQUIRED", priority: "MEDIUM", health: "NOT_SET" });
    const [description, setDescription] = useState(""); const [saving, setSaving] = useState(false);
    useEffect(() => { fetch("/api/pmo/work-areas").catch(() => undefined); }, []);
    const submit = async (event: React.FormEvent) => { event.preventDefault(); if (!value.name?.trim()) return; setSaving(true); const makeFloating = Boolean(value.makeFloating);
        const payload = { ...value, description: description || null, status: "Active", makeFloating, ownerId: makeFloating ? null : undefined, workAreaId: value.workAreaId ?? null, startAt: value.startAt ? new Date(value.startAt).toISOString() : null, dueAt: value.dueAt ? new Date(value.dueAt).toISOString() : null };
        try { const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error("Failed to create project"); router.push("/projects"); router.refresh(); } catch { toast({ title: "Error", description: "Failed to create project", variant: "destructive" }); } finally { setSaving(false); }
    };
    return <SabahFormProvider formId="project-new" entityType="project" entityId={null} recordVersion={null} fields={[]} suggestions={{}}><div className="max-w-4xl mx-auto animate-fade-in"><Button variant="ghost" asChild><Link href="/projects"><ArrowLeft className="mr-2 h-4 w-4" />Back to Projects</Link></Button><Card className="mt-4"><CardHeader><CardTitle>Create New Project</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-6"><FormAssistMenu /><StrategicProjectFields value={value} onChange={setValue} /><div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} /></div><Button type="submit" disabled={saving}>{saving ? "Creating..." : "Create Project"}</Button></form></CardContent></Card></div></SabahFormProvider>;
}
