"use client";

import React from "react";

export function FieldDiff({ fieldName, suggestion }: { fieldName: string; suggestion: { base?: unknown; proposed?: unknown; confidence?: number; sourceRefs?: string[] } }) {
    return (
        <div className="rounded-lg border border-border p-2 text-xs" data-testid={`sabah-field-diff-${fieldName}`}>
            <div className="grid grid-cols-2 gap-2">
                <div>
                    <p className="font-semibold text-muted-foreground">Current</p>
                    <p>{String(suggestion.base ?? "(empty)")}</p>
                </div>
                <div>
                    <p className="font-semibold text-muted-foreground">Proposed</p>
                    <p className="text-primary">{String(suggestion.proposed ?? "(empty)")}</p>
                </div>
            </div>
            <p className="mt-1 text-muted-foreground">
                Confidence {Math.round((suggestion.confidence ?? 0) * 100)}%
                {suggestion.sourceRefs && suggestion.sourceRefs.length > 0 ? ` · from ${suggestion.sourceRefs.join(", ")}` : ""}
            </p>
        </div>
    );
}
