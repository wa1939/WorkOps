"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import type { Block } from "./block-editor";

const LAYOUTS = [
    { value: "context", label: "Dashboard with context", description: "See your briefing, priority work, and AI tools together." },
    { value: "focused", label: "Focused dashboard", description: "Keep a shorter work list for the next decision." },
] as const;

const ACCENTS = [
    { value: "sky", label: "Sky" },
    { value: "plum", label: "Plum" },
    { value: "ember", label: "Ember" },
    { value: "sage", label: "Sage" },
] as const;

export function AssistantWorkspaceBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (block: Block) => void }) {
    const layout = block.assistantLayout === "focused" ? "focused" : "context";
    const accent = ACCENTS.some((option) => option.value === block.assistantAccent) ? block.assistantAccent : "sky";

    return (
        <fieldset className="space-y-4" aria-label="Sabah workspace configuration">
            <legend className="text-sm font-semibold">Sabah workspace</legend>
            <p className="text-xs text-muted-foreground">AI runs when you choose an action. Task changes still need your approval.</p>
            <div className="space-y-2">
                <Label>Layout</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                    {LAYOUTS.map((option) => (
                        <label key={option.value} className="flex cursor-pointer gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                            <input
                                type="radio"
                                name={`assistant-layout-${block.id}`}
                                value={option.value}
                                checked={layout === option.value}
                                onChange={() => onUpdate({ ...block, assistantLayout: option.value })}
                                className="mt-1 h-4 w-4 accent-primary"
                            />
                            <span className="min-w-0">
                                <span className="block text-sm font-medium">{option.label}</span>
                                <span className="block text-xs text-muted-foreground">{option.description}</span>
                            </span>
                        </label>
                    ))}
                </div>
            </div>
            <div className="space-y-2">
                <Label htmlFor={`assistant-accent-${block.id}`}>Accent palette</Label>
                <select
                    id={`assistant-accent-${block.id}`}
                    aria-label="Accent palette"
                    value={accent}
                    onChange={(event) => onUpdate({ ...block, assistantAccent: event.target.value as Block["assistantAccent"] })}
                    className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {ACCENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
            </div>
        </fieldset>
    );
}
