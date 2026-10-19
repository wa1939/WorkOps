"use client";

import { useMemo, useState } from "react";
import type { DrawerCustomField, TaskDrawerPayload } from "../types";

interface CustomFieldsSectionProps {
    task: TaskDrawerPayload;
    onRefresh: () => Promise<void>;
}

type FieldOption = { value: string; label: string };

function configOptions(field: DrawerCustomField): FieldOption[] {
    if (!field.config || typeof field.config !== "object") return [];
    const options = (field.config as { options?: unknown }).options;
    if (!Array.isArray(options)) return [];
    return options.flatMap((option): FieldOption[] => {
        if (typeof option === "string") return [{ value: option, label: option }];
        if (!option || typeof option !== "object") return [];
        const candidate = option as { value?: unknown; label?: unknown; name?: unknown };
        if (typeof candidate.value !== "string" && typeof candidate.name !== "string") return [];
        const value = String(candidate.value ?? candidate.name);
        return [{ value, label: typeof candidate.label === "string" ? candidate.label : value }];
    });
}

function valueText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(valueText).join(", ");
    return JSON.stringify(value);
}

function initialValue(task: TaskDrawerPayload, field: DrawerCustomField): unknown {
    return task.customFieldValues.find((entry) => entry.fieldId === field.id)?.value ?? "";
}

export function CustomFieldsSection({ task, onRefresh }: CustomFieldsSectionProps) {
    const fields = useMemo(() => task.project?.customFields?.slice().sort((a, b) => a.order - b.order) ?? [], [task.project?.customFields]);
    const [saving, setSaving] = useState<string | null>(null);
    if (fields.length === 0) return <p className="text-sm text-muted-foreground">No custom fields configured for this project.</p>;

    const save = async (field: DrawerCustomField, value: unknown) => {
        setSaving(field.id);
        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/custom-fields`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ fieldId: field.id, value }),
            });
            if (!response.ok) throw new Error("Could not save custom field");
            await onRefresh();
        } finally {
            setSaving(null);
        }
    };

    return (
        <div className="space-y-3">
            {fields.map((field) => {
                const value = initialValue(task, field);
                const options = configOptions(field);
                const disabled = saving === field.id;
                if (field.type === "selection") {
                    return (
                        <label key={field.id} className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                            <span>{field.label}</span>
                            <select disabled={disabled} value={valueText(value)} onChange={(event) => void save(field, event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring">
                                <option value="">Select…</option>
                                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        </label>
                    );
                }
                if (field.type === "people") {
                    const selected = Array.isArray(value) ? value.map(String) : valueText(value) ? [valueText(value)] : [];
                    return (
                        <label key={field.id} className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                            <span>{field.label}</span>
                            <select multiple disabled={disabled} value={selected} onChange={(event) => void save(field, Array.from(event.target.selectedOptions, (option) => option.value))} className="min-h-20 w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring">
                                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        </label>
                    );
                }
                const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
                return (
                    <label key={field.id} className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                        <span>{field.label}</span>
                        <input
                            type={inputType}
                            defaultValue={field.type === "date" ? valueText(value).slice(0, 10) : valueText(value)}
                            disabled={disabled}
                            onBlur={(event) => {
                                const raw = event.target.value;
                                const next = field.type === "number" && raw !== "" ? Number(raw) : raw;
                                if (next !== value) void save(field, next || null);
                            }}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none focus:ring-2 focus:ring-ring"
                        />
                    </label>
                );
            })}
        </div>
    );
}
