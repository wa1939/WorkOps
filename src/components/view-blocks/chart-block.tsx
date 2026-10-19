"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    fetchViewAggregate,
    ViewAggregateConflictError,
    ViewAggregateSelectorError,
    withViewAggregateDefault,
    type ViewAggregatePoint,
    type ViewAggregateResponse,
} from "@/lib/view-aggregate-client";
import type { ViewQuickFilter } from "@/lib/view-task-client";
import type { Block } from "./block-editor";

const STATUS_COLORS: Record<string, string> = {
    TODO: "--status-todo-fg",
    DOING: "--status-doing-fg",
    BLOCKED: "--status-blocked-fg",
    WAITING: "--status-waiting-fg",
    DONE: "--status-done-fg",
    CANCELED: "--status-canceled-fg",
};

const PRIORITY_COLORS: Record<string, string> = {
    LOW: "--priority-low-fg",
    MEDIUM: "--priority-medium-fg",
    HIGH: "--priority-high-fg",
    URGENT: "--priority-urgent-fg",
};

const KPI_COLORS: Record<string, string> = {
    ON_TRACK: "--status-done-fg",
    AT_RISK: "--priority-high-fg",
    OFF_TRACK: "--status-blocked-fg",
};

const FALLBACK_COLORS = [
    "hsl(var(--primary))",
    "hsl(var(--status-doing-fg))",
    "hsl(var(--status-done-fg))",
    "hsl(var(--priority-high-fg))",
    "hsl(var(--priority-urgent-fg))",
    "hsl(var(--due-tomorrow-fg))",
];

type ChartState =
    | { status: "loading" }
    | { status: "ready"; response: Extract<ViewAggregateResponse, { kind: "chart" }> }
    | { status: "error"; message: string }
    | { status: "conflict"; message: string };

function errorMessage(title: string, error?: unknown): string {
    if (error instanceof ViewAggregateSelectorError) {
        switch (error.code) {
            case "unsupported-metric":
                return "This block uses an unsupported metric selector. Choose a supported chart and try again.";
            case "unsupported-chart":
                return "This block uses an unsupported chart. Choose a supported chart and try again.";
            case "multiple":
                return "This block must use exactly one supported selector. Remove the extra selector and try again.";
            case "missing":
                return "This block is missing a chart selector. Choose a supported chart and try again.";
        }
    }
    return `Could not load ${title || "chart"}. Try again.`;
}

function pointColor(chartKind: string, point: ViewAggregatePoint, index: number): string {
    const variables = chartKind === "task-by-status"
        ? STATUS_COLORS
        : chartKind === "task-by-priority"
            ? PRIORITY_COLORS
            : chartKind === "kpi-status"
                ? KPI_COLORS
                : undefined;
    const variable = variables?.[point.key];
    return variable ? `hsl(var(${variable}))` : FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

const tooltipStyle = {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    color: "hsl(var(--popover-foreground))",
    borderRadius: 8,
};

export function ChartBlock({
    block,
    activeChips,
}: {
    block: Block;
    activeChips: ReadonlySet<ViewQuickFilter | string>;
}) {
    const aggregateBlock = useMemo(() => withViewAggregateDefault(block, "chart"), [block]);
    const kind = typeof aggregateBlock.chartKind === "string" ? aggregateBlock.chartKind : "";
    const title = typeof block.title === "string" ? block.title : "";
    const stableChips = useMemo(() => new Set(activeChips), [activeChips]);
    const [state, setState] = useState<ChartState>({ status: "loading" });
    const [retryNonce, setRetryNonce] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        let cancelled = false;
        setState({ status: "loading" });

        void Promise.resolve()
            .then(() => fetchViewAggregate(aggregateBlock, stableChips, controller.signal))
            .then((response) => {
                if (cancelled) return;
                if (response.kind !== "chart") {
                    setState({ status: "error", message: errorMessage(title) });
                    return;
                }
                setState({ status: "ready", response });
            })
            .catch((error: unknown) => {
                if (cancelled || controller.signal.aborted) return;
                if (error instanceof ViewAggregateConflictError) {
                    setState({ status: "conflict", message: error.message });
                } else {
                    setState({ status: "error", message: errorMessage(title, error) });
                }
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [aggregateBlock, title, retryNonce, stableChips]);

    const shape = kind.includes("pie") || kind === "task-by-status" || kind === "kpi-by-perspective"
        ? "pie"
        : kind.includes("trend")
            ? "line"
            : "bar";

    return (
        <div className="rounded-xl border border-border bg-card p-4">
            {title && <h3 id={`chart-title-${block.id}`} className="mb-3 text-sm font-semibold">{title}</h3>}
            {state.status === "loading" && (
                <div role="status" aria-live="polite" aria-busy="true" className="flex h-64 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">Loading {title || "chart"}…</span>
                </div>
            )}
            {state.status === "conflict" && (
                <div role="alert" aria-live="assertive" className="space-y-3 p-3 text-sm">
                    <p>{state.message}</p>
                </div>
            )}
            {state.status === "error" && (
                <div role="alert" aria-live="assertive" className="space-y-3 p-3 text-sm">
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
            {state.status === "ready" && (
                <>
                    <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
                        <span>Total</span>
                        <span className="font-semibold tabular-nums text-foreground">{state.response.totalCount}</span>
                    </div>
                    {state.response.points.length === 0 ? (
                        <div role="status" aria-live="polite" className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                            No results for this chart.
                        </div>
                    ) : (
                        <div
                            aria-hidden="true"
                            aria-label={title || "Chart"}
                            className="h-64"
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                {shape === "pie" ? (
                                    <PieChart>
                                        <Pie data={state.response.points} dataKey="value" nameKey="label" outerRadius={80} innerRadius={30}>
                                            {state.response.points.map((point, index) => (
                                                <Cell key={point.key} fill={pointColor(kind, point, index)} />
                                            ))}
                                        </Pie>
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Legend wrapperStyle={{ fontSize: 12 }} />
                                    </PieChart>
                                ) : shape === "line" ? (
                                    <LineChart data={state.response.points}>
                                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.5} />
                                        <XAxis dataKey="label" fontSize={11} />
                                        <YAxis fontSize={11} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Line
                                            type="monotone"
                                            dataKey="value"
                                            stroke={pointColor(kind, state.response.points[0] as ViewAggregatePoint, 0)}
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                        />
                                    </LineChart>
                                ) : (
                                    <BarChart data={state.response.points}>
                                        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.5} />
                                        <XAxis dataKey="label" fontSize={11} />
                                        <YAxis fontSize={11} />
                                        <Tooltip contentStyle={tooltipStyle} />
                                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                            {state.response.points.map((point, index) => (
                                                <Cell key={point.key} fill={pointColor(kind, point, index)} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                )}
                            </ResponsiveContainer>
                        </div>
                    )}
                    <table className="sr-only">
                        <caption>{title || "Chart data"}</caption>
                        <thead>
                            <tr>
                                <th scope="col">Category</th>
                                <th scope="col">Count</th>
                            </tr>
                        </thead>
                        <tbody>
                            {state.response.points.map((point) => (
                                <tr key={point.key}>
                                    <td>{point.label}</td>
                                    <td>{point.value}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </>
            )}
        </div>
    );
}
