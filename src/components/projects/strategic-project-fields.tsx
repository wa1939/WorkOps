"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldAssist } from "@/components/sabah/forms/field-assist";
import { useSabahForm } from "@/components/sabah/forms/form-context";
import type { SabahFieldDescriptor } from "@/components/sabah/forms/contracts";
import { projectBaseObjectSchema, projectHealthSchema, projectObjectiveInputSchema, projectOutputInputSchema, projectRiskInputSchema, projectStageInputSchema, sponsorStatusSchema } from "@/lib/projects/schemas";
import { deriveImplementationDuration } from "@/lib/projects/duration";
import { ProjectChildrenEditor, type ProjectChildren } from "./project-children-editor";

export type StrategicProjectValue = {
    name?: string; description?: string | null; startAt?: string | null; dueAt?: string | null; dueAtEnd?: string | null;
    responsibleDepartmentId?: string | null; managerId?: string | null; sponsorStatus?: string; sponsorId?: string | null; ownerId?: string | null;
    objective?: string | null; scope?: string | null; successCriteria?: string | null; priority?: string; health?: string; workAreaId?: string | null; makeFloating?: boolean;
    objectives?: ProjectChildren["objectives"]; outputs?: ProjectChildren["outputs"]; risks?: ProjectChildren["risks"]; stages?: ProjectChildren["stages"];
};

type Option = { id: string; name: string };
const scalarFields: Array<[keyof StrategicProjectValue, string]> = [
    ["name", "Project name"], ["responsibleDepartmentId", "Responsible administration"], ["managerId", "Project manager"], ["sponsorStatus", "Sponsor status"], ["sponsorId", "Sponsor person"], ["objective", "Objective"], ["scope", "Scope"], ["successCriteria", "Success criteria"], ["priority", "Priority"], ["health", "Health"], ["workAreaId", "PMO work area"], ["makeFloating", "Make Floating"],
];
const isoDate = (candidate: unknown) => typeof candidate === "string" && candidate ? new Date(`${candidate.slice(0, 10)}T00:00:00.000Z`).toISOString() : candidate == null || candidate === "" ? null : candidate;
type Validation = { ok: true; value: unknown } | { ok: false; message: string };

function canonicalValidate(name: keyof StrategicProjectValue, candidate: unknown): Validation {
    const shape = { ...projectBaseObjectSchema.shape, name: projectBaseObjectSchema.shape.name, sponsorStatus: sponsorStatusSchema, health: projectHealthSchema, objectives: projectBaseObjectSchema.shape.objectives, outputs: projectBaseObjectSchema.shape.outputs, risks: projectBaseObjectSchema.shape.risks, stages: projectBaseObjectSchema.shape.stages } as Record<string, any>;
    if (name === "makeFloating") return typeof candidate === "boolean" ? { ok: true, value: candidate } : { ok: false, message: "Make Floating must be boolean" };
    if (name === "startAt" || name === "dueAt" || name === "dueAtEnd") {
        const result = projectBaseObjectSchema.shape[name].safeParse(isoDate(candidate));
        return result.success ? { ok: true, value: candidate } : { ok: false, message: result.error.issues[0]?.message ?? "Invalid date" };
    }
    const result = shape[name]?.safeParse(candidate == null || candidate === "" ? null : candidate);
    if (!result) return { ok: false, message: "Unsupported project field" };
    return result.success ? { ok: true, value: candidate } : { ok: false, message: result.error.issues[0]?.message ?? "Invalid value" };
}

export function StrategicProjectFields({ value, onChange }: { value: StrategicProjectValue; onChange: (value: StrategicProjectValue) => void }) {
    const form = useSabahForm();
    const [nameError, setNameError] = useState<string | null>(null);
    const [users, setUsers] = useState<Option[]>([]);
    const [departments, setDepartments] = useState<Option[]>([]);
    const [workAreas, setWorkAreas] = useState<Option[]>([]);
    const update = (name: keyof StrategicProjectValue, next: unknown) => onChange({ ...value, [name]: next });
    useEffect(() => {
        Promise.all([fetch("/api/users").then((r) => r.ok ? r.json() : []), fetch("/api/admin/departments").then((r) => r.ok ? r.json() : []), fetch("/api/pmo/work-areas").then((r) => r.ok ? r.json() : [])])
            .then(([userData, departmentData, areaData]) => { setUsers((Array.isArray(userData) ? userData : []).map((x) => ({ id: x.id, name: x.name ?? x.email }))); setDepartments((Array.isArray(departmentData) ? departmentData : []).map((x) => ({ id: x.id, name: x.name }))); setWorkAreas((Array.isArray(areaData) ? areaData : []).map((x) => ({ id: x.id, name: x.name }))); })
            .catch(() => undefined);
    }, []);
    useEffect(() => {
        for (const [name, label] of scalarFields) {
            const descriptor: SabahFieldDescriptor = { name: String(name), label, value: value[name] ?? "", empty: value[name] == null || value[name] === "", protected: false, risk: "DRAFT", actions: ["SUGGEST"], validate: (candidate) => Promise.resolve(canonicalValidate(name, candidate)), setValue: (candidate) => update(name, candidate) };
            form.registerField(descriptor);
        }
        for (const [name, label, schema] of [["startAt", "Start date", projectBaseObjectSchema.shape.startAt], ["dueAt", "Due date", projectBaseObjectSchema.shape.dueAt], ["dueAtEnd", "Due date end", projectBaseObjectSchema.shape.dueAtEnd]] as const) {
            form.registerField({ name, label, value: value[name] ?? "", empty: !value[name], protected: false, risk: "DRAFT", actions: ["SUGGEST"], validate: (candidate) => { const result = schema.safeParse(isoDate(candidate)); return Promise.resolve(result.success ? { ok: true, value: candidate } : { ok: false, message: result.error.issues[0]?.message ?? "Invalid date" }); }, setValue: (candidate) => update(name, candidate) });
        }
    }, [form.registerField, value]);
    const duration = useMemo(() => value.startAt && value.dueAt ? deriveImplementationDuration(value.startAt.slice(0, 10), value.dueAt.slice(0, 10)).label : null, [value.startAt, value.dueAt]);
    const control = (name: string, label: string, child: React.ReactNode) => <div className="space-y-1"><div className="flex items-center justify-between"><Label htmlFor={name}>{label}</Label><FieldAssist fieldName={name} /></div>{child}</div>;
    const optionSelect = (name: keyof StrategicProjectValue, label: string, options: Option[], allowEmpty = true) => control(String(name), label, <Select value={String(value[name] ?? "unclassified")} onValueChange={(v) => update(name, v === "unclassified" ? null : v)}><SelectTrigger id={String(name)} aria-label={label}><SelectValue placeholder={label} /></SelectTrigger><SelectContent>{allowEmpty && <SelectItem value="unclassified">Unclassified</SelectItem>}{options.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent></Select>);
    return <div className="space-y-6">
        <section className="space-y-4"><h2 className="text-lg font-semibold">Project identity</h2>{control("name", "Project name", <><Input id="name" value={String(value.name ?? "")} onChange={(e) => { update("name", e.target.value); setNameError(null); }} onBlur={() => { const result = projectBaseObjectSchema.shape.name.safeParse(value.name); if (!result.success) setNameError(result.error.issues[0]?.message ?? "Project name is invalid"); }} required />{nameError && <p role="alert" className="text-xs text-red-600">{nameError}</p>}</>)}{control("objective", "Objective", <Textarea id="objective" value={String(value.objective ?? "")} onChange={(e) => update("objective", e.target.value)} />)}{control("scope", "Scope", <Textarea id="scope" value={String(value.scope ?? "")} onChange={(e) => update("scope", e.target.value)} />)}</section>
        <section className="space-y-4"><h2 className="text-lg font-semibold">Schedule</h2><div className="grid grid-cols-2 gap-4">{control("startAt", "Start date", <Input id="startAt" type="date" value={String(value.startAt ?? "").slice(0, 10)} onChange={(e) => update("startAt", e.target.value || null)} />)}{control("dueAt", "Due date", <Input id="dueAt" type="date" value={String(value.dueAt ?? "").slice(0, 10)} onChange={(e) => update("dueAt", e.target.value || null)} />)}</div><div aria-label="Implementation duration" className="rounded-md bg-muted p-3 text-sm">Implementation duration: <strong>{duration ?? "Not available"}</strong></div></section>
        <section className="space-y-4"><h2 className="text-lg font-semibold">Governance</h2>{optionSelect("responsibleDepartmentId", "Responsible administration", departments)}{optionSelect("managerId", "Project manager", users)}{control("sponsorStatus", "Sponsor status", <Select value={String(value.sponsorStatus ?? "NOT_REQUIRED")} onValueChange={(v) => update("sponsorStatus", v)}><SelectTrigger id="sponsorStatus" aria-label="Sponsor status"><SelectValue /></SelectTrigger><SelectContent>{["NOT_REQUIRED", "DRAFT", "PENDING", "APPROVED", "REJECTED"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>)}{optionSelect("sponsorId", "Sponsor person", users)}</section>
        <section className="space-y-4"><h2 className="text-lg font-semibold">Outcomes and risk</h2>{control("successCriteria", "Success criteria", <Textarea id="successCriteria" value={String(value.successCriteria ?? "")} onChange={(e) => update("successCriteria", e.target.value)} />)}{control("priority", "Priority", <Select value={String(value.priority ?? "MEDIUM")} onValueChange={(v) => update("priority", v)}><SelectTrigger id="priority" aria-label="Priority"><SelectValue /></SelectTrigger><SelectContent>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>)}{control("health", "Health", <Select value={String(value.health ?? "NOT_SET")} onValueChange={(v) => update("health", v)}><SelectTrigger id="health" aria-label="Health"><SelectValue /></SelectTrigger><SelectContent>{["NOT_SET", "ON_TRACK", "AT_RISK", "OFF_TRACK"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>)}{optionSelect("workAreaId", "PMO work area", workAreas)}</section>
        {control("makeFloating", "Make Floating", <div className="flex items-center gap-2"><Checkbox id="makeFloating" aria-label="Make Floating" checked={Boolean(value.makeFloating)} onCheckedChange={(checked) => update("makeFloating", Boolean(checked))} /><Label htmlFor="makeFloating">Make Floating (Team Pool)</Label></div>)}
        <ProjectChildrenEditor value={value} onChange={(children) => onChange({ ...value, ...children })} />
    </div>;
}
