"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SabahFormProvider } from "@/components/sabah/forms/form-context";
import { FormAssistMenu } from "@/components/sabah/forms/form-assist-menu";
import { StrategicProjectFields, type StrategicProjectValue } from "@/components/projects/strategic-project-fields";

export default function EditProjectPage() {
    const { id } = useParams<{ id: string }>(); const router = useRouter(); const { toast } = useToast();
    const [project, setProject] = useState<any>(null); const [value, setValue] = useState<StrategicProjectValue>({}); const [description, setDescription] = useState(""); const [saving, setSaving] = useState(false);
    useEffect(() => { Promise.all([fetch(`/api/projects/${id}`), fetch("/api/pmo/work-areas")]).then(async ([projectResponse]) => { const data = await projectResponse.json(); setProject(data); setValue({ ...data, makeFloating: !data.ownerId, workAreaId: data.workAreaId ?? null, startAt: data.startAt ? new Date(data.startAt).toISOString().slice(0, 10) : null, dueAt: data.dueAt ? new Date(data.dueAt).toISOString().slice(0, 10) : null }); setDescription(data.description ?? ""); }).catch(() => toast({ title: "Error", description: "Failed to load project", variant: "destructive" })); }, [id, toast]);
    if (!project) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); const makeFloating = Boolean(value.makeFloating); const payload = { ...value, ownerId: makeFloating ? null : value.ownerId ?? undefined, description: description || null, makeFloating, expectedUpdatedAt: new Date(project.updatedAt).toISOString(), startAt: value.startAt ? new Date(value.startAt).toISOString() : null, dueAt: value.dueAt ? new Date(value.dueAt).toISOString() : null, workAreaId: value.workAreaId ?? null }; try { const response = await fetch(`/api/projects/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error("Failed to update project"); router.push(`/projects/${id}`); router.refresh(); } catch { toast({ title: "Error", description: "Failed to update project", variant: "destructive" }); } finally { setSaving(false); } };
    return <SabahFormProvider formId={`project-edit-${id}`} entityType="project" entityId={id} recordVersion={project.updatedAt ? new Date(project.updatedAt).toISOString() : null} fields={[]} suggestions={{}}><div className="max-w-4xl mx-auto animate-fade-in"><Button variant="ghost" asChild><Link href={`/projects/${id}`}><ArrowLeft className="mr-2 h-4 w-4" />Back to Project</Link></Button><Card className="mt-4"><CardHeader><CardTitle>Edit Project</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-6"><FormAssistMenu /><StrategicProjectFields value={value} onChange={setValue} /><div className="space-y-2"><Label htmlFor="description">Description</Label><Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} /></div><div className="flex gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save changes"}</Button><Button type="button" variant="outline" asChild><Link href={`/projects/${id}`}>Cancel</Link></Button></div></form></CardContent></Card></div></SabahFormProvider>;
}
