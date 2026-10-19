"use client";

import React from "react";
import type { ActivityItem } from "../state/sabah-reducer";

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
    CHECKED: "Checked",
    PROPOSED: "Proposed",
    APPROVED: "Approved",
    CHANGED: "Changed",
    VERIFIED: "Verified",
    FAILED: "Failed",
    UNDONE: "Undone",
    WAITING: "Waiting",
};

const KIND_CLASS: Record<ActivityItem["kind"], string> = {
    CHECKED: "text-muted-foreground",
    PROPOSED: "text-sky-600 dark:text-sky-400",
    APPROVED: "text-amber-600 dark:text-amber-400",
    CHANGED: "text-violet-600 dark:text-violet-400",
    VERIFIED: "text-emerald-600 dark:text-emerald-400",
    FAILED: "text-red-600 dark:text-red-400",
    UNDONE: "text-muted-foreground",
    WAITING: "text-muted-foreground",
};

export function ActivityView({ items, onOpenCorrelation }: { items: ActivityItem[]; onOpenCorrelation: (correlationId: string) => void }) {
    if (items.length === 0) {
        return <p className="p-4 text-sm text-muted-foreground">No activity yet.</p>;
    }
    return (
        <ul aria-label="Sabah activity" className="space-y-1 p-2">
            {items.map((item) => (
                <li key={item.id} className="flex items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-accent/50">
                    <span className={"shrink-0 text-xs font-semibold " + KIND_CLASS[item.kind]}>{KIND_LABEL[item.kind]}</span>
                    <span className="min-w-0 flex-1">{item.summary}</span>
                    <button
                        type="button"
                        onClick={() => onOpenCorrelation(item.correlationId)}
                        className="shrink-0 font-mono text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                        aria-label={`Trace ${item.correlationId}`}
                    >
                        {item.correlationId}
                    </button>
                </li>
            ))}
        </ul>
    );
}
