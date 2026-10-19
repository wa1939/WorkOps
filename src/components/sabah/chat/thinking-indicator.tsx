"use client";

import React from "react";
import { SabahAvatar } from "../sabah-avatar";

const DOT_DELAYS_MS = [0, 160, 320];

/**
 * Shown in the chat thread while Sabah is preparing a reply.
 * The client returns only the final reply (no token streaming), so this
 * indicator is the mid-stream "Sabah is working" affordance.
 * All animation is gated behind `motion-safe:` for prefers-reduced-motion.
 */
export function SabahThinkingIndicator() {
    return (
        <div role="status" aria-live="polite" data-testid="sabah-thinking" className="flex items-end gap-2">
            <SabahAvatar size="sm" status="working" className="mb-0.5" />
            <div className="flex items-center gap-2 rounded-2xl rounded-es-md border border-border bg-muted px-3 py-2">
                <span aria-hidden="true" className="flex items-center gap-1">
                    {DOT_DELAYS_MS.map((delay) => (
                        <span
                            key={delay}
                            className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/70 motion-safe:animate-bounce"
                            style={{ animationDelay: `${delay}ms`, animationDuration: "1000ms" }}
                        />
                    ))}
                </span>
                <span className="text-xs text-muted-foreground">Sabah is working…</span>
            </div>
        </div>
    );
}
