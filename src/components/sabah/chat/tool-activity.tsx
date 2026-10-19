"use client";

import React, { useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, Loader2 } from "lucide-react";
import type { LiveStreamNotice, LiveToolActivity, SabahStreamNoticeKind } from "../state/sabah-reducer";

const TOOL_LABELS: Record<string, string> = {
    createTask: "Creating task…",
    createTasks: "Creating tasks…",
    updateTaskStatus: "Updating status…",
    listMyTasks: "Listing your tasks…",
    searchTasks: "Searching tasks…",
    getTaskStats: "Counting tasks…",
    listProjects: "Listing projects…",
    listTeamMembers: "Looking up team…",
    listKpis: "Listing KPIs…",
    getTask: "Loading task…",
    listPmoActions: "Checking PMO actions…",
    getPmoAction: "Loading PMO action…",
    draftPmoFollowUp: "Drafting follow-up…",
    getIntakeRows: "Reading uploaded file…",
    cancelCreatedTasks: "Cancelling tasks…",
    reassignTask: "Reassigning task…",
    updateTaskFields: "Updating task…",
    logKpiUpdate: "Recording KPI update…",
    whatShouldIWorkOnNext: "Finding your next priority…",
    proposeMemoryOrPlaybookUpdate: "Preparing a workspace suggestion…",
    workspaceSearch: "Searching the workspace…",
};

const NOTICE_COPY: Record<SabahStreamNoticeKind, string> = {
    LIMIT_ITERATIONS: "Reasoning step limit reached. Ask Sabah to continue.",
    LIMIT_TOOL_CALLS: "Tool-call limit reached. Ask Sabah to continue.",
    LIMIT_CONTEXT: "Conversation context limit reached. Start a fresh chat or shorten the request.",
    COMPRESSION_PENDING: "Conversation context compression pending.",
    COMPRESSION_UNAVAILABLE: "Conversation context compression could not be scheduled.",
};

/**
 * Portable host boundary for the donor's `isCardTool` classification.
 *
 * DepartmentHub's workflow/action tools render their own conversation card, and
 * a failed/interrupted tool must remain visible instead of being folded into a
 * successful activity summary. The donor split logic itself is retained below;
 * this is the host's typed classification seam in place of assistant-ui's
 * `fallback-model` and `tool-render-class` modules.
 */
const ACTION_TOOL_NAMES = new Set([
    "proposeWorkflow",
    "proposeMemoryOrPlaybookUpdate",
    "createTask",
    "createTasks",
    "cancelCreatedTasks",
    "updateTaskStatus",
    "reassignTask",
    "updateTaskFields",
    "logKpiUpdate",
]);

function isActionTool(item: LiveToolActivity): boolean {
    return ACTION_TOOL_NAMES.has(item.name) || item.name.startsWith("propose");
}

function isNonCollapsibleActivity(item: LiveToolActivity): boolean {
    return !item.name || isActionTool(item) || item.status === "FAILED" || item.status === "INTERRUPTED";
}

/**
 * The donor `splitRunItems` contract, adapted from
 * `apps/desktop/src/components/assistant-ui/tool/fallback.tsx` at
 * 245e48008fa814b3251f50755eb656bd9fb86cb1 (MIT).
 *
 * Like the donor, this preserves the original order while splitting cards from
 * consecutive ephemeral activity. The host adapter additionally keeps action,
 * failed, and interrupted rows as cards so a truthful outcome can never be
 * hidden by a settled-success summary.
 */
export type ToolActivityRunItem =
    | { kind: "run"; start: number; end: number }
    | { kind: "card"; index: number };

export function splitToolActivityRuns(activity: readonly LiveToolActivity[]): ToolActivityRunItem[] {
    const items: ToolActivityRunItem[] = [];
    let run: Extract<ToolActivityRunItem, { kind: "run" }> | null = null;

    activity.forEach((item, index) => {
        if (isNonCollapsibleActivity(item)) {
            run = null;
            items.push({ index, kind: "card" });
            return;
        }

        if (run) {
            run.end = index;
        } else {
            run = { end: index, kind: "run", start: index };
            items.push(run);
        }
    });

    return items;
}

function humanizeToolName(name: string): string {
    const normalized = name
        .slice(0, 128)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/[^A-Za-z0-9 ]/g, " ")
        .trim()
        .replace(/\s+/g, " ");
    if (!normalized) return "Using a tool…";
    const title = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
    return `${title.slice(0, 80)}${title.length > 80 ? "…" : "…"}`;
}

export function friendlyToolLabel(name: string): string {
    return Object.prototype.hasOwnProperty.call(TOOL_LABELS, name) ? TOOL_LABELS[name] : humanizeToolName(name);
}

function statusCopy(status: LiveToolActivity["status"]): string {
    if (status === "RUNNING") return "Working";
    if (status === "SUCCEEDED") return "Completed";
    if (status === "INTERRUPTED") return "Outcome unknown";
    return "Couldn’t complete";
}

function StatusIcon({ status }: { status: LiveToolActivity["status"] }) {
    if (status === "RUNNING") return <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" />;
    if (status === "SUCCEEDED") return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />;
    if (status === "INTERRUPTED") return <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
    return <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-destructive" />;
}

function ToolActivityRow({ item, card = false }: { item: LiveToolActivity; card?: boolean }) {
    const label = friendlyToolLabel(item.name);
    const status = statusCopy(item.status);

    return (
        <li
            key={item.id}
            data-testid="sabah-tool-activity"
            data-status={item.status}
            data-tool-card={card ? "" : undefined}
            aria-label={`${label} ${status}`}
            className="flex min-w-0 items-center gap-1.5"
        >
            <StatusIcon status={item.status} />
            <span className="min-w-0 truncate">{label}</span>
            <span className="shrink-0">{status}</span>
        </li>
    );
}

/**
 * The donor `ToolRun`/`ToolGroupSlot` behavior, reduced to the host's live
 * activity shape. Settled successful runs get one disclosure row; a live run
 * stays expanded so the current work remains visible. The donor's assistant-ui
 * store, timestamps, ticker CSS, and tool-result renderer are intentionally not
 * pulled into the React 18 host.
 */
function ToolActivityRun({ items }: { items: readonly LiveToolActivity[] }) {
    const [open, setOpen] = useState(false);
    const live = items.some((item) => item.status === "RUNNING");
    const summary = live ? `Working with ${items.length} ${items.length === 1 ? "tool" : "tools"}…` : `Completed ${items.length} ${items.length === 1 ? "tool" : "tools"}`;

    if (items.length < 2) {
        return <ToolActivityRow item={items[0]} />;
    }

    if (live) {
        return (
            <li data-tool-group="" data-tool-live="" className="min-w-0">
                <div data-testid="sabah-tool-summary" aria-label={summary} className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                    <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" />
                    <span className="min-w-0 truncate">{summary}</span>
                </div>
                <ul data-tool-ticker="" className="mt-1 space-y-1">
                    {items.map((item) => <ToolActivityRow item={item} key={item.id} />)}
                </ul>
            </li>
        );
    }

    return (
        <li data-tool-group="" className="min-w-0">
            <button
                type="button"
                data-testid="sabah-tool-summary"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex w-full min-w-0 items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
                <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="min-w-0 flex-1 truncate">{summary}</span>
                <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
                <ul className="mt-1 space-y-1 ps-5">
                    {items.map((item) => <ToolActivityRow item={item} key={item.id} />)}
                </ul>
            )}
        </li>
    );
}

export function SabahToolActivity({ items }: { items: LiveToolActivity[] }) {
    if (items.length === 0) return null;
    const split = splitToolActivityRuns(items);

    return (
        <ul aria-label="Sabah tool activity" className="mt-1 space-y-1 ps-8 text-xs text-muted-foreground">
            {split.map((part) => {
                if (part.kind === "card") {
                    const item = items[part.index];
                    return <ToolActivityRow card item={item} key={`card:${item.id}:${part.index}`} />;
                }

                const runItems = items.slice(part.start, part.end + 1);
                return <ToolActivityRun items={runItems} key={`run:${part.start}`} />;
            })}
        </ul>
    );
}

export function SabahStreamNotices({ notices }: { notices: LiveStreamNotice[] }) {
    if (notices.length === 0) return null;
    return (
        <ul aria-label="Sabah stream notices" className="mt-1 space-y-1 ps-8 text-xs text-muted-foreground">
            {notices.map((notice) => (
                <li key={notice.id} data-testid="sabah-stream-notice" role="status" className="rounded border border-border/70 bg-muted/50 px-2 py-1.5">
                    {NOTICE_COPY[notice.kind]}
                </li>
            ))}
        </ul>
    );
}
