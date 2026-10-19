"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Priority, TaskStatus } from "@prisma/client";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X } from "lucide-react";

const STATUS_OPTIONS: readonly TaskStatus[] = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"];
const PRIORITY_OPTIONS: readonly Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

type BulkAction =
    | "status"
    | "priority"
    | "assignee"
    | "tagAdd"
    | "tagRemove"
    | "archive"
    | "unarchive"
    | "delete"
    | "duplicate"
    | "export";

type BulkRequest = {
    action: BulkAction;
    taskIds: string[];
    payload: Record<string, unknown>;
};

type BulkFailure = {
    taskId: string;
    reason: string;
};

type BulkResults = {
    succeeded: string[];
    failed: BulkFailure[];
};

type BulkTag = {
    id: string;
    name: string;
    color?: string | null;
};

type BulkAssignee = {
    id: string;
    name: string | null;
    email: string | null;
};

export interface BulkBarProps {
    selectedIds: ReadonlySet<string>;
    onRefresh: () => void;
    onClearSelection: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function errorMessage(value: unknown): string {
    if (isRecord(value) && typeof value.error === "string") return value.error;
    return value instanceof Error ? value.message : "Bulk action failed";
}

function parseBulkResults(value: unknown): BulkResults {
    if (!isRecord(value) || !isRecord(value.results)) throw new Error("Invalid bulk response");
    const succeeded = Array.isArray(value.results.succeeded)
        ? value.results.succeeded.filter((id): id is string => typeof id === "string")
        : [];
    const failed = Array.isArray(value.results.failed)
        ? value.results.failed.flatMap((failure): BulkFailure[] => {
            if (!isRecord(failure) || typeof failure.taskId !== "string") return [];
            return [{
                taskId: failure.taskId,
                reason: typeof failure.reason === "string" ? failure.reason : "failed",
            }];
        })
        : [];
    return { succeeded, failed };
}

function normalizeTags(value: unknown): BulkTag[] {
    const rows = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value.tags)
            ? value.tags
            : [];
    return rows.flatMap((row): BulkTag[] => {
        if (!isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string") return [];
        return [{ id: row.id, name: row.name, color: typeof row.color === "string" ? row.color : null }];
    });
}

function normalizeAssignees(value: unknown): BulkAssignee[] {
    const rows = Array.isArray(value)
        ? value
        : isRecord(value) && Array.isArray(value.users)
            ? value.users
            : [];
    return rows.flatMap((row): BulkAssignee[] => {
        if (!isRecord(row) || typeof row.id !== "string") return [];
        return [{
            id: row.id,
            name: typeof row.name === "string" ? row.name : null,
            email: typeof row.email === "string" ? row.email : null,
        }];
    });
}

function humanize(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase().replaceAll("_", " ");
}

export function BulkBar({ selectedIds, onRefresh, onClearSelection }: BulkBarProps) {
    const { toast } = useToast();
    const taskIds = useMemo(() => Array.from(selectedIds), [selectedIds]);
    const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
    const [failures, setFailures] = useState<BulkFailure[]>([]);
    const [failurePanelOpen, setFailurePanelOpen] = useState(false);
    const [failureAction, setFailureAction] = useState<BulkAction | null>(null);
    const [statusValue, setStatusValue] = useState("");
    const [priorityValue, setPriorityValue] = useState("");
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [duplicateOpen, setDuplicateOpen] = useState(false);
    const [includeSubtasks, setIncludeSubtasks] = useState(false);
    const [includeAssignees, setIncludeAssignees] = useState(false);
    const [includeAttachments, setIncludeAttachments] = useState(false);
    const [assigneeOpen, setAssigneeOpen] = useState(false);
    const [assigneeMode, setAssigneeMode] = useState<"set" | "add" | "remove">("set");
    const [assigneeId, setAssigneeId] = useState("");
    const [assignees, setAssignees] = useState<BulkAssignee[]>([]);
    const [assigneesLoaded, setAssigneesLoaded] = useState(false);
    const [tags, setTags] = useState<BulkTag[]>([]);
    const [tagsLoading, setTagsLoading] = useState(true);
    const [tagsError, setTagsError] = useState<string | null>(null);
    const [tagOpen, setTagOpen] = useState(false);
    const [tagMode, setTagMode] = useState<"add" | "remove">("add");
    const [tagIds, setTagIds] = useState<Set<string>>(new Set());
    const [summaryOpen, setSummaryOpen] = useState(false);
    const [summary, setSummary] = useState<string | null>(null);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);

    useEffect(() => {
        const controller = new AbortController();
        setTagsLoading(true);
        fetch("/api/tags", { signal: controller.signal, cache: "no-store" })
            .then(async (response) => {
                const payload = await response.json() as unknown;
                if (!response.ok) throw new Error(errorMessage(payload));
                setTags(normalizeTags(payload));
                setTagsError(null);
            })
            .catch((error: unknown) => {
                if ((error as { name?: string }).name !== "AbortError") setTagsError(errorMessage(error));
            })
            .finally(() => {
                if (!controller.signal.aborted) setTagsLoading(false);
            });
        return () => controller.abort();
    }, []);

    useEffect(() => {
        if (!assigneeOpen || assigneesLoaded) return;
        const controller = new AbortController();
        fetch("/api/users", { signal: controller.signal, cache: "no-store" })
            .then(async (response) => {
                const payload = await response.json() as unknown;
                if (!response.ok) throw new Error(errorMessage(payload));
                setAssignees(normalizeAssignees(payload));
            })
            .catch((error: unknown) => {
                if ((error as { name?: string }).name !== "AbortError") setAssignees([]);
            })
            .finally(() => {
                if (!controller.signal.aborted) setAssigneesLoaded(true);
            });
        return () => controller.abort();
    }, [assigneeOpen, assigneesLoaded]);

    const execute = useCallback(async (request: BulkRequest) => {
        if (pendingAction || request.taskIds.length === 0) return;
        setPendingAction(request.action);
        setFailures([]);
        setFailureAction(null);
        setFailurePanelOpen(false);

        try {
            const response = await fetch("/api/tasks/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(request),
            });

            if (request.action === "export") {
                if (!response.ok) {
                    const payload = await response.json().catch(() => null) as unknown;
                    throw new Error(errorMessage(payload));
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = "tasks-export.xlsx";
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
                toast({ title: `${request.taskIds.length} exported` });
                onRefresh();
                onClearSelection();
                return;
            }

            const payload = await response.json().catch(() => null) as unknown;
            if (!response.ok) throw new Error(errorMessage(payload));
            const results = parseBulkResults(payload);
            onRefresh();
            if (results.failed.length > 0) {
                setFailures(results.failed);
                setFailureAction(request.action);
                setFailurePanelOpen(true);
                toast({
                    title: "Some tasks could not be updated",
                    description: `${results.failed.length} of ${request.taskIds.length} tasks failed.`,
                    variant: "destructive",
                });
            } else {
                toast({ title: `${results.succeeded.length} updated` });
                onClearSelection();
            }
        } catch (error: unknown) {
            toast({ title: "Bulk action failed", description: errorMessage(error), variant: "destructive" });
        } finally {
            setPendingAction(null);
        }
    }, [onClearSelection, onRefresh, pendingAction, toast]);

    const isBusy = pendingAction !== null;
    const request = useCallback((action: BulkAction, payload: Record<string, unknown> = {}) => ({
        action,
        taskIds,
        payload,
    }), [taskIds]);

    const applyTags = () => {
        if (tagIds.size === 0) return;
        const selectedTagIds = Array.from(tagIds);
        setTagOpen(false);
        setTagIds(new Set());
        void execute(request(tagMode === "add" ? "tagAdd" : "tagRemove", { tagIds: selectedTagIds }));
    };

    const applyAssignee = () => {
        const value = assigneeId.trim();
        if (!value) return;
        setAssigneeOpen(false);
        void execute(request("assignee", { mode: assigneeMode, userId: value }));
    };

    const applyDuplicate = () => {
        setDuplicateOpen(false);
        void execute(request("duplicate", { includeSubtasks, includeAssignees, includeAttachments }));
    };

    const summarizeSelection = useCallback(async () => {
        if (summaryLoading || taskIds.length === 0) return;
        setSummaryOpen(true);
        setSummary(null);
        setSummaryError(null);
        setSummaryLoading(true);
        try {
            const response = await fetch("/api/ai/task-actions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "summarize", tasks: taskIds }),
            });
            const payload = await response.json().catch(() => null) as unknown;
            if (!response.ok) throw new Error(errorMessage(payload));
            if (!isRecord(payload) || typeof payload.summary !== "string" || !payload.summary.trim()) {
                throw new Error("Invalid AI summary response");
            }
            setSummary(payload.summary);
        } catch (error: unknown) {
            const message = errorMessage(error);
            setSummaryError(message);
            toast({ title: "AI summary failed", description: message, variant: "destructive" });
        } finally {
            setSummaryLoading(false);
        }
    }, [summaryLoading, taskIds, toast]);

    if (taskIds.length === 0) return null;

    return (
        <div
            className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-lg border border-border bg-background/90 px-3 py-3 shadow-lg backdrop-blur transition-[opacity,transform] duration-200 md:inset-x-4 md:bottom-2 md:max-h-none md:overflow-visible md:px-4"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            aria-busy={isBusy}
        >
            <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2">
                <div className="mr-1 flex items-center gap-2 border-r border-border pr-3">
                    <span className="text-sm font-medium tabular-nums">{taskIds.length} selected</span>
                    <button
                        type="button"
                        aria-label="Clear selection"
                        disabled={isBusy}
                        onClick={onClearSelection}
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>

                <Popover open={summaryOpen} onOpenChange={setSummaryOpen}>
                    <PopoverTrigger asChild>
                        <button
                            type="button"
                            disabled={isBusy || summaryLoading}
                            onClick={() => void summarizeSelection()}
                            className="h-9 rounded-md border border-primary/40 px-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {summaryLoading && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Summarizing tasks" />}
                            {summaryLoading ? "✦ Summarizing…" : "✦ AI summarize"}
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-80">
                        <div className="space-y-2">
                            <p className="text-sm font-semibold">Selected task summary</p>
                            {summaryLoading && <p role="status" className="text-sm text-muted-foreground">Sabah is reviewing the selected tasks…</p>}
                            {summaryError && <p role="alert" className="text-sm text-destructive">{summaryError}</p>}
                            {summary && !summaryLoading && <p className="whitespace-pre-line text-sm leading-6">{summary}</p>}
                        </div>
                    </PopoverContent>
                </Popover>

                <label className="sr-only" htmlFor="bulk-status">Set status</label>
                <div className="relative">
                    <select
                        id="bulk-status"
                        value={statusValue}
                        disabled={isBusy}
                        onChange={(event) => {
                            const value = event.target.value;
                            setStatusValue("");
                            if (value) void execute(request("status", { status: value }));
                        }}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    >
                        <option value="">Status…</option>
                        {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{humanize(status)}</option>)}
                    </select>
                    {pendingAction === "status" && <Loader2 className="pointer-events-none absolute right-2 top-2 h-4 w-4 animate-spin" aria-label="Updating status" />}
                </div>

                <label className="sr-only" htmlFor="bulk-priority">Set priority</label>
                <div className="relative">
                    <select
                        id="bulk-priority"
                        value={priorityValue}
                        disabled={isBusy}
                        onChange={(event) => {
                            const value = event.target.value;
                            setPriorityValue("");
                            if (value) void execute(request("priority", { priority: value }));
                        }}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    >
                        <option value="">Priority…</option>
                        {PRIORITY_OPTIONS.map((priority) => <option key={priority} value={priority}>{humanize(priority)}</option>)}
                    </select>
                    {pendingAction === "priority" && <Loader2 className="pointer-events-none absolute right-2 top-2 h-4 w-4 animate-spin" aria-label="Updating priority" />}
                </div>

                <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                    <PopoverTrigger asChild>
                        <button type="button" disabled={isBusy} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
                            {pendingAction === "assignee" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Updating assignee" />}
                            Assignee
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72">
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Update assignee</p>
                            <select
                                value={assigneeMode}
                                onChange={(event) => setAssigneeMode(event.target.value as "set" | "add" | "remove")}
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                aria-label="Assignee update mode"
                            >
                                <option value="set">Replace assignees</option>
                                <option value="add">Add assignee</option>
                                <option value="remove">Remove assignee</option>
                            </select>
                            {assignees.length > 0 && (
                                <select
                                    value={assignees.some((assignee) => assignee.id === assigneeId) ? assigneeId : ""}
                                    onChange={(event) => setAssigneeId(event.target.value)}
                                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                    aria-label="Choose assignee"
                                >
                                    <option value="">Choose a person…</option>
                                    {assignees.map((assignee) => (
                                        <option key={assignee.id} value={assignee.id}>
                                            {assignee.name ?? assignee.email ?? assignee.id}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <input
                                value={assigneeId}
                                onChange={(event) => setAssigneeId(event.target.value)}
                                placeholder="User ID"
                                aria-label="Assignee user ID"
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                            />
                            <button type="button" disabled={!assigneeId.trim() || isBusy} onClick={applyAssignee} className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                                {pendingAction === "assignee" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Updating assignee" />}
                                Apply
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>

                <Popover open={tagOpen} onOpenChange={setTagOpen}>
                    <PopoverTrigger asChild>
                        <button type="button" disabled={isBusy} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
                            {(pendingAction === "tagAdd" || pendingAction === "tagRemove") && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Updating tags" />}
                            Tags
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-72">
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Update tags</p>
                            <select
                                value={tagMode}
                                onChange={(event) => setTagMode(event.target.value as "add" | "remove")}
                                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                                aria-label="Tag update mode"
                            >
                                <option value="add">Add tags</option>
                                <option value="remove">Remove tags</option>
                            </select>
                            {tagsLoading && <p className="text-xs text-muted-foreground">Loading tags…</p>}
                            {tagsError && <p role="alert" className="text-xs text-destructive">{tagsError}</p>}
                            {!tagsLoading && tags.length === 0 && !tagsError && <p className="text-xs text-muted-foreground">No tags available.</p>}
                            <div className="max-h-40 space-y-2 overflow-y-auto">
                                {tags.map((tag) => (
                                    <label key={tag.id} className="flex items-center gap-2 text-sm">
                                        <Checkbox
                                            checked={tagIds.has(tag.id)}
                                            onCheckedChange={(checked) => setTagIds((current) => {
                                                const next = new Set(current);
                                                if (checked === true) next.add(tag.id);
                                                else next.delete(tag.id);
                                                return next;
                                            })}
                                        />
                                        {tag.color && <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />}
                                        <span>{tag.name}</span>
                                    </label>
                                ))}
                            </div>
                            <button type="button" disabled={tagIds.size === 0 || isBusy} onClick={applyTags} className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                                {(pendingAction === "tagAdd" || pendingAction === "tagRemove") && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Updating tags" />}
                                Apply
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>

                <button type="button" disabled={isBusy} onClick={() => void execute(request("archive"))} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
                    {pendingAction === "archive" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Archiving" />}
                    Archive
                </button>
                <button type="button" disabled={isBusy} onClick={() => void execute(request("unarchive"))} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
                    {pendingAction === "unarchive" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Unarchiving" />}
                    Unarchive
                </button>

                <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                    <AlertDialogTrigger asChild>
                        <button type="button" disabled={isBusy} className="h-9 rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">
                            {pendingAction === "delete" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Deleting" />}
                            Delete
                        </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Delete selected tasks?</AlertDialogTitle>
                            <AlertDialogDescription>This permanently deletes {taskIds.length} selected task{taskIds.length === 1 ? "" : "s"} and cannot be undone.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => {
                                setDeleteOpen(false);
                                void execute(request("delete"));
                            }}>Delete tasks</AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                <Popover open={duplicateOpen} onOpenChange={setDuplicateOpen}>
                    <PopoverTrigger asChild>
                        <button type="button" disabled={isBusy} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
                            {pendingAction === "duplicate" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Duplicating" />}
                            Duplicate
                        </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-64">
                        <div className="space-y-3">
                            <p className="text-sm font-medium">Duplicate options</p>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={includeSubtasks} onCheckedChange={(checked) => setIncludeSubtasks(checked === true)} />
                                Include subtasks
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={includeAssignees} onCheckedChange={(checked) => setIncludeAssignees(checked === true)} />
                                Include assignees
                            </label>
                            <label className="flex items-center gap-2 text-sm">
                                <Checkbox checked={includeAttachments} onCheckedChange={(checked) => setIncludeAttachments(checked === true)} />
                                Include attachments
                            </label>
                            <button type="button" disabled={isBusy} onClick={applyDuplicate} className="h-9 w-full rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">
                                {pendingAction === "duplicate" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Duplicating tasks" />}
                                Duplicate tasks
                            </button>
                        </div>
                    </PopoverContent>
                </Popover>

                <button type="button" disabled={isBusy} onClick={() => void execute(request("export"))} className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">
                    {pendingAction === "export" && <Loader2 className="mr-1 inline h-4 w-4 animate-spin" aria-label="Exporting" />}
                    Export XLSX
                </button>

                {failures.length > 0 && (
                    <div className="basis-full border-t border-border pt-2">
                        <button
                            type="button"
                            aria-expanded={failurePanelOpen}
                            onClick={() => setFailurePanelOpen((open) => !open)}
                            className="text-sm font-medium text-destructive underline-offset-2 hover:underline"
                        >
                            {failures.length} task{failures.length === 1 ? "" : "s"} failed{failureAction ? ` during ${failureAction}` : ""}
                        </button>
                        {failurePanelOpen && (
                            <div role="alert" className="mt-2 max-h-32 overflow-y-auto rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs">
                                <ul className="space-y-1">
                                    {failures.map((failure) => (
                                        <li key={`${failure.taskId}-${failure.reason}`} className="flex gap-2">
                                            <code>{failure.taskId}</code>
                                            <span>{failure.reason}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
