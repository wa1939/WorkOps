"use client";

import React from "react";
import { useSabahForm } from "./form-context";
import { FieldDiff } from "./field-diff";

export function FormAssistMenu() {
    const form = useSabahForm();
    const suggestionCount = Object.keys(form.suggestions).length;

    if (suggestionCount === 0) {
        return null;
    }

    const reviewing = form.pending.length > 0 || form.conflicts.length > 0 || form.applySummary != null;

    return (
        <div className="rounded-xl border border-border bg-card p-3" data-testid="sabah-form-assist">
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={form.fillEmptyOnly}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                    Fill empty fields only
                </button>
                <button
                    type="button"
                    onClick={form.reviewAll}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                    {form.conflicts.length > 0 || form.pending.length > 0 ? "Review with Sabah" : "Suggest with diff"}
                </button>
                {reviewing && (
                    <button
                        type="button"
                        onClick={() => void form.applyPending()}
                        disabled={form.pending.length === 0}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-emerald-600"
                    >
                        Apply {form.pending.length} {form.pending.length === 1 ? "field" : "fields"}
                    </button>
                )}
                {form.applySummary && (
                    <span role="status" className="text-xs text-muted-foreground">
                        {form.applySummary}
                    </span>
                )}
            </div>
            {Object.entries(form.errors).length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Validation errors">
                    {Object.entries(form.errors).map(([name, message]) => (
                        <li key={name} className="text-xs text-red-600 dark:text-red-400">
                            {name}: {message}
                        </li>
                    ))}
                </ul>
            )}
            {form.conflicts.length > 0 && (
                <ul className="mt-2 space-y-1" aria-label="Conflicting fields">
                    {form.conflicts.map((name) => (
                        <li key={name} className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                            <span>
                                {name} changed since Sabah drafted it — conflict
                            </span>
                            <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "KEEP")}>
                                Keep mine
                            </button>
                            <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "USE_SABAH")}>
                                Use Sabah
                            </button>
                            <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "MERGE")}>
                                Merge
                            </button>
                            <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "IGNORE")}>
                                Ignore
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {form.pending.length > 0 && (
                <ul className="mt-2 space-y-2" aria-label="Pending suggestions">
                    {form.pending.map((name) => {
                        const suggestion = form.suggestions[name];
                        return (
                            <li key={name} className="space-y-1">
                                {suggestion && (
                                    <FieldDiff fieldName={name} suggestion={suggestion} />
                                )}
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <span>{name}</span>
                                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "KEEP")}>
                                        Keep mine
                                    </button>
                                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "USE_SABAH")}>
                                        Use Sabah
                                    </button>
                                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "MERGE")}>
                                        Merge
                                    </button>
                                    <button type="button" className="underline-offset-2 hover:underline" onClick={() => void form.resolveField(name, "IGNORE")}>
                                        Ignore
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
