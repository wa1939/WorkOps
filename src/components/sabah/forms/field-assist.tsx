"use client";

import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { useSabahFormField, useSabahFormMaybe } from "./form-context";

const MAX_CONTEXT_FIELDS = 12;
const MAX_CONTEXT_VALUE_CHARS = 2000;
const MAX_CURRENT_VALUE_CHARS = 8000;

function asFieldText(value: unknown): string {
    return typeof value === "string" ? value : value == null ? "" : String(value);
}

/**
 * Labeled icon button associated with its input (via aria-describedby and
 * matching ids). It sits OUTSIDE the native input — never inside it.
 *
 * Without an onAssist override it asks Sabah (POST /api/ai/field-assist) to
 * draft a value for this field, stages it as a suggestion, and opens the
 * review flow so the Current/Proposed diff and explicit Apply appear.
 */
export function FieldAssist({ fieldName, onAssist }: { fieldName: string; onAssist?: (action: string) => void }) {
    const form = useSabahFormMaybe();
    const field = useSabahFormField(fieldName);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    if (!form || !field || field.actions.length === 0) {
        return null;
    }
    const assistId = `sabah-assist-${fieldName}`;

    const generate = async () => {
        setGenerating(true);
        setError(null);
        try {
            const currentValue = asFieldText(field.value).slice(0, MAX_CURRENT_VALUE_CHARS);
            const context = Object.fromEntries(
                Object.entries(form.snapshot.fields)
                    .filter(([name, entry]) => name !== fieldName && asFieldText(entry.value).trim() !== "")
                    .slice(0, MAX_CONTEXT_FIELDS)
                    .map(([name, entry]) => [name, asFieldText(entry.value).slice(0, MAX_CONTEXT_VALUE_CHARS)])
            );
            const response = await fetch("/api/ai/field-assist", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    entityType: form.snapshot.entityType,
                    fieldName,
                    fieldLabel: field.label,
                    currentValue,
                    context,
                }),
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => null)) as { error?: string } | null;
                throw new Error(body?.error ?? "Sabah could not draft this field");
            }
            const data = (await response.json()) as { proposed: string; base: string };
            form.addSuggestion(fieldName, { proposed: data.proposed, base: currentValue });
            form.reviewAll();
        } catch (e) {
            setError((e as Error).message || "Sabah could not draft this field");
        } finally {
            setGenerating(false);
        }
    };

    return (
        <span className="inline-flex items-center gap-1.5">
            <button
                type="button"
                id={assistId}
                title="Generate with Sabah"
                aria-label={`Sabah assistance for ${field.label}`}
                aria-describedby={`sabah-field-${fieldName}`}
                disabled={generating}
                onClick={() => (onAssist ? onAssist(field.actions[0]) : void generate())}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-accent hover:ring-2 hover:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
                {generating ? (
                    <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
                ) : (
                    <span aria-hidden="true" className="text-[10px] font-bold">S</span>
                )}
            </button>
            <span aria-live="polite" className="text-xs text-red-600 dark:text-red-400">
                {error}
            </span>
        </span>
    );
}
