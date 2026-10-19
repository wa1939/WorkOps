"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { Block } from "./block-editor";
import { SabahDailyDashboard } from "./sabah-daily-dashboard";

const ACCENTS = {
    sky: { border: "border-sky-500/30", surface: "bg-sky-500/5", live: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
    plum: { border: "border-fuchsia-500/30", surface: "bg-fuchsia-500/5", live: "bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300" },
    ember: { border: "border-orange-500/30", surface: "bg-orange-500/5", live: "bg-orange-500/10 text-orange-700 dark:text-orange-300" },
    sage: { border: "border-emerald-500/30", surface: "bg-emerald-500/5", live: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
} as const;

function isAccent(value: Block["assistantAccent"]): value is keyof typeof ACCENTS {
    return typeof value === "string" && value in ACCENTS;
}

export function SabahWorkspaceBlock({ block, userId, viewColor: _viewColor, viewId }: { block: Block; userId: string; viewColor?: string; viewId?: string }) {
    const layout = block.assistantLayout === "focused" ? "focused" : "context";
    const accent = isAccent(block.assistantAccent) ? block.assistantAccent : "sky";
    const palette = ACCENTS[accent];

    return (
        <section
            data-testid={`sabah-workspace-${block.id}`}
            data-assistant-layout={layout}
            data-assistant-accent={accent}
            aria-labelledby={`sabah-workspace-title-${block.id}`}
            className={cn("min-w-0", palette.surface)}
        >
            <h2 id={`sabah-workspace-title-${block.id}`} className="sr-only">{layout === "focused" ? "Focused work with Sabah" : "Your day with Sabah"}</h2>
            <SabahDailyDashboard blockId={block.id} userId={userId} accent={accent} layout={layout} viewId={viewId} />
        </section>
    );
}
