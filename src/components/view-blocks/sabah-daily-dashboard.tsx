"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
    ArrowUpRight,
    CalendarDays,
    CheckCircle2,
    CircleAlert,
    Clock3,
    FileText,
    ListChecks,
    MessageCircle,
    RefreshCw,
    Sparkles,
    Target,
    WandSparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createSabahClient } from "@/components/sabah/client";
import { SabahWorkspaceHost } from "@/components/sabah/sabah-host";
import { useSabahMaybe } from "@/components/sabah/state/sabah-context";
import { workflowSnapshotSchema, type WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { DEFAULT_TIME_ZONE } from "@/lib/workload/calendar";
import { shiftCalendarDate } from "@/lib/pmo/date";
import { fetchViewAggregate } from "@/lib/view-aggregate-client";
import { buildTaskSummaryFacts, formatTaskSummaryFacts, sameTaskSummaryFacts, type TaskSummaryFacts } from "@/lib/ai/task-summary-facts";
import type { Block } from "./block-editor";
import { ResultCard, type ResultCardData } from "@/components/sabah/workflow/result-card";
import { StatusStack } from "@/components/sabah/workflow/status-stack";
import type { TaskViewTask } from "./task-view-block";

type AssistantAccent = "sky" | "plum" | "ember" | "sage";
type MetricKey = "my-open" | "my-due-today" | "my-overdue" | "my-done-week";
type SummaryMode = "briefing" | "plan" | "update";
type AiStatus = "idle" | "loading" | "ready" | "error";
type DashboardLayout = "context" | "focused";

type BreakdownSuggestion = { title: string; estimateMinutes?: number };
type QuickAddSuggestion = {
    title: string;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    estimateMinutes?: number;
    dueInDays?: number;
};
type DashboardData = {
    priorityTasks: TaskViewTask[];
    blockerTasks: TaskViewTask[];
    metrics: Record<MetricKey, number | null>;
    metricErrors: Partial<Record<MetricKey, string>>;
};
type SummaryResult = { mode: SummaryMode; summary: string; tasks: TaskViewTask[]; facts: TaskSummaryFacts; generatedAt: string };
type AuthoritativeTaskSnapshot = {
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
    priority?: string;
    description?: string | null;
    projectId?: string | null;
};
type WorkflowSource = "breakdown" | "capture";
type WorkflowDraftStep = { title: string; args: Record<string, unknown> };
type WorkflowDraft = {
    source: WorkflowSource;
    sourceTaskId: string | null;
    sourceTaskTitle: string | null;
    sourceText: string | null;
    steps: WorkflowDraftStep[];
    idempotencyKey: string;
};
type DashboardProps = { blockId: string; userId: string; accent: AssistantAccent; layout?: DashboardLayout; viewId?: string };

const METRICS: Array<{ key: MetricKey; label: string; icon: typeof Target; tone: string }> = [
    { key: "my-open", label: "Open", icon: Target, tone: "text-sky-600 dark:text-sky-300" },
    { key: "my-due-today", label: "Due today", icon: CalendarDays, tone: "text-amber-600 dark:text-amber-300" },
    { key: "my-overdue", label: "Overdue", icon: CircleAlert, tone: "text-rose-600 dark:text-rose-300" },
    { key: "my-done-week", label: "Done this week", icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-300" },
];

const ACCENT_STYLES: Record<AssistantAccent, { border: string; button: string; focus: string; dot: string }> = {
    sky: { border: "border-sky-500/35", button: "bg-sky-700 text-white hover:bg-sky-800 dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400", focus: "focus-visible:ring-sky-700 dark:focus-visible:ring-sky-400", dot: "bg-sky-500" },
    plum: { border: "border-fuchsia-500/35", button: "bg-fuchsia-700 text-white hover:bg-fuchsia-800 dark:bg-fuchsia-500 dark:text-slate-950 dark:hover:bg-fuchsia-400", focus: "focus-visible:ring-fuchsia-700 dark:focus-visible:ring-fuchsia-400", dot: "bg-fuchsia-500" },
    ember: { border: "border-orange-500/35", button: "bg-orange-700 text-white hover:bg-orange-800 dark:bg-orange-500 dark:text-slate-950 dark:hover:bg-orange-400", focus: "focus-visible:ring-orange-700 dark:focus-visible:ring-orange-400", dot: "bg-orange-500" },
    sage: { border: "border-emerald-500/35", button: "bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400", focus: "focus-visible:ring-emerald-700 dark:focus-visible:ring-emerald-400", dot: "bg-emerald-500" },
};

const ACTIVE_STATUSES = "TODO,DOING,BLOCKED,WAITING";

function dashboardDate(): string {
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: DEFAULT_TIME_ZONE }).format(new Date());
}

function taskUrl(kind: "priority" | "blockers"): string {
    const params = new URLSearchParams({
        assigneeIds: "@me",
        status: kind === "priority" ? ACTIVE_STATUSES : "BLOCKED,WAITING",
        sortBy: kind === "priority" ? "priority" : "updatedAt",
        sortDir: "desc",
        offset: "0",
    });
    return `/api/tasks/view-data?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function normalizeTask(value: unknown): TaskViewTask | null {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.title !== "string") return null;
    if (value.status !== undefined && typeof value.status !== "string") return null;
    if (value.priority !== undefined && typeof value.priority !== "string") return null;
    if (value.dueAt !== undefined && value.dueAt !== null && typeof value.dueAt !== "string") return null;
    if (value.dueDate !== undefined && value.dueDate !== null && typeof value.dueDate !== "string") return null;
    if (value.assignments !== undefined && (!Array.isArray(value.assignments) || value.assignments.some((item) => !isRecord(item) || typeof item.userId !== "string"))) return null;
    if (value.project !== undefined && value.project !== null && (!isRecord(value.project) || (value.project.id !== undefined && typeof value.project.id !== "string") || (value.project.name !== undefined && typeof value.project.name !== "string" && value.project.name !== null))) return null;
    const project = isRecord(value.project) && (typeof value.project.id === "string" || typeof value.project.name === "string" || value.project.name === null)
        ? { id: typeof value.project.id === "string" ? value.project.id : undefined, name: typeof value.project.name === "string" || value.project.name === null ? value.project.name : undefined }
        : null;
    const dueAt = typeof value.dueAt === "string" ? value.dueAt : typeof value.dueDate === "string" ? value.dueDate : null;
    if (dueAt && Number.isNaN(new Date(dueAt).getTime())) return null;
    const assignments = Array.isArray(value.assignments)
        ? value.assignments.filter((item): item is { userId: string } => isRecord(item) && typeof item.userId === "string")
        : [];
    return {
        ...value,
        id: value.id,
        title: value.title,
        status: typeof value.status === "string" ? value.status : "TODO",
        priority: typeof value.priority === "string" ? value.priority : "MEDIUM",
        dueAt,
        dueDate: dueAt,
        project,
        assignments,
    };
}

async function responseJson(response: Response): Promise<unknown> {
    if (!response.ok) {
        let message = `Request failed with status ${response.status}`;
        try {
            const body = await response.json();
            if (isRecord(body) && typeof body.error === "string") message = body.error;
        } catch {
            // Keep the status-based message when the server did not return JSON.
        }
        throw new Error(message);
    }
    return response.json();
}

async function loadDashboardData(signal: AbortSignal): Promise<DashboardData> {
    const [priorityResponse, blockerResponse] = await Promise.all([
        fetch(taskUrl("priority"), { signal }),
        fetch(taskUrl("blockers"), { signal }),
    ]);
    const [priorityPayload, blockerPayload] = await Promise.all([
        responseJson(priorityResponse),
        responseJson(blockerResponse),
    ]);
    const rowsFrom = (payload: unknown, label: string): TaskViewTask[] => {
        if (!isRecord(payload) || !Array.isArray(payload.rows) || typeof payload.totalCount !== "number" || !Number.isInteger(payload.totalCount) || payload.totalCount < 0) {
            throw new Error(`The ${label} task response was not valid.`);
        }
        if (payload.nextOffset !== null && (typeof payload.nextOffset !== "number" || !Number.isInteger(payload.nextOffset) || payload.nextOffset <= 0)) {
            throw new Error(`The ${label} task pagination response was not valid.`);
        }
        return payload.rows.map((row) => {
            const task = normalizeTask(row);
            if (!task) throw new Error(`The ${label} task rows were not valid.`);
            return task;
        });
    };
    const metricResults = await Promise.all(METRICS.map(async (metric) => {
        try {
            const block = { id: `sabah-metric-${metric.key}`, type: "statTile", metric: metric.key } as Block;
            const response = await fetchViewAggregate(block, new Set(), signal);
            return { key: metric.key, value: response.kind === "metric" ? response.value : null, error: null };
        } catch (error) {
            if (signal.aborted) throw error;
            return { key: metric.key, value: null, error: error instanceof Error ? error.message : "Metric unavailable" };
        }
    }));
    const metrics = Object.fromEntries(metricResults.map((metric) => [metric.key, metric.value])) as Record<MetricKey, number | null>;
    const metricErrors = Object.fromEntries(metricResults.filter((metric) => metric.error).map((metric) => [metric.key, metric.error])) as Partial<Record<MetricKey, string>>;
    return { priorityTasks: rowsFrom(priorityPayload, "priority").slice(0, 8), blockerTasks: rowsFrom(blockerPayload, "blocker").slice(0, 6), metrics, metricErrors };
}

function priorityLabel(priority: string): string {
    return priority.toLowerCase().replace(/^./, (value) => value.toUpperCase());
}

function statusLabel(status: string): string {
    return status === "DOING" ? "In progress" : status === "BLOCKED" ? "Blocked" : status === "WAITING" ? "Waiting" : status === "TODO" ? "To do" : status;
}

function formatDueDate(dueAt: string | null): string | null {
    if (!dueAt) return null;
    const date = new Date(dueAt);
    return Number.isNaN(date.getTime()) ? null : formatInTimeZone(date, DEFAULT_TIME_ZONE, "MMM d");
}

function parseAuthoritativeTaskSnapshot(value: unknown, expectedIds: readonly string[], purpose: string): TaskViewTask[] {
    if (!Array.isArray(value) || value.length !== expectedIds.length) {
        throw new Error(`Sabah returned no authoritative task snapshot for this ${purpose}.`);
    }
    return value.map((candidate, index) => {
        if (!isRecord(candidate) || candidate.id !== expectedIds[index] || typeof candidate.title !== "string" || typeof candidate.status !== "string" || (candidate.dueAt !== null && typeof candidate.dueAt !== "string")) {
            throw new Error(`Sabah returned a malformed authoritative task snapshot for this ${purpose}.`);
        }
        if (candidate.priority !== undefined && typeof candidate.priority !== "string") throw new Error(`Sabah returned a malformed authoritative task snapshot for this ${purpose}.`);
        if (candidate.description !== undefined && candidate.description !== null && typeof candidate.description !== "string") throw new Error(`Sabah returned a malformed authoritative task snapshot for this ${purpose}.`);
        if (candidate.projectId !== undefined && candidate.projectId !== null && typeof candidate.projectId !== "string") throw new Error(`Sabah returned a malformed authoritative task snapshot for this ${purpose}.`);
        const snapshot: AuthoritativeTaskSnapshot = {
            id: candidate.id,
            title: candidate.title,
            status: candidate.status,
            dueAt: candidate.dueAt,
            ...(typeof candidate.priority === "string" ? { priority: candidate.priority } : {}),
            ...(candidate.description === undefined ? {} : { description: candidate.description }),
            ...(candidate.projectId === undefined ? {} : { projectId: candidate.projectId }),
        };
        const task = normalizeTask({
            id: snapshot.id,
            title: snapshot.title,
            status: snapshot.status,
            priority: snapshot.priority ?? "MEDIUM",
            dueAt: snapshot.dueAt,
            project: snapshot.projectId ? { id: snapshot.projectId } : null,
            assignments: [],
        });
        if (!task) throw new Error(`Sabah returned a malformed authoritative task snapshot for this ${purpose}.`);
        return task;
    });
}

function parseAuthoritativeSummaryFacts(value: unknown, tasks: readonly TaskViewTask[], purpose: string): TaskSummaryFacts {
    const expected = buildTaskSummaryFacts(tasks);
    if (!sameTaskSummaryFacts(value, expected)) {
        throw new Error(`Sabah returned no authoritative numeric facts for this ${purpose}.`);
    }
    return expected;
}

function uniqueTasks(tasks: TaskViewTask[]): TaskViewTask[] {
    const seen = new Set<string>();
    return tasks.filter((task) => {
        if (seen.has(task.id)) return false;
        seen.add(task.id);
        return true;
    });
}

function taskIdsFor(tasks: TaskViewTask[]): string[] {
    return uniqueTasks(tasks).map((task) => task.id).slice(0, 50);
}

function contextFor(surface: string, mode: string, tasks: TaskViewTask[]): Record<string, unknown> {
    return { surface, mode, taskIds: taskIdsFor(tasks), date: formatInTimeZone(new Date(), DEFAULT_TIME_ZONE, "yyyy-MM-dd") };
}

function dueDateAfterDays(days: number): string {
    const today = formatInTimeZone(new Date(), DEFAULT_TIME_ZONE, "yyyy-MM-dd");
    const dueDate = shiftCalendarDate(today, days);
    return fromZonedTime(`${dueDate}T23:59:59.999`, DEFAULT_TIME_ZONE).toISOString();
}

function stableHash(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function workflowIdempotencyKey(userId: string, viewId: string, blockId: string, source: WorkflowSource, task: TaskViewTask | null, sourceText: string | null, suggestions: Array<BreakdownSuggestion | QuickAddSuggestion>): string {
    return `sabah-dashboard:${stableHash(JSON.stringify({ userId, viewId, blockId, source, taskId: task?.id ?? null, sourceText: sourceText?.slice(0, 500) ?? null, suggestions }))}`;
}

function workflowArgs(userId: string, task: TaskViewTask | null, suggestion: BreakdownSuggestion | QuickAddSuggestion): Record<string, unknown> {
    const priority = "priority" in suggestion && suggestion.priority ? suggestion.priority : "MEDIUM";
    const effortHours = "estimateMinutes" in suggestion && typeof suggestion.estimateMinutes === "number" ? suggestion.estimateMinutes / 60 : undefined;
    const dueInDays = "dueInDays" in suggestion && typeof suggestion.dueInDays === "number" && Number.isInteger(suggestion.dueInDays) && suggestion.dueInDays >= 0 && suggestion.dueInDays <= 365
        ? suggestion.dueInDays
        : undefined;
    return {
        title: suggestion.title,
        status: "TODO",
        priority,
        assigneeIds: [userId],
        ...(effortHours === undefined ? {} : { effortHours }),
        ...(dueInDays === undefined ? {} : { dueAt: dueDateAfterDays(dueInDays) }),
        ...(task?.project?.id ? { projectId: task.project.id } : {}),
        ...(task?.id ? { parentTaskId: task.id } : {}),
    };
}

function taskWorkflowBody(userId: string, viewId: string, blockId: string, source: WorkflowSource, sourceText: string | null, goal: string, task: TaskViewTask | null, suggestions: Array<BreakdownSuggestion | QuickAddSuggestion>) {
    const idempotencyKey = workflowIdempotencyKey(userId, viewId, blockId, source, task, sourceText, suggestions);
    return {
        goal,
        idempotencyKey,
        steps: suggestions.map((suggestion, index) => ({
            clientStepId: `sabah-dashboard-${stableHash(`${idempotencyKey}:${index}:${suggestion.title}`)}-${index}`.slice(0, 80),
            capability: "tasks.create",
            args: workflowArgs(userId, task, suggestion),
            dependsOn: [],
            confidence: 0,
            inferredFields: [],
            evidenceRefs: task ? [`TASK:${task.id}`] : ["NOTE_CAPTURE"],
        })),
    };
}

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    return responseJson(response);
}

function parseWorkflow(payload: unknown): WorkflowSnapshot {
    return workflowSnapshotSchema.parse(payload);
}

const TERMINAL_WORKFLOW_STATUSES = new Set<WorkflowSnapshot["status"]>(["COMPLETED", "FAILED", "CANCELED"]);

async function executeWorkflowUntilSettled(client: ReturnType<typeof createSabahClient>, initial: WorkflowSnapshot, onSnapshot?: (snapshot: WorkflowSnapshot) => void, signal?: AbortSignal, isCurrent: () => boolean = () => true): Promise<WorkflowSnapshot> {
    let current = await client.getWorkflow(initial.id, { signal });
    if (!isCurrent()) return current;
    onSnapshot?.(current);
    let previousKey = `${current.status}:${current.steps.map((step) => `${step.id}:${step.status}`).join(",")}`;
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (!isCurrent()) return current;
        if (TERMINAL_WORKFLOW_STATUSES.has(current.status) || current.status === "AWAITING_APPROVAL") return current;
        let next: WorkflowSnapshot;
        try {
            next = await client.executeWorkflow(current.id, { signal });
        } catch (error) {
            try {
                const recovered = await client.getWorkflow(current.id, { signal });
                onSnapshot?.(recovered);
                return recovered;
            } catch {
                throw error;
            }
        }
        if (!isCurrent()) return current;
        onSnapshot?.(next);
        const nextKey = `${next.status}:${next.steps.map((step) => `${step.id}:${step.status}`).join(",")}`;
        current = next;
        if (TERMINAL_WORKFLOW_STATUSES.has(next.status) || next.status === "AWAITING_APPROVAL" || nextKey === previousKey) return current;
        previousKey = nextKey;
    }
    return current;
}

function SummaryOutput({ title, result, accent, onCopy, copyState }: { title: string; result: SummaryResult; accent: AssistantAccent; onCopy?: () => void; copyState?: "idle" | "copied" | "error" }) {
    const generatedAt = new Date(result.generatedAt);
    const generatedLabel = Number.isNaN(generatedAt.getTime()) ? "just now" : formatInTimeZone(generatedAt, DEFAULT_TIME_ZONE, "h:mm a");
    return (
        <section aria-label={title} className="mt-3 rounded-lg border border-border/80 bg-background/75 p-3">
            <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                <h4 className="text-sm font-semibold">{title}</h4>
                <span className="ml-auto text-right text-[11px] text-muted-foreground">{formatTaskSummaryFacts(result.facts)} · {generatedLabel}</span>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-foreground/90">{result.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Briefing evidence">
                {result.tasks.slice(0, 4).map((task) => (
                    <Link key={task.id} href={`/tasks/${task.id}`} className={cn("inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-foreground/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2", ACCENT_STYLES[accent].focus)}>
                        <span className="truncate">{task.title}</span>
                        <ArrowUpRight className="size-3 shrink-0" aria-hidden="true" />
                    </Link>
                ))}
            </div>
            {onCopy ? <button type="button" onClick={onCopy} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><FileText className="size-3.5" aria-hidden="true" />{copyState === "copied" ? "Copied" : "Copy update"}</button> : null}
            {copyState === "error" ? <p role="alert" className="mt-2 text-xs text-destructive">The update could not be copied.</p> : null}
        </section>
    );
}

function TaskRow({ task, selected, onSelect }: { task: TaskViewTask; selected: boolean; onSelect: () => void }) {
    const due = formatDueDate(task.dueAt);
    return (
        <div className={cn("flex min-w-0 items-start gap-3 border-t border-border/70 px-3 py-3 first:border-t-0", selected && "bg-muted/35")}>
            <button type="button" aria-label={`Select ${task.title}`} aria-pressed={selected} onClick={onSelect} className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded border border-border text-muted-foreground hover:border-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">
                {selected ? <span className="size-3 rounded-full bg-primary" aria-hidden="true" /> : null}
            </button>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/tasks/${task.id}`} className="min-w-0 truncate text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">{task.title}</Link>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{priorityLabel(task.priority)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{statusLabel(task.status)}</span>
                    {task.project?.name ? <span>· {task.project.name}</span> : null}
                    {due ? <span className={cn("inline-flex items-center gap-1", task.status === "BLOCKED" ? "text-rose-600 dark:text-rose-300" : "")}><Clock3 className="size-3" aria-hidden="true" />{due}</span> : null}
                </div>
            </div>
        </div>
    );
}

function TaskSection({ title, description, tasks, selectedTaskId, onSelect, empty, maxVisible }: { title: string; description: string; tasks: TaskViewTask[]; selectedTaskId: string | null; onSelect: (task: TaskViewTask) => void; empty: string; maxVisible: number }) {
    const [expanded, setExpanded] = useState(false);
    const id = `${title.toLowerCase().replaceAll(" ", "-")}-title`;
    const visibleTasks = expanded ? tasks : tasks.slice(0, maxVisible);
    return (
        <section aria-labelledby={id} className="border-t border-border/80 bg-background/40 first:border-t-0">
            <div className="flex items-start justify-between gap-3 border-b border-border/70 px-3 py-3">
                <div><h3 id={id} className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div>
                <ListChecks className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </div>
            {tasks.length > 0 ? visibleTasks.map((task) => <TaskRow key={task.id} task={task} selected={task.id === selectedTaskId} onSelect={() => onSelect(task)} />) : <p className="px-3 py-4 text-sm text-muted-foreground">{empty}</p>}
            {tasks.length > maxVisible ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="min-h-11 w-full border-t border-border/70 px-3 text-left text-xs font-medium text-primary hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">{expanded ? "Show less" : `Show ${tasks.length - maxVisible} more`}</button> : null}
        </section>
    );
}

function workflowResultData(workflow: WorkflowSnapshot): ResultCardData {
    const verified = workflow.steps.filter((step) => step.status === "VERIFIED");
    const failed = workflow.steps.filter((step) => step.status === "FAILED" || step.status === "BLOCKED");
    return {
        summary: verified.map((step) => step.resultSummary).filter((value): value is string => Boolean(value?.trim())).join(" · ") || (verified.length > 0 ? "Execution was verified." : "No task creation was verified."),
        entityLinks: verified.flatMap((step) => step.entityLinks),
        warnings: failed.map((step) => step.error).filter((value): value is string => Boolean(value?.trim())),
        reversible: false,
        error: workflow.status === "FAILED" ? failed[0]?.error ?? "The workflow failed before verification." : undefined,
    };
}

function parseStoredWorkflow(value: string | null): { workflowId: string; draft: WorkflowDraft | null } | null {
    if (!value) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        if (!isRecord(parsed) || typeof parsed.workflowId !== "string" || parsed.workflowId.length > 160) return null;
        const rawDraft = parsed.draft;
        if (!isRecord(rawDraft) || (rawDraft.source !== "breakdown" && rawDraft.source !== "capture") || !Array.isArray(rawDraft.steps)) {
            return { workflowId: parsed.workflowId, draft: null };
        }
        const steps = rawDraft.steps.flatMap((step): WorkflowDraftStep[] => {
            if (!isRecord(step) || typeof step.title !== "string" || !isRecord(step.args)) return [];
            return [{ title: step.title.slice(0, 500), args: step.args }];
        }).slice(0, 6);
        return {
            workflowId: parsed.workflowId,
            draft: {
                source: rawDraft.source,
                sourceTaskId: typeof rawDraft.sourceTaskId === "string" ? rawDraft.sourceTaskId : null,
                sourceTaskTitle: typeof rawDraft.sourceTaskTitle === "string" ? rawDraft.sourceTaskTitle : null,
                sourceText: typeof rawDraft.sourceText === "string" ? rawDraft.sourceText.slice(0, 2_000) : null,
                steps,
                idempotencyKey: typeof rawDraft.idempotencyKey === "string" ? rawDraft.idempotencyKey.slice(0, 160) : "",
            },
        };
    } catch {
        return null;
    }
}

function reviewedDate(value: unknown): string {
    if (typeof value !== "string") return "Not set";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: DEFAULT_TIME_ZONE }).format(date);
}

type WorkflowApprovalField = NonNullable<WorkflowSnapshot["approvals"][number]["review"]>["fields"][number];

function hasAuthoritativeReview(approval: WorkflowSnapshot["approvals"][number]): boolean {
    const review = approval.review;
    return Boolean(review && /^[a-f0-9]{64}$/.test(review.approvalHash) && review.fields.some((field) => field.path === "title"));
}

function approvalFieldLabel(path: WorkflowApprovalField["path"]): string {
    switch (path) {
        case "title": return "Title";
        case "description": return "Description";
        case "status": return "Status";
        case "priority": return "Priority";
        case "startAt": return "Start";
        case "dueAt": return "Due";
        case "dueAtEnd": return "Due end";
        case "effortHours": return "Effort";
        case "isPrivate": return "Privacy";
        case "projectId": return "Project";
        case "caseStudyId": return "Case study";
        case "kpiId": return "KPI";
        case "stageId": return "Stage";
        case "parentTaskId": return "Parent task";
        case "assigneeIds": return "Assignees";
        case "tagIds": return "Tags";
        case "dependencyIds": return "Dependencies";
        case "reminders": return "Reminders";
        case "idempotencyKey": return "Idempotency key";
        case "recurrenceKey": return "Recurrence key";
    }
}

function approvalFieldValue(field: WorkflowApprovalField, userId: string): string {
    if (field.proposed === "(unset)") return "Not set";
    if (field.proposed === "") return "Empty";
    if (field.path === "startAt" || field.path === "dueAt" || field.path === "dueAtEnd") return reviewedDate(field.proposed);
    if (field.path === "effortHours") return `${field.proposed} h`;
    if (field.path === "isPrivate") return field.proposed === "true" ? "Private" : "Shared";
    if (field.path === "status") {
        return ({ TODO: "To do", DOING: "In progress", BLOCKED: "Blocked", WAITING: "Waiting", DONE: "Done", CANCELED: "Canceled" } as Record<string, string>)[field.proposed] ?? field.proposed;
    }
    if (field.path === "priority") {
        return ({ LOW: "Low", MEDIUM: "Medium", HIGH: "High", URGENT: "Urgent" } as Record<string, string>)[field.proposed] ?? field.proposed;
    }
    if (field.path === "assigneeIds" || field.path === "tagIds" || field.path === "dependencyIds" || field.path === "reminders") {
        try {
            const values: unknown = JSON.parse(field.proposed);
            if (Array.isArray(values) && values.every((value) => typeof value === "string" || typeof value === "number")) {
                if (field.path === "assigneeIds" && values.includes(userId)) return "You (server reviewed)";
                if (field.path === "reminders") return values.length ? values.map((value) => `${value} min`).join(", ") : "Not set";
                return values.join(", ") || "Not set";
            }
        } catch {
            return "Unavailable";
        }
        return "Unavailable";
    }
    return field.proposed;
}

export function SabahDailyDashboard({ blockId, userId, accent, layout = "context", viewId }: DashboardProps) {
    const palette = ACCENT_STYLES[accent];
    const sabah = useSabahMaybe();
    const hostId = `sabah-${blockId}`;
    const dashboardLayout = layout === "focused" ? "focused" : "context";
    const scopedViewId = viewId ?? "unknown";
    const scopeKey = `sabah-dashboard-workflow:${userId}:${scopedViewId}:${blockId}`;
    const [data, setData] = useState<DashboardData | null>(null);
    const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
    const [loadError, setLoadError] = useState<string | null>(null);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [briefingStatus, setBriefingStatus] = useState<AiStatus>("idle");
    const [briefingResult, setBriefingResult] = useState<SummaryResult | null>(null);
    const [briefingError, setBriefingError] = useState<string | null>(null);
    const [workbenchStatus, setWorkbenchStatus] = useState<AiStatus>("idle");
    const [workbenchResult, setWorkbenchResult] = useState<SummaryResult | null>(null);
    const [workbenchMode, setWorkbenchMode] = useState<"plan" | "update" | null>(null);
    const [workbenchError, setWorkbenchError] = useState<string | null>(null);
    const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
    const [breakdownStatus, setBreakdownStatus] = useState<AiStatus>("idle");
    const [breakdown, setBreakdown] = useState<BreakdownSuggestion[]>([]);
    const [breakdownSourceTask, setBreakdownSourceTask] = useState<TaskViewTask | null>(null);
    const [breakdownError, setBreakdownError] = useState<string | null>(null);
    const [note, setNote] = useState("");
    const [noteStatus, setNoteStatus] = useState<AiStatus>("idle");
    const [noteSuggestion, setNoteSuggestion] = useState<QuickAddSuggestion | null>(null);
    const [noteSourceText, setNoteSourceText] = useState<string | null>(null);
    const [noteError, setNoteError] = useState<string | null>(null);
    const [workflow, setWorkflow] = useState<WorkflowSnapshot | null>(null);
    const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft | null>(null);
    const [workflowBusy, setWorkflowBusy] = useState(false);
    const [workflowError, setWorkflowError] = useState<string | null>(null);
    const [workflowRecoveryError, setWorkflowRecoveryError] = useState<string | null>(null);
    const [workflowHydrated, setWorkflowHydrated] = useState(false);
    const [workflowRecoveryFailed, setWorkflowRecoveryFailed] = useState(false);
    const [rejectReason, setRejectReason] = useState("");
    const loadController = useRef<AbortController | null>(null);
    const summaryRequestRef = useRef<Record<SummaryMode, number>>({ briefing: 0, plan: 0, update: 0 });
    const breakdownRequestRef = useRef(0);
    const noteRequestRef = useRef(0);
    const workflowActionRef = useRef(0);
    const scopeGenerationRef = useRef(0);
    const sourceGenerationRef = useRef(0);

    const allTasks = useMemo(() => uniqueTasks([...(data?.priorityTasks ?? []), ...(data?.blockerTasks ?? [])]), [data]);
    const selectedTask = allTasks.find((task) => task.id === selectedTaskId) ?? null;
    const hostVisible = sabah?.activeHost?.id === hostId && sabah.activeHost.visible;

    const load = useCallback(() => {
        loadController.current?.abort();
        const controller = new AbortController();
        loadController.current = controller;
        const sourceGeneration = sourceGenerationRef.current + 1;
        sourceGenerationRef.current = sourceGeneration;
        summaryRequestRef.current = { briefing: summaryRequestRef.current.briefing + 1, plan: summaryRequestRef.current.plan + 1, update: summaryRequestRef.current.update + 1 };
        breakdownRequestRef.current += 1;
        noteRequestRef.current += 1;
        setBriefingResult(null);
        setBriefingStatus("idle");
        setBriefingError(null);
        setWorkbenchResult(null);
        setWorkbenchStatus("idle");
        setWorkbenchMode(null);
        setWorkbenchError(null);
        setBreakdown([]);
        setBreakdownSourceTask(null);
        setBreakdownStatus("idle");
        setBreakdownError(null);
        setNoteSuggestion(null);
        setNoteSourceText(null);
        setNoteStatus("idle");
        setNoteError(null);
        setLoadState("loading");
        setLoadError(null);
        void loadDashboardData(controller.signal).then((next) => {
            if (controller.signal.aborted || sourceGenerationRef.current !== sourceGeneration) return;
            setData(next);
            setSelectedTaskId((current) => current && uniqueTasks([...next.priorityTasks, ...next.blockerTasks]).some((task) => task.id === current) ? current : next.priorityTasks[0]?.id ?? next.blockerTasks[0]?.id ?? null);
            setLoadState("ready");
        }).catch((error: unknown) => {
            if (controller.signal.aborted || sourceGenerationRef.current !== sourceGeneration) return;
            setLoadState("error");
            setLoadError(error instanceof Error ? error.message : "Work data is unavailable");
        });
    }, []);

    useEffect(() => {
        load();
        return () => loadController.current?.abort();
    }, [load, scopedViewId, userId]);

    useEffect(() => {
        const generation = scopeGenerationRef.current + 1;
        scopeGenerationRef.current = generation;
        breakdownRequestRef.current += 1;
        noteRequestRef.current += 1;
        summaryRequestRef.current = { briefing: summaryRequestRef.current.briefing + 1, plan: summaryRequestRef.current.plan + 1, update: summaryRequestRef.current.update + 1 };
        workflowActionRef.current += 1;
        setData(null);
        setLoadState("loading");
        setSelectedTaskId(null);
        setBriefingResult(null);
        setWorkbenchResult(null);
        setBriefingStatus("idle");
        setWorkbenchStatus("idle");
        setWorkbenchMode(null);
        setBriefingError(null);
        setWorkbenchError(null);
        setCopyState("idle");
        setBreakdown([]);
        setBreakdownSourceTask(null);
        setBreakdownStatus("idle");
        setNoteSuggestion(null);
        setNoteSourceText(null);
        setNoteStatus("idle");
        setWorkflow(null);
        setWorkflowDraft(null);
        setWorkflowBusy(false);
        setWorkflowError(null);
        setWorkflowRecoveryError(null);
        setWorkflowRecoveryFailed(false);
        setWorkflowHydrated(false);

        const controller = new AbortController();
        let stored: { workflowId: string; draft: WorkflowDraft | null } | null = null;
        try {
            stored = parseStoredWorkflow(window.localStorage.getItem(scopeKey));
        } catch {
            stored = null;
        }
        if (!stored) {
            setWorkflowHydrated(true);
            return () => controller.abort();
        }

        const recoveryActionId = workflowActionRef.current;
        void createSabahClient().getWorkflow(stored.workflowId, { signal: controller.signal }).then((snapshot) => {
            if (controller.signal.aborted || scopeGenerationRef.current !== generation || workflowActionRef.current !== recoveryActionId) return;
            setWorkflow(snapshot);
            setWorkflowDraft(stored?.draft ?? null);
            setWorkflowRecoveryError(null);
        }).catch((error: unknown) => {
            if (controller.signal.aborted || scopeGenerationRef.current !== generation || workflowActionRef.current !== recoveryActionId) return;
            setWorkflowRecoveryFailed(true);
            setWorkflowRecoveryError(error instanceof Error ? error.message : "The saved dashboard plan could not be recovered");
        }).finally(() => {
            if (!controller.signal.aborted && scopeGenerationRef.current === generation && workflowActionRef.current === recoveryActionId) setWorkflowHydrated(true);
        });
        return () => controller.abort();
    }, [scopeKey]);

    useEffect(() => {
        if (!workflowHydrated || workflowRecoveryFailed) return;
        try {
            if (!workflow) {
                window.localStorage.removeItem(scopeKey);
                return;
            }
            window.localStorage.setItem(scopeKey, JSON.stringify({
                workflowId: workflow.id,
                draft: workflowDraft,
            }));
        } catch {
            // Local storage is a recovery aid; the server snapshot remains authoritative.
        }
    }, [scopeKey, workflow, workflowDraft, workflowHydrated, workflowRecoveryFailed]);

    const retryWorkflowRecovery = async () => {
        const generation = scopeGenerationRef.current;
        const actionId = workflowActionRef.current + 1;
        workflowActionRef.current = actionId;
        let stored: { workflowId: string; draft: WorkflowDraft | null } | null = null;
        try {
            stored = parseStoredWorkflow(window.localStorage.getItem(scopeKey));
        } catch {
            stored = null;
        }
        if (!stored) {
            setWorkflowRecoveryError(null);
            setWorkflowRecoveryFailed(false);
            setWorkflowHydrated(true);
            return;
        }
        setWorkflowHydrated(false);
        setWorkflowRecoveryFailed(false);
        setWorkflowRecoveryError(null);
        try {
            const snapshot = await createSabahClient().getWorkflow(stored.workflowId);
            if (scopeGenerationRef.current !== generation || workflowActionRef.current !== actionId) return;
            setWorkflow(snapshot);
            setWorkflowDraft(stored.draft);
        } catch (error) {
            if (scopeGenerationRef.current !== generation || workflowActionRef.current !== actionId) return;
            setWorkflowRecoveryFailed(true);
            setWorkflowRecoveryError(error instanceof Error ? error.message : "The saved dashboard plan could not be recovered");
        } finally {
            if (scopeGenerationRef.current === generation && workflowActionRef.current === actionId) setWorkflowHydrated(true);
        }
    };

    const openSabah = () => {
        if (!sabah?.activeHost) return;
        sabah.setHostVisibility(sabah.activeHost.id, sabah.activeHost.element, true);
        const phone = window.matchMedia("(max-width: 639px)").matches;
        sabah.dispatch({ type: "SHELL_MODE_CHANGED", mode: phone ? "FULLSCREEN" : "PANEL" });
    };

    const runSummary = async (mode: SummaryMode) => {
        if (loadState === "loading" || allTasks.length === 0) return;
        const requestId = summaryRequestRef.current[mode] + 1;
        summaryRequestRef.current[mode] = requestId;
        const generation = scopeGenerationRef.current;
        const sourceGeneration = sourceGenerationRef.current;
        const sourceTasks = allTasks.slice(0, 50).map((task) => ({ ...task }));
        if (mode === "briefing") {
            setBriefingStatus("loading");
            setBriefingError(null);
        } else {
            setWorkbenchMode(mode);
            setWorkbenchStatus("loading");
            setWorkbenchError(null);
            if (mode === "update") setCopyState("idle");
        }
        try {
            const payload = await postJson("/api/ai/task-actions", { action: "summarize", summaryMode: mode, tasks: taskIdsFor(sourceTasks), context: contextFor("sabah-daily-dashboard", mode, sourceTasks) });
            if (summaryRequestRef.current[mode] !== requestId || scopeGenerationRef.current !== generation || sourceGenerationRef.current !== sourceGeneration) return;
            if (!isRecord(payload) || typeof payload.summary !== "string") throw new Error("Sabah returned no grounded summary");
            const authoritativeTasks = parseAuthoritativeTaskSnapshot(payload.sourceSnapshot, taskIdsFor(sourceTasks), "summary");
            const facts = parseAuthoritativeSummaryFacts(payload.facts, authoritativeTasks, "summary");
            const result: SummaryResult = { mode, summary: payload.summary, tasks: authoritativeTasks, facts, generatedAt: new Date().toISOString() };
            if (mode === "briefing") {
                setBriefingResult(result);
                setBriefingStatus("ready");
            } else {
                setWorkbenchResult(result);
                setWorkbenchStatus("ready");
            }
        } catch (error) {
            if (summaryRequestRef.current[mode] !== requestId || scopeGenerationRef.current !== generation || sourceGenerationRef.current !== sourceGeneration) return;
            if (mode === "briefing") {
                setBriefingStatus("error");
                setBriefingError(error instanceof Error ? error.message : "Sabah could not prepare the briefing");
            } else {
                setWorkbenchStatus("error");
                setWorkbenchError(error instanceof Error ? error.message : "Sabah could not prepare this workbench result");
            }
        }
    };

    const selectTask = (task: TaskViewTask) => {
        setSelectedTaskId(task.id);
        breakdownRequestRef.current += 1;
        if (breakdownSourceTask && breakdownSourceTask.id !== task.id) {
            setBreakdown([]);
            setBreakdownSourceTask(null);
            setBreakdownStatus("idle");
            setBreakdownError(null);
        }
    };

    const previewBreakdown = async () => {
        if (loadState === "loading") return;
        const sourceTask = selectedTask;
        if (!sourceTask) return;
        const requestId = breakdownRequestRef.current + 1;
        breakdownRequestRef.current = requestId;
        const generation = scopeGenerationRef.current;
        const sourceGeneration = sourceGenerationRef.current;
        setBreakdownSourceTask({ ...sourceTask });
        setBreakdown([]);
        setBreakdownStatus("loading");
        setBreakdownError(null);
        try {
            const payload = await postJson("/api/ai/task-actions", { action: "breakdown-preview", taskId: sourceTask.id, context: contextFor("sabah-daily-dashboard", "breakdown", [sourceTask]) });
            if (breakdownRequestRef.current !== requestId || scopeGenerationRef.current !== generation || sourceGenerationRef.current !== sourceGeneration || selectedTaskId !== sourceTask.id) return;
            const suggestions = isRecord(payload) && Array.isArray(payload.suggestions) ? payload.suggestions.filter((item): item is BreakdownSuggestion => isRecord(item) && typeof item.title === "string") : [];
            if (suggestions.length === 0) throw new Error("Sabah returned no breakdown suggestions");
            const [authoritativeTask] = parseAuthoritativeTaskSnapshot(isRecord(payload) ? payload.sourceSnapshot : undefined, [sourceTask.id], "breakdown");
            setBreakdown(suggestions);
            setBreakdownSourceTask(authoritativeTask);
            setBreakdownStatus("ready");
        } catch (error) {
            if (breakdownRequestRef.current !== requestId || scopeGenerationRef.current !== generation || sourceGenerationRef.current !== sourceGeneration) return;
            setBreakdownStatus("error");
            setBreakdownError(error instanceof Error ? error.message : "Sabah could not break down this task");
        }
    };

    const previewNote = async () => {
        if (loadState === "loading") return;
        const sourceText = note.trim();
        if (!sourceText) return;
        const requestId = noteRequestRef.current + 1;
        noteRequestRef.current = requestId;
        const generation = scopeGenerationRef.current;
        const sourceGeneration = sourceGenerationRef.current;
        setNoteSourceText(sourceText);
        setNoteStatus("loading");
        setNoteError(null);
        try {
            const payload = await postJson("/api/ai/task-actions", { action: "parse-preview", text: sourceText, context: contextFor("sabah-daily-dashboard", "capture", []) });
            if (noteRequestRef.current !== requestId || scopeGenerationRef.current !== generation || sourceGenerationRef.current !== sourceGeneration || note.trim() !== sourceText) return;
            const suggestion = isRecord(payload) && isRecord(payload.suggestion) && typeof payload.suggestion.title === "string" ? payload.suggestion as QuickAddSuggestion : null;
            if (!suggestion) throw new Error("Sabah returned no task proposal");
            setNoteSuggestion(suggestion);
            setNoteStatus("ready");
        } catch (error) {
            if (noteRequestRef.current !== requestId || scopeGenerationRef.current !== generation || sourceGenerationRef.current !== sourceGeneration) return;
            setNoteStatus("error");
            setNoteError(error instanceof Error ? error.message : "Sabah could not interpret this note");
        }
    };

    const proposeWorkflow = async (source: WorkflowSource, goal: string, task: TaskViewTask | null, suggestions: Array<BreakdownSuggestion | QuickAddSuggestion>, sourceText: string | null = null) => {
        if (suggestions.length === 0) return;
        if (!workflowHydrated) {
            setWorkflowError("The saved plan is still being recovered. Wait for recovery to finish before proposing a new plan.");
            return;
        }
        if (source === "breakdown" && (!task || !breakdownSourceTask || task.id !== breakdownSourceTask.id || selectedTaskId !== task.id)) {
            setWorkflowError("Select the source task again before proposing these steps.");
            return;
        }
        if (source === "capture" && (!sourceText || sourceText !== noteSourceText)) {
            setWorkflowError("Prepare the capture again before proposing it.");
            return;
        }
        const body = taskWorkflowBody(userId, scopedViewId, blockId, source, sourceText, goal, task, suggestions);
        const draft: WorkflowDraft = {
            source,
            sourceTaskId: task?.id ?? null,
            sourceTaskTitle: task?.title ?? null,
            sourceText: sourceText?.slice(0, 2_000) ?? null,
            steps: body.steps.map((step) => ({ title: String(step.args.title ?? "Untitled task"), args: step.args })),
            idempotencyKey: body.idempotencyKey,
        };
        const actionId = workflowActionRef.current + 1;
        workflowActionRef.current = actionId;
        const generation = scopeGenerationRef.current;
        setWorkflowDraft(draft);
        setWorkflowBusy(true);
        setWorkflowError(null);
        try {
            const payload = await postJson("/api/ai/workflows", body);
            if (workflowActionRef.current !== actionId || scopeGenerationRef.current !== generation) return;
            setWorkflow(parseWorkflow(payload));
        } catch (error) {
            if (workflowActionRef.current !== actionId || scopeGenerationRef.current !== generation) return;
            setWorkflowError(error instanceof Error ? error.message : "Sabah could not prepare the plan for review");
        } finally {
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflowBusy(false);
        }
    };

    const recoverWorkflow = async (client: ReturnType<typeof createSabahClient>, workflowId: string): Promise<WorkflowSnapshot | null> => {
        try {
            return await client.getWorkflow(workflowId);
        } catch {
            return null;
        }
    };

    const executeWorkflow = async () => {
        const current = workflow;
        if (!current) return;
        if (!workflowHydrated) {
            setWorkflowError("The saved plan is still being recovered. Wait for recovery to finish before continuing.");
            return;
        }
        const actionId = workflowActionRef.current + 1;
        workflowActionRef.current = actionId;
        const generation = scopeGenerationRef.current;
        const client = createSabahClient();
        setWorkflowBusy(true);
        setWorkflowError(null);
        try {
            const authoritative = await client.getWorkflow(current.id);
            if (workflowActionRef.current !== actionId || scopeGenerationRef.current !== generation) return;
            setWorkflow(authoritative);
            const settled = await executeWorkflowUntilSettled(client, authoritative, (snapshot) => {
                if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflow(snapshot);
            }, undefined, () => workflowActionRef.current === actionId && scopeGenerationRef.current === generation);
            if (workflowActionRef.current !== actionId || scopeGenerationRef.current !== generation) return;
            setWorkflow(settled);
            if (settled.status === "COMPLETED") load();
        } catch (error) {
            const recovered = await recoverWorkflow(client, current.id);
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation && recovered) setWorkflow(recovered);
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflowError(error instanceof Error ? error.message : "The workflow status could not be confirmed");
        } finally {
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflowBusy(false);
        }
    };

    const decideWorkflow = async (approvalId: string, type: "APPROVE" | "REJECT") => {
        const current = workflow;
        if (!current) return;
        if (!workflowHydrated) {
            setWorkflowError("The saved plan is still being recovered. Wait for recovery to finish before deciding.");
            return;
        }
        const actionId = workflowActionRef.current + 1;
        workflowActionRef.current = actionId;
        const generation = scopeGenerationRef.current;
        const client = createSabahClient();
        setWorkflowBusy(true);
        setWorkflowError(null);
        try {
            const authoritative = await client.getWorkflow(current.id);
            const approval = authoritative.approvals.find((item) => item.id === approvalId && item.status === "PENDING");
            if (!approval) {
                if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflow(authoritative);
                return;
            }
            if (type === "APPROVE" && !hasAuthoritativeReview(approval)) {
                if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) {
                    setWorkflow(authoritative);
                    setWorkflowError("Exact server review is unavailable; approval remains disabled until the workflow is refreshed.");
                }
                return;
            }
            const decision = type === "APPROVE"
                ? { type: "APPROVE" as const, approvalId, reason: null }
                : { type: "REJECT" as const, approvalId, reason: rejectReason.trim() || "Not now" };
            const decided = await client.submitDecision(authoritative.id, decision);
            const settled = type === "APPROVE"
                ? await executeWorkflowUntilSettled(client, decided, (snapshot) => {
                    if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflow(snapshot);
                }, undefined, () => workflowActionRef.current === actionId && scopeGenerationRef.current === generation)
                : decided;
            if (workflowActionRef.current !== actionId || scopeGenerationRef.current !== generation) return;
            setWorkflow(settled);
            if (settled.status === "COMPLETED") load();
        } catch (error) {
            const recovered = await recoverWorkflow(client, current.id);
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation && recovered) setWorkflow(recovered);
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflowError(error instanceof Error ? error.message : "The decision could not be confirmed");
        } finally {
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflowBusy(false);
        }
    };

    const refreshWorkflow = async () => {
        if (!workflow) return;
        const actionId = workflowActionRef.current + 1;
        workflowActionRef.current = actionId;
        const generation = scopeGenerationRef.current;
        const workflowId = workflow.id;
        setWorkflowBusy(true);
        setWorkflowError(null);
        try {
            const refreshed = await createSabahClient().getWorkflow(workflowId);
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflow(refreshed);
        } catch (error) {
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflowError(error instanceof Error ? error.message : "The workflow status could not be refreshed");
        } finally {
            if (workflowActionRef.current === actionId && scopeGenerationRef.current === generation) setWorkflowBusy(false);
        }
    };

    const discardWorkflow = async () => {
        if (!workflow) return;
        if (!workflowHydrated) {
            setWorkflowError("The saved plan is still being recovered. Wait for recovery to finish before discarding it.");
            return;
        }
        if (TERMINAL_WORKFLOW_STATUSES.has(workflow.status)) {
            setWorkflow(null);
            setWorkflowDraft(null);
            return;
        }
        const actionId = workflowActionRef.current + 1;
        workflowActionRef.current = actionId;
        setWorkflowBusy(true);
        setWorkflowError(null);
        try {
            const client = createSabahClient();
            const authoritative = await client.getWorkflow(workflow.id);
            const stopped = await client.stopWorkflow(authoritative.id);
            if (workflowActionRef.current === actionId) setWorkflow(stopped);
        } catch (error) {
            const recovered = await recoverWorkflow(createSabahClient(), workflow.id);
            if (workflowActionRef.current === actionId && recovered) setWorkflow(recovered);
            if (workflowActionRef.current === actionId) setWorkflowError(error instanceof Error ? error.message : "The plan could not be discarded");
        } finally {
            if (workflowActionRef.current === actionId) setWorkflowBusy(false);
        }
    };

    const copyUpdate = async () => {
        if (!workbenchResult || workbenchResult.mode !== "update") return;
        try {
            if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
            await navigator.clipboard.writeText(workbenchResult.summary);
            setCopyState("copied");
        } catch {
            setCopyState("error");
        }
    };

    const briefingTitle = "Sabah briefing";
    const taskLimits = dashboardLayout === "focused" ? { priority: 1, blockers: 1 } : { priority: 2, blockers: 1 };
    const pendingApprovals = workflow?.approvals.filter((approval) => approval.status === "PENDING") ?? [];
    const approvalReviewUnavailable = workflow?.status === "AWAITING_APPROVAL" && pendingApprovals.some((approval) => !hasAuthoritativeReview(approval));

    return (
        <section data-testid={`sabah-daily-dashboard-${blockId}`} data-accent={accent} data-layout={dashboardLayout} aria-labelledby={`sabah-daily-dashboard-title-${blockId}`} className={cn("border-y bg-card/20 px-3 py-4 sm:px-4 sm:py-5", palette.border)}>
            <div className="flex items-center justify-between gap-3 sm:flex-wrap">
                <div className="flex min-w-0 flex-col gap-y-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
                    <h2 id={`sabah-daily-dashboard-title-${blockId}`} className="text-lg font-semibold tracking-tight sm:text-xl">Your work today</h2>
                    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground sm:text-sm"><span className={cn("size-2 shrink-0 rounded-full", palette.dot)} aria-hidden="true" /><span>{dashboardDate()}</span>{loadState === "ready" ? <span className="hidden sm:inline">· Live</span> : null}<span className="hidden text-xs sm:inline">· {dashboardLayout === "focused" ? "Focused work" : "Context around your work"}</span></div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <button type="button" data-sabah-open={hostId} onClick={openSabah} disabled={!sabah?.activeHost} className={cn("inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2", palette.focus)}><MessageCircle className="size-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">Ask Sabah</span></button>
                    <button type="button" onClick={() => load()} disabled={loadState === "loading"} className={cn("inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium shadow-sm hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2", palette.focus)}><RefreshCw className={cn("size-4", loadState === "loading" && "animate-spin")} aria-hidden="true" /><span className="sr-only sm:not-sr-only">Refresh</span></button>
                </div>
            </div>

            <div className="mt-4 grid grid-cols-2 border-y border-border/70 sm:grid-cols-4">
                {METRICS.map(({ key, label, icon: Icon, tone }) => {
                    const value = data?.metrics[key] ?? null;
                    const metricError = data?.metricErrors[key];
                    return <div key={key} data-testid={`metric-${key}`} className="border-border/70 px-3 py-3 first:border-l-0 [&:not(:nth-child(2n+1))]:border-l sm:[&:not(:first-child)]:border-l"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={cn("size-4", tone)} aria-hidden="true" /><span>{label}</span></div><p className="mt-2 text-2xl font-semibold tabular-nums">{loadState === "loading" ? <span className="text-muted-foreground">—</span> : value == null ? <span aria-label="Metric unavailable" className="text-base text-muted-foreground">Unknown</span> : value}</p>{metricError ? <span className="text-[11px] text-amber-700 dark:text-amber-300">Unavailable</span> : null}</div>;
                })}
            </div>

            {loadState === "error" ? <div role="alert" className="mt-4 border-s-2 border-destructive/50 bg-destructive/5 px-3 py-3 text-sm"><p className="font-medium">Your work could not be loaded.</p><p className="mt-1 text-muted-foreground">{loadError ?? "Try refreshing this view."}</p></div> : null}

            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.2fr)]">
                <section aria-labelledby={`sabah-briefing-title-${blockId}`} className="order-1 min-w-0 border-y border-border/80 bg-background/45 p-3 xl:col-start-1 xl:row-start-1">
                        <div className="flex items-start justify-between gap-3"><div><h3 id={`sabah-briefing-title-${blockId}`} className="text-sm font-semibold">Sabah briefing</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">What needs attention, and what to do next.</p></div><Sparkles className="size-4 text-primary" aria-hidden="true" /></div>
                        <button type="button" onClick={() => void runSummary("briefing")} disabled={loadState === "loading" || allTasks.length === 0 || briefingStatus === "loading"} className={cn("mt-3 inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium shadow-sm disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2", palette.button, palette.focus)}><WandSparkles className={cn("size-4", briefingStatus === "loading" && "animate-pulse")} aria-hidden="true" />{briefingStatus === "loading" ? "Preparing briefing…" : "Generate briefing"}</button>
                        {briefingStatus === "error" && briefingError ? <p role="alert" className="mt-2 text-xs text-destructive">{briefingError}</p> : null}
                        {briefingStatus === "ready" && briefingResult ? <SummaryOutput title={briefingTitle} result={briefingResult} accent={accent} /> : null}
                </section>

                <div className="order-2 min-w-0 space-y-4 xl:col-start-2 xl:row-span-2 xl:row-start-1">
                    <TaskSection title="Priority work" description={dashboardLayout === "focused" ? "A short list for the next decision." : "Your highest-priority open work."} tasks={data?.priorityTasks ?? []} selectedTaskId={selectedTaskId} onSelect={selectTask} maxVisible={taskLimits.priority} empty={loadState === "loading" ? "Loading your priority work…" : "No open priority work is assigned to you."} />
                    <TaskSection title="Needs attention" description="Blocked work and its next decision." tasks={data?.blockerTasks ?? []} selectedTaskId={selectedTaskId} onSelect={selectTask} maxVisible={taskLimits.blockers} empty={loadState === "loading" ? "Loading blockers…" : "No blockers are currently assigned to you."} />
                </div>

                <div className="order-3 min-w-0 space-y-4 xl:col-start-1 xl:row-start-2">
                    <section aria-labelledby={`sabah-workbench-title-${blockId}`} className="border-y border-border/80 bg-background/45 p-3">
                        <div className="flex items-start justify-between gap-3"><div><h3 id={`sabah-workbench-title-${blockId}`} className="text-sm font-semibold">AI workbench</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{dashboardLayout === "focused" ? "Keep one selected task and its next decision in focus." : "Plan the day or prepare a personal update from the owned work."}</p></div><WandSparkles className="size-4 text-primary" aria-hidden="true" /></div>
                        <label className="mt-3 block text-xs font-medium text-muted-foreground" htmlFor={`sabah-selected-task-${blockId}`}>Selected task</label>
                        <select id={`sabah-selected-task-${blockId}`} aria-label="Selected task for AI workbench" value={selectedTask?.id ?? ""} onChange={(event) => { const task = allTasks.find((item) => item.id === event.target.value); if (task) selectTask(task); }} className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2.5 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><option value="" disabled>Select a task</option>{allTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>
                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                            <button type="button" onClick={() => void runSummary("plan")} disabled={loadState === "loading" || allTasks.length === 0 || workbenchStatus === "loading"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><Target className="size-3.5" aria-hidden="true" />{workbenchStatus === "loading" && workbenchMode === "plan" ? "Planning…" : "Plan my day"}</button>
                            <button type="button" onClick={() => void runSummary("update")} disabled={loadState === "loading" || allTasks.length === 0 || workbenchStatus === "loading"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><FileText className="size-3.5" aria-hidden="true" />{workbenchStatus === "loading" && workbenchMode === "update" ? "Drafting…" : "Draft an update"}</button>
                            <button type="button" onClick={() => void previewBreakdown()} disabled={loadState === "loading" || !selectedTask || breakdownStatus === "loading"} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border px-2.5 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><ListChecks className="size-3.5" aria-hidden="true" />Break down selected work</button>
                        </div>
                        {workbenchStatus === "error" && workbenchError ? <p role="alert" className="mt-3 text-xs text-destructive">{workbenchError}</p> : null}
                        {workbenchStatus === "ready" && workbenchResult ? <SummaryOutput title={workbenchResult.mode === "plan" ? "Your day plan" : "Draft personal update"} result={workbenchResult} accent={accent} onCopy={workbenchResult.mode === "update" ? () => void copyUpdate() : undefined} copyState={workbenchResult.mode === "update" ? copyState : undefined} /> : null}
                        {breakdownStatus === "error" && breakdownError ? <p role="alert" className="mt-3 text-xs text-destructive">{breakdownError}</p> : null}
                        {breakdownStatus === "ready" && breakdown.length > 0 && breakdownSourceTask ? <div className="mt-3 border-s border-border/80 bg-background p-3 ps-4"><div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold">Review suggested steps</h4><p className="mt-1 text-xs text-muted-foreground">From “{breakdownSourceTask.title}”</p></div><ListChecks className="size-4 text-muted-foreground" aria-hidden="true" /></div><ul className="mt-2 space-y-2">{breakdown.map((suggestion) => <li key={suggestion.title} className="flex items-start justify-between gap-3 text-sm"><span className="min-w-0 break-words">{suggestion.title}</span>{suggestion.estimateMinutes ? <span className="shrink-0 text-xs text-muted-foreground">{suggestion.estimateMinutes} min</span> : null}</li>)}</ul><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void proposeWorkflow("breakdown", `Create reviewed steps for “${breakdownSourceTask.title}”`, breakdownSourceTask, breakdown)} disabled={workflowBusy || !workflowHydrated || selectedTaskId !== breakdownSourceTask.id} className={cn("inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2", palette.button, palette.focus)}>{workflowBusy ? "Preparing plan…" : "Propose task plan"}</button><button type="button" onClick={() => { breakdownRequestRef.current += 1; setBreakdown([]); setBreakdownSourceTask(null); setBreakdownStatus("idle"); }} disabled={workflowBusy} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Discard</button></div></div> : null}
                    </section>

                    <section aria-labelledby={`sabah-capture-title-${blockId}`} className="border-y border-border/80 bg-background/45 p-3">
                        <div className="flex items-start justify-between gap-3"><div><h3 id={`sabah-capture-title-${blockId}`} className="text-sm font-semibold">Capture a task</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Turn a note into a proposal. Nothing is created until you review it.</p></div><FileText className="size-4 text-muted-foreground" aria-hidden="true" /></div>
                        <textarea aria-label="Capture a note for Sabah" value={note} onChange={(event) => { const value = event.target.value; setNote(value); if (noteSourceText && value.trim() !== noteSourceText) { noteRequestRef.current += 1; setNoteSuggestion(null); setNoteSourceText(null); setNoteStatus("idle"); } }} placeholder="Capture a note for Sabah…" rows={3} className="mt-3 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-base sm:text-sm leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" />
                        <button type="button" onClick={() => void previewNote()} disabled={loadState === "loading" || !note.trim() || noteStatus === "loading"} className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"><WandSparkles className="size-3.5" aria-hidden="true" />{noteStatus === "loading" ? "Interpreting note…" : "Prepare task proposal"}</button>
                        {noteStatus === "error" && noteError ? <p role="alert" className="mt-2 text-xs text-destructive">{noteError}</p> : null}
                        {noteStatus === "ready" && noteSuggestion && noteSourceText ? <div className="mt-3 border-s border-border/80 bg-background p-3 ps-4"><p className="text-sm font-medium break-words">{noteSuggestion.title}</p><p className="mt-1 text-xs text-muted-foreground">{priorityLabel(noteSuggestion.priority ?? "MEDIUM")} priority{noteSuggestion.estimateMinutes == null ? "" : ` · ${noteSuggestion.estimateMinutes} min`}{noteSuggestion.dueInDays == null ? "" : ` · due ${formatDueDate(dueDateAfterDays(noteSuggestion.dueInDays)) ?? "date unavailable"}`}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void proposeWorkflow("capture", "Create the captured task", null, [noteSuggestion], noteSourceText)} disabled={workflowBusy || !workflowHydrated} className={cn("inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2", palette.button, palette.focus)}>Propose captured task</button><button type="button" onClick={() => { noteRequestRef.current += 1; setNoteSuggestion(null); setNoteSourceText(null); setNoteStatus("idle"); }} disabled={workflowBusy} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Discard</button></div></div> : null}
                    </section>

                    {workflowRecoveryError ? <div role="alert" className="rounded-md border border-amber-500/35 bg-amber-500/[0.03] px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><p>A saved dashboard plan could not be recovered.</p><button type="button" onClick={() => void retryWorkflowRecovery()} className="mt-2 inline-flex min-h-11 items-center rounded-md border border-amber-500/40 px-3 py-2 font-medium hover:border-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50">Retry recovery</button></div> : null}
                    {workflow ? <section aria-label="Sabah plan review" className="border-y border-amber-500/35 bg-amber-500/[0.04] p-3">
                        <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Review task plan</h3><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{workflow.goal}</p></div><span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">{workflow.status.replaceAll("_", " ")}</span></div>
                        {workflow.status !== "AWAITING_APPROVAL" ? <p className="mt-3 text-xs text-muted-foreground">The local preparation draft is not an approval authority; the server preview below is the source for any later review.</p> : null}
                        {workflow.status === "AWAITING_APPROVAL" && !approvalReviewUnavailable ? <div className="mt-3 space-y-3" aria-label="Authoritative server review"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Authoritative server review</h4>{pendingApprovals.map((approval) => <div key={approval.id} className="border-s border-border/70 bg-background/70 p-3 ps-4"><p className="text-xs text-muted-foreground">Approval hash bound: {approval.review?.approvalHash.slice(0, 12)}…</p><dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">{approval.review?.fields.map((field) => <React.Fragment key={field.path}><dt className="text-muted-foreground">{approvalFieldLabel(field.path)}</dt><dd className="break-words">{approvalFieldValue(field, userId)}</dd></React.Fragment>)}</dl></div>)}</div> : null}
                        {approvalReviewUnavailable ? <div role="alert" className="mt-3 rounded-md border border-amber-500/35 bg-amber-500/[0.03] px-3 py-2 text-xs text-amber-700 dark:text-amber-300"><p>Exact server review is unavailable; approval is disabled. The local draft cannot authorize approval.</p><button type="button" onClick={() => void refreshWorkflow()} disabled={workflowBusy || !workflowHydrated} className="mt-2 inline-flex min-h-11 items-center rounded-md border border-amber-500/40 px-3 py-2 font-medium hover:border-amber-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50">Refresh workflow status</button></div> : null}
                        {workflow.steps.some((step) => step.previewSummary) ? <div className="mt-3 space-y-1"><h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Server preview</h4>{workflow.steps.map((step) => step.previewSummary ? <p key={step.id} className="text-xs leading-5 text-foreground/80">{step.previewSummary}</p> : null)}</div> : null}
                        {workflow.steps.length > 0 ? <div className="mt-3 border-t border-border/70 pt-3"><StatusStack steps={workflow.steps} /></div> : null}
                        {workflow.status === "PLANNED" || workflow.status === "RUNNING" ? <button type="button" onClick={() => void executeWorkflow()} disabled={workflowBusy || !workflowHydrated} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-amber-500/40 bg-background px-3 py-2 text-xs font-medium hover:border-amber-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50">{workflowBusy ? "Checking workflow…" : workflow.status === "PLANNED" ? "Request approval" : "Continue workflow"}</button> : null}
                        {workflow.status === "AWAITING_APPROVAL" ? <div className="mt-3 space-y-2"><label className="block text-xs font-medium text-muted-foreground" htmlFor={`sabah-reject-reason-${blockId}`}>Decision note (optional for approval)</label><input id={`sabah-reject-reason-${blockId}`} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="Why approve or reject?" className="min-h-11 w-full rounded-md border border-border bg-background px-2.5 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50" />{pendingApprovals.map((approval) => <div key={approval.id} className="flex flex-wrap gap-2"><button type="button" onClick={() => void decideWorkflow(approval.id, "APPROVE")} disabled={workflowBusy || !workflowHydrated || !hasAuthoritativeReview(approval)} className={cn("inline-flex min-h-11 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium shadow-sm disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2", palette.button, palette.focus)}>Approve and execute</button><button type="button" onClick={() => void decideWorkflow(approval.id, "REJECT")} disabled={workflowBusy || !workflowHydrated} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Reject proposal</button></div>)}</div> : null}
                        {workflow.status === "COMPLETED" || workflow.status === "FAILED" || workflow.status === "CANCELED" ? <div className="mt-3"><ResultCard result={workflowResultData(workflow)} />{workflow.status === "FAILED" || workflow.status === "CANCELED" ? <button type="button" onClick={() => void refreshWorkflow()} disabled={workflowBusy} className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Refresh workflow status</button> : null}</div> : null}
                        {workflow.status === "CANCELED" ? <p className="mt-3 text-xs text-muted-foreground">This plan was stopped. Any completed task changes remain in place.</p> : null}
                        {workflow.status !== "COMPLETED" && workflow.status !== "FAILED" && workflow.status !== "CANCELED" ? <button type="button" onClick={() => void discardWorkflow()} disabled={workflowBusy || !workflowHydrated} className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">{workflow.steps.some((step) => step.status === "VERIFIED" || step.status === "RUNNING") ? "Stop remaining steps" : "Discard plan"}</button> : <button type="button" onClick={() => void discardWorkflow()} disabled={!workflowHydrated} className="mt-3 inline-flex min-h-11 items-center rounded-md border border-border px-3 py-2 text-xs font-medium hover:border-foreground/30 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50">Dismiss</button>}
                        {workflowError ? <p role="alert" className="mt-3 text-xs text-destructive">{workflowError}</p> : null}
                    </section> : null}
                </div>


            </div>

            <div className={cn("mt-4 overflow-hidden rounded-lg border border-border/80 bg-background/80 transition-[height]", hostVisible ? "h-[min(70dvh,38rem)] min-h-[25rem]" : "h-0 border-transparent")}>
                <SabahWorkspaceHost hostId={hostId} className="h-full min-h-0 w-full" />
            </div>
        </section>
    );
}
