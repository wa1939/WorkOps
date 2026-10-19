"use client";

import { useEffect, useState } from "react";
import type { TaskDrawerPayload, TaskDrawerPatch } from "../types";

export interface DescriptionSectionProps {
    task: TaskDrawerPayload;
    onUpdate: (patch: TaskDrawerPatch) => Promise<TaskDrawerPayload>;
}

export function DescriptionSection({ task, onUpdate }: DescriptionSectionProps) {
    const [draft, setDraft] = useState(task.description ?? "");
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setDraft(task.description ?? "");
    }, [task.description]);

    const original = task.description ?? "";
    const dirty = draft !== original;

    const save = async () => {
        if (!dirty) {
            setEditing(false);
            return;
        }
        setSaving(true);
        try {
            await onUpdate({ description: draft.trim() ? draft : null });
            setEditing(false);
        } finally {
            setSaving(false);
        }
    };

    if (!editing) {
        return (
            <button type="button" onClick={() => setEditing(true)} className="block min-h-20 w-full cursor-text rounded-md border border-transparent p-2 text-left text-sm hover:border-border hover:bg-muted/30">
                <span className={original ? "whitespace-pre-wrap text-foreground" : "text-muted-foreground"}>
                    {original || "Add a description…"}
                </span>
            </button>
        );
    }

    return (
        <div className="space-y-2">
            {/* TODO: replace the v1 textarea with lazy Tiptap + DOMPurify in the editor phase. */}
            <textarea
                autoFocus
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void save()}
                onKeyDown={(event) => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        setDraft(original);
                        setEditing(false);
                    }
                }}
                placeholder="Describe this task…"
                className="min-h-28 w-full resize-y rounded-md border border-input bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                aria-label="Task description"
            />
            <p className="text-xs text-muted-foreground">Changes save when you leave the editor. Press Escape to discard.</p>
        </div>
    );
}
