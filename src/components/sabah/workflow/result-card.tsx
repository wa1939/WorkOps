"use client";

import React from "react";

export type ResultCardData = {
    summary: string;
    entityLinks: Array<{ type: string; id: string; href: string; label: string }>;
    warnings: string[];
    reversible: boolean;
    error?: string;
    correlationId?: string;
};

export function ResultCard({ result, onUndo, onRetry }: { result: ResultCardData; onUndo?: () => void; onRetry?: () => void }) {
    const failed = Boolean(result.error);
    return (
        <section aria-label={failed ? "Failed result" : "Result"} className={"rounded-xl border p-3 " + (failed ? "border-red-500/40 bg-red-500/5" : "border-border bg-card")}>
            <h3 className="text-sm font-semibold">{result.summary}</h3>

            {failed && (
                <div className="mt-1 space-y-1">
                    <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
                    {result.correlationId && (
                        <p className="font-mono text-xs text-muted-foreground" data-testid="result-correlation">
                            Reference: {result.correlationId} — include this when reporting the issue.
                        </p>
                    )}
                </div>
            )}

            {result.entityLinks.length > 0 && (
                <ul className="mt-2 space-y-1">
                    {result.entityLinks.map((link) => (
                        <li key={`${link.type}-${link.id}`} className="text-sm">
                            <a href={link.href} className="text-primary underline-offset-2 hover:underline">
                                {link.label}
                            </a>
                        </li>
                    ))}
                </ul>
            )}

            {result.warnings.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 ps-4 text-xs text-amber-600 dark:text-amber-400">
                    {result.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                    ))}
                </ul>
            )}

            <div className="mt-3 flex gap-2">
                {!failed && result.reversible && onUndo && (
                    <button
                        type="button"
                        onClick={onUndo}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    >
                        Undo
                    </button>
                )}
                {failed && onRetry && (
                    <button
                        type="button"
                        onClick={onRetry}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    >
                        Retry
                    </button>
                )}
            </div>
        </section>
    );
}
