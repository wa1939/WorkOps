"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    fetchViewAggregate,
    ViewAggregateConflictError,
    ViewAggregateSelectorError,
    withViewAggregateDefault,
    type ViewAggregateResponse,
} from "@/lib/view-aggregate-client";
import type { ViewQuickFilter } from "@/lib/view-task-client";
import type { Block } from "./block-editor";

const TONE_CLASSES: Record<string, string> = {
    violet: "from-violet-500/20 to-violet-600/5 border-violet-500/30 text-violet-200",
    blue: "from-blue-500/20 to-blue-600/5 border-blue-500/30 text-blue-200",
    emerald: "from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 text-emerald-200",
    amber: "from-amber-500/20 to-amber-600/5 border-amber-500/30 text-amber-200",
    rose: "from-rose-500/20 to-rose-600/5 border-rose-500/30 text-rose-200",
};

const METRIC_LABELS: Record<string, string> = {
    "my-open": "My open tasks",
    "my-overdue": "My overdue tasks",
    "my-due-today": "Due today",
    "my-due-week": "Due this week",
    "team-done-week": "Team done this week",
    "team-overdue": "Team overdue",
    "active-projects": "Active projects",
    "on-track-kpis": "On-track KPIs",
    "at-risk-kpis": "At-risk KPIs",
};

type StatState =
    | { status: "loading" }
    | { status: "ready"; response: Extract<ViewAggregateResponse, { kind: "metric" }> }
    | { status: "error"; message: string }
    | { status: "conflict"; message: string };

function errorMessage(label: string, error?: unknown): string {
    if (error instanceof ViewAggregateSelectorError) {
        switch (error.code) {
            case "unsupported-metric":
                return "This block uses an unsupported metric. Choose a supported metric and try again.";
            case "unsupported-chart":
                return "This block uses an unsupported chart selector. Choose a supported metric and try again.";
            case "multiple":
                return "This block must use exactly one supported selector. Remove the extra selector and try again.";
            case "missing":
                return "This block is missing a metric selector. Choose a supported metric and try again.";
        }
    }
    return `Could not load ${label}. Try again.`;
}

export function StatTileBlock({
    block,
    activeChips,
}: {
    block: Block;
    activeChips: ReadonlySet<ViewQuickFilter | string>;
}) {
    const aggregateBlock = useMemo(() => withViewAggregateDefault(block, "metric"), [block]);
    const metric = typeof aggregateBlock.metric === "string" ? aggregateBlock.metric : "";
    const tone = (block.tone as string) ?? "violet";
    const label = (block.label as string) || METRIC_LABELS[metric] || metric || "Metric";
    const stableChips = useMemo(() => new Set(activeChips), [activeChips]);
    const [state, setState] = useState<StatState>({ status: "loading" });
    const [retryNonce, setRetryNonce] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;
        setState({ status: "loading" });

        void Promise.resolve()
            .then(() => fetchViewAggregate(aggregateBlock, stableChips, controller.signal))
            .then((response) => {
                if (cancelled) return;
                if (response.kind !== "metric") {
                    setState({ status: "error", message: errorMessage(label) });
                    return;
                }
                setState({ status: "ready", response });
            })
            .catch((error: unknown) => {
                if (cancelled || controller.signal.aborted) return;
                if (error instanceof ViewAggregateConflictError) {
                    setState({ status: "conflict", message: error.message });
                } else {
                    setState({ status: "error", message: errorMessage(label, error) });
                }
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [aggregateBlock, label, retryNonce, stableChips]);

    const toneClass = TONE_CLASSES[tone] ?? TONE_CLASSES.violet;

    return (
        <div className={cn("rounded-xl border bg-gradient-to-br p-5", toneClass)}>
            <p className="text-xs font-medium opacity-80">{label}</p>
            <div className="mt-2">
                {state.status === "loading" && (
                    <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-11 items-center">
                        <Loader2 className="h-7 w-7 animate-spin opacity-60" aria-hidden="true" />
                        <span className="sr-only">Loading {label}…</span>
                    </div>
                )}
                {state.status === "ready" && (
                    <p role="status" aria-live="polite" className="text-4xl font-bold tabular-nums">
                        {state.response.value}
                    </p>
                )}
                {state.status === "conflict" && (
                    <div role="alert" aria-live="assertive" className="space-y-3 text-sm">
                        <p>{state.message}</p>
                    </div>
                )}
                {state.status === "error" && (
                    <div role="alert" aria-live="assertive" className="space-y-3 text-sm">
                        <p>{state.message}</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="lg"
                            className="min-h-11"
                            onClick={() => setRetryNonce((value) => value + 1)}
                        >
                            Retry
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
