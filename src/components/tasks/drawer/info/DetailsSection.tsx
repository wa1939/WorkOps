"use client";

import { useEffect, useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { TaskDrawerPayload, TaskDrawerPatch } from "../types";
import { initials, minutesLabel, userLabel } from "./shared";

const PROGRESS_MODES = [
    { value: "manual", label: "Manual" },
    { value: "subtasks", label: "Subtasks" },
] as const;

export interface DetailsSectionProps {
    task: TaskDrawerPayload;
    onUpdate: (patch: TaskDrawerPatch) => Promise<TaskDrawerPayload>;
    onRefresh: () => Promise<void>;
}

function dateValue(value: string): Date | null {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function responseError(value: unknown): string {
    if (value && typeof value === "object" && "error" in value) {
        const error = (value as { error?: unknown }).error;
        if (typeof error === "string") return error;
    }
    return "AI request failed";
}

export function DetailsSection({ task, onUpdate, onRefresh }: DetailsSectionProps) {
    const [startAt, setStartAt] = useState(() => task.startAt?.slice(0, 10) ?? "");
    const [dueAt, setDueAt] = useState(() => task.dueAt?.slice(0, 10) ?? "");
    const [dateError, setDateError] = useState<string | null>(null);
    const [assigneeSaving, setAssigneeSaving] = useState(false);
    const [improvingTitle, setImprovingTitle] = useState(false);
    const [titleSuggestion, setTitleSuggestion] = useState<string | null>(null);
    const { toast } = useToast();

    useEffect(() => {
        setStartAt(task.startAt?.slice(0, 10) ?? "");
        setDueAt(task.dueAt?.slice(0, 10) ?? "");
    }, [task.dueAt, task.startAt]);

    const assigneeIds = useMemo(() => new Set(task.assignments.map((assignment) => assignment.userId)), [task.assignments]);
    const availableMembers = useMemo(() => {
        const members = task.project?.members?.map((member) => member.user) ?? [];
        const assigned = task.assignments.map((assignment) => assignment.user).filter((user): user is NonNullable<typeof user> => Boolean(user));
        const byId = new Map([...members, ...assigned].map((user) => [user.id, user]));
        return Array.from(byId.values());
    }, [task.assignments, task.project?.members]);

    const saveDates = async (nextStart: string, nextDue: string) => {
        const start = dateValue(nextStart);
        const due = dateValue(nextDue);
        if (start && due && start > due) {
            setDateError("Start date must be on or before the due date.");
            return;
        }
        setDateError(null);
        await onUpdate({
            startAt: start ? start.toISOString() : null,
            dueAt: due ? due.toISOString() : null,
        });
    };

    const saveAssignees = async (nextIds: string[]) => {
        setAssigneeSaving(true);
        try {
            await onUpdate({ assigneeIds: nextIds });
        } finally {
            setAssigneeSaving(false);
        }
    };

    const improveTitle = async () => {
        if (improvingTitle) return;
        setImprovingTitle(true);
        setTitleSuggestion(null);
        try {
            const response = await fetch("/api/ai/task-actions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "improve-title", taskId: task.id }),
            });
            const body = await response.json().catch(() => null) as unknown;
            if (!response.ok) throw new Error(responseError(body));
            const suggestion = body && typeof body === "object" && "suggestion" in body
                ? (body as { suggestion?: unknown }).suggestion
                : null;
            if (typeof suggestion !== "string" || !suggestion.trim()) throw new Error("Invalid AI title response");
            setTitleSuggestion(suggestion.trim());
        } catch (error: unknown) {
            toast({
                title: "AI title improvement failed",
                description: error instanceof Error ? error.message : "Try again.",
                variant: "destructive",
            });
        } finally {
            setImprovingTitle(false);
        }
    };

    const acceptTitleSuggestion = async () => {
        if (!titleSuggestion) return;
        try {
            await onUpdate({ title: titleSuggestion });
            setTitleSuggestion(null);
            toast({ title: "Task title updated" });
        } catch (error: unknown) {
            toast({
                title: "Could not update title",
                description: error instanceof Error ? error.message : "Try again.",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="space-y-4">
            <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-muted-foreground">Title</p>
                        <p className="truncate text-sm font-medium text-foreground" title={task.title}>{task.title}</p>
                    </div>
                    <button
                        type="button"
                        disabled={improvingTitle}
                        onClick={() => void improveTitle()}
                        className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {improvingTitle ? "✦ Improving…" : "✦ AI: improve title"}
                    </button>
                </div>
                {titleSuggestion && (
                    <div className="mt-3 rounded-md border border-primary/20 bg-background p-2.5 text-sm">
                        <p className="text-xs font-medium text-muted-foreground">Suggestion</p>
                        <p className="mt-1 font-medium">{titleSuggestion}</p>
                        <div className="mt-2 flex justify-end gap-2">
                            <button type="button" onClick={() => setTitleSuggestion(null)} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted">Dismiss</button>
                            <button type="button" onClick={() => void acceptTitleSuggestion()} className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">Use suggestion</button>
                        </div>
                    </div>
                )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>Start date</span>
                    <input
                        type="date"
                        value={startAt}
                        onChange={(event) => setStartAt(event.target.value)}
                        onBlur={() => void saveDates(startAt, dueAt)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring"
                    />
                </label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>Due date</span>
                    <input
                        type="date"
                        value={dueAt}
                        onChange={(event) => setDueAt(event.target.value)}
                        onBlur={() => void saveDates(startAt, dueAt)}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring"
                    />
                </label>
            </div>
            {dateError && <p className="text-xs text-destructive" role="alert">{dateError}</p>}

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>Estimate</span>
                    <div className="relative">
                        <input
                            type="number"
                            min={0}
                            step={15}
                            defaultValue={task.estimateMinutes ?? ""}
                            onBlur={(event) => {
                                const value = event.target.value === "" ? null : Math.max(0, Number(event.target.value));
                                void onUpdate({ estimateMinutes: Number.isFinite(value) ? value : null });
                            }}
                            className="h-9 w-full rounded-md border border-input bg-background px-2 pr-12 text-sm font-normal text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring"
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs font-normal text-muted-foreground">min</span>
                    </div>
                </label>
                <label className="space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>Progress mode</span>
                    <select
                        value={PROGRESS_MODES.some((mode) => mode.value === task.progressMode) ? task.progressMode : "manual"}
                        onChange={(event) => void onUpdate({ progressMode: event.target.value })}
                        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring"
                    >
                        {PROGRESS_MODES.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
                    </select>
                </label>
            </div>

            {task.progressMode !== "subtasks" && (
                <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
                    <span>Progress</span>
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min={0}
                            max={100}
                            value={task.manualProgress ?? 0}
                            onChange={(event) => void onUpdate({ manualProgress: Number(event.target.value) })}
                            className="min-w-0 flex-1 accent-primary"
                        />
                        <input
                            type="number"
                            min={0}
                            max={100}
                            value={task.manualProgress ?? 0}
                            onChange={(event) => void onUpdate({ manualProgress: Number(event.target.value) })}
                            className="h-9 w-16 rounded-md border border-input bg-background px-2 text-right text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:ring-2 focus:ring-ring"
                            aria-label="Progress percentage"
                        />
                        <span className="text-xs">%</span>
                    </div>
                </label>
            )}

            <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">Assignees</span>
                <Popover>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            disabled={assigneeSaving}
                            className="flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-left text-sm text-foreground outline-none transition-colors duration-150 hover:bg-accent disabled:opacity-60 focus:ring-2 focus:ring-ring"
                        >
                            <span className="flex -space-x-1.5">
                                {task.assignments.slice(0, 4).map((assignment) => (
                                    <span key={assignment.id} className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[9px] font-semibold">
                                        {assignment.user?.image ? <img src={assignment.user.image} alt="" className="h-full w-full object-cover" /> : initials(assignment.user)}
                                    </span>
                                ))}
                            </span>
                            <span className="truncate">{task.assignments.length ? `${task.assignments.length} assigned` : "Unassigned"}</span>
                            <span className="ml-auto text-xs text-muted-foreground">Select</span>
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72 p-2">
                        <div className="max-h-56 space-y-1 overflow-y-auto">
                            {availableMembers.length === 0 && <p className="p-2 text-xs text-muted-foreground">No project members available.</p>}
                            {availableMembers.map((user) => {
                                const checked = assigneeIds.has(user.id);
                                return (
                                    <label key={user.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => void saveAssignees(checked ? Array.from(assigneeIds).filter((id) => id !== user.id) : [...Array.from(assigneeIds), user.id])}
                                            className="accent-primary"
                                        />
                                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">{initials(user)}</span>
                                        <span className="truncate">{userLabel(user)}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Subscribers</span>
                    <button
                        type="button"
                        onClick={async () => {
                            await fetch(`/api/tasks/${encodeURIComponent(task.id)}/subscribers`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
                            await onRefresh();
                        }}
                        className="text-xs font-medium text-primary hover:underline"
                    >
                        + Add me
                    </button>
                </div>
                <div className="flex min-h-8 items-center gap-1">
                    {task.subscribers.length === 0 && <span className="text-xs text-muted-foreground">No subscribers yet.</span>}
                    {task.subscribers.map((subscriber) => (
                        <span key={subscriber.id} title={userLabel(subscriber.user)} className={cn("flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[10px] font-semibold", subscriber.user.image && "p-0")}>
                            {subscriber.user.image ? <img src={subscriber.user.image} alt={userLabel(subscriber.user)} className="h-full w-full object-cover" /> : initials(subscriber.user)}
                        </span>
                    ))}
                </div>
            </div>

            <p className="text-xs text-muted-foreground">{minutesLabel(task.estimateMinutes)} estimated</p>
        </div>
    );
}
