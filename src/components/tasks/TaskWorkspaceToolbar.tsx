"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, List, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type TaskWorkspaceScope = "all" | "assigned" | "related" | "created" | "unassigned";
export type TaskWorkspaceView = "list" | "board";
export type TaskWorkspaceDuePreset = "" | "today" | "week" | "overdue";

export interface TaskWorkspaceFilterState {
    scope: TaskWorkspaceScope;
    assigneeIds: string[];
    status: string[];
    priority: string[];
    search: string;
    due: TaskWorkspaceDuePreset;
    sortBy: string;
    dir: string;
}

export interface TaskWorkspaceToolbarProps {
    filters: TaskWorkspaceFilterState;
    onChange: (patch: Partial<TaskWorkspaceFilterState>) => void;
    onClear: () => void;
    view: TaskWorkspaceView;
    onViewChange: (view: TaskWorkspaceView) => void;
}

export const TASK_SCOPE_OPTIONS: ReadonlyArray<{ value: TaskWorkspaceScope; label: string }> = [
    { value: "assigned", label: "My tasks" },
    { value: "all", label: "All tasks" },
    { value: "related", label: "Related to me" },
];

const EXTRA_SCOPE_OPTIONS: ReadonlyArray<{ value: TaskWorkspaceScope; label: string }> = [
    { value: "created", label: "Created by me" },
    { value: "unassigned", label: "Unassigned" },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: "TODO", label: "To do" },
    { value: "DOING", label: "In progress" },
    { value: "BLOCKED", label: "Blocked" },
    { value: "WAITING", label: "Waiting" },
    { value: "DONE", label: "Done" },
    { value: "CANCELED", label: "Canceled" },
];

const PRIORITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: "URGENT", label: "Urgent" },
    { value: "HIGH", label: "High" },
    { value: "MEDIUM", label: "Medium" },
    { value: "LOW", label: "Low" },
];

const DUE_PRESET_OPTIONS: ReadonlyArray<{ value: Exclude<TaskWorkspaceDuePreset, "">; label: string }> = [
    { value: "today", label: "Due today" },
    { value: "week", label: "Next 7 days" },
    { value: "overdue", label: "Overdue" },
];

export const TASK_SORT_BY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: "dueDate", label: "Due date" },
    { value: "priority", label: "Priority" },
    { value: "createdAt", label: "Created" },
    { value: "updatedAt", label: "Last updated" },
    { value: "title", label: "Title" },
];

const DIRECTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
    { value: "desc", label: "Descending" },
    { value: "asc", label: "Ascending" },
];

interface TaskPickerUser {
    id: string;
    name?: string | null;
    email?: string | null;
}

const SELECT_CLASS =
    "h-11 w-full max-w-44 rounded-md border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

const FILTER_LABEL_CLASS = "flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground";

function listValue(values: string[]): string {
    return values.length > 0 ? values[0] : "";
}

/**
 * Toolbar for the tasks workspace. Purely controlled: every change is reported
 * upward as a patch and encoded in the URL by the parent, so filters survive
 * refresh, back navigation and view switches.
 */
export function TaskWorkspaceToolbar({
    filters,
    onChange,
    onClear,
    view,
    onViewChange,
}: TaskWorkspaceToolbarProps) {
    const [users, setUsers] = useState<TaskPickerUser[] | null>(null);
    const [usersUnavailable, setUsersUnavailable] = useState(false);
    const [searchDraft, setSearchDraft] = useState(filters.search);
    const [advancedOpen, setAdvancedOpen] = useState(false);

    useEffect(() => {
        setSearchDraft(filters.search);
    }, [filters.search]);
    useEffect(() => {
        if (searchDraft.trim() === filters.search) return;
        const timer = window.setTimeout(() => onChange({ search: searchDraft.trim() }), 300);
        return () => window.clearTimeout(timer);
    }, [searchDraft, filters.search, onChange]);

    useEffect(() => {
        let active = true;
        fetch("/api/users", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) throw new Error("Failed to fetch users");
                return response.json() as Promise<unknown>;
            })
            .then((payload) => {
                if (!active) return;
                const people = Array.isArray(payload)
                    ? payload.filter((user): user is TaskPickerUser =>
                        Boolean(user) && typeof (user as TaskPickerUser).id === "string")
                    : [];
                setUsers(people);
            })
            .catch(() => {
                if (active) setUsersUnavailable(true);
            });
        return () => {
            active = false;
        };
    }, []);

    const personValue = filters.scope === "all" ? listValue(filters.assigneeIds) : "";
    const extraScope = EXTRA_SCOPE_OPTIONS.find((option) => option.value === filters.scope);
    const hasActiveFilters =
        filters.scope !== "assigned" ||
        filters.assigneeIds.length > 0 ||
        filters.status.length > 0 ||
        filters.priority.length > 0 ||
        filters.search.trim() !== "" ||
        filters.due !== "" ||
        (filters.sortBy !== "" && filters.sortBy !== "updatedAt") ||
        filters.dir !== "desc";

    const selectScope = (scope: TaskWorkspaceScope) => {
        onChange(scope === "assigned" ? { scope, assigneeIds: [] } : { scope });
    };

    const selectPerson = (userId: string) => {
        if (userId) onChange({ scope: "all", assigneeIds: [userId] });
        else onChange({ assigneeIds: [] });
    };

    const submitSearch = (event: React.FormEvent) => {
        event.preventDefault();
        onChange({ search: searchDraft.trim() });
    };

    return (
        <section aria-label="Task filters" className="space-y-3">
            <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
            <div className="flex flex-wrap items-center gap-2">
                <div
                    role="group"
                    aria-label="Task scope"
                    className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1"
                >
                    {TASK_SCOPE_OPTIONS.map((option) => (
                        <Button
                            key={option.value}
                            type="button"
                            variant={filters.scope === option.value ? "secondary" : "ghost"}
                            size="sm"
                            aria-pressed={filters.scope === option.value}
                            className="min-h-11"
                            onClick={() => selectScope(option.value)}
                        >
                            {option.label}
                        </Button>
                    ))}
                    <label className="sr-only" htmlFor="task-extra-scope">More scopes</label>
                    <select
                        id="task-extra-scope"
                        aria-label="More scopes"
                        value={extraScope?.value ?? ""}
                        onChange={(event) => {
                            if (event.target.value) selectScope(event.target.value as TaskWorkspaceScope);
                        }}
                        className={cn(SELECT_CLASS, "hidden max-w-36 border-0 bg-transparent pr-6 text-sm sm:block")}
                    >
                        <option value="">More…</option>
                        {EXTRA_SCOPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex-1" />
                <Button asChild size="sm" className="min-h-11">
                    <Link href="/tasks/new">
                        <Plus className="mr-2 h-4 w-4" />
                        New Task
                    </Link>
                </Button>
                <div
                    role="group"
                    aria-label="Tasks view"
                    className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1"
                >
                    <Button
                        type="button"
                        variant={view === "list" ? "secondary" : "ghost"}
                        size="sm"
                        aria-pressed={view === "list"}
                        className="min-h-11"
                        onClick={() => onViewChange("list")}
                    >
                        <List className="mr-2 h-4 w-4" />
                        List
                    </Button>
                    <Button
                        type="button"
                        variant={view === "board" ? "secondary" : "ghost"}
                        size="sm"
                        aria-pressed={view === "board"}
                        className="min-h-11"
                        onClick={() => onViewChange("board")}
                    >
                        <LayoutGrid className="mr-2 h-4 w-4" />
                        Board
                    </Button>
                </div>
            </div>

            <div className="flex flex-wrap items-end gap-2">
                <form onSubmit={submitSearch} className="relative min-w-52 flex-1 basis-56">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="search"
                        enterKeyHint="search"
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                        placeholder="Search these tasks…"
                        aria-label="Search tasks"
                        className="h-11 pl-9 pr-12 [&::-webkit-search-cancel-button]:appearance-none"
                    />
                    {searchDraft && (
                        <button
                            type="button"
                            aria-label="Clear search"
                            onClick={() => {
                                setSearchDraft("");
                                onChange({ search: "" });
                            }}
                            className="absolute right-0 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </form>

                <label className={FILTER_LABEL_CLASS}>
                    Person
                    <select
                        value={personValue}
                        disabled={usersUnavailable}
                        onChange={(event) => selectPerson(event.target.value)}
                        className={SELECT_CLASS}
                    >
                        <option value="">Anyone</option>
                        {(users ?? []).map((user) => (
                            <option key={user.id} value={user.id}>
                                {user.name || user.email || user.id}
                            </option>
                        ))}
                        {usersUnavailable && <option value="">People unavailable</option>}
                    </select>
                </label>

                <Button type="button" variant="outline" className="min-h-11 sm:hidden" aria-expanded={advancedOpen} aria-controls="task-advanced-filters" onClick={() => setAdvancedOpen(!advancedOpen)}>
                    <SlidersHorizontal className="mr-2 h-4 w-4" />Filters
                </Button>
                <div id="task-advanced-filters" className={cn("w-full flex-wrap items-end gap-2 sm:contents", advancedOpen ? "flex" : "hidden")}>
                <label className={cn(FILTER_LABEL_CLASS, "sm:hidden")}>
                    Scope
                    <select className={SELECT_CLASS} aria-label="Additional task scope" value={extraScope?.value ?? ""} onChange={(event) => { if (event.target.value) selectScope(event.target.value as TaskWorkspaceScope); }}>
                        <option value="">More scopes…</option>
                        {EXTRA_SCOPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                </label>
                <label className={FILTER_LABEL_CLASS}>
                    Status
                    <select
                        value={listValue(filters.status)}
                        onChange={(event) => onChange({ status: event.target.value ? [event.target.value] : [] })}
                        className={SELECT_CLASS}
                    >
                        <option value="">Any status</option>
                        {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                    Priority
                    <select
                        value={listValue(filters.priority)}
                        onChange={(event) => onChange({ priority: event.target.value ? [event.target.value] : [] })}
                        className={SELECT_CLASS}
                    >
                        <option value="">Any priority</option>
                        {PRIORITY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                    Due
                    <select
                        value={filters.due}
                        onChange={(event) => onChange({ due: event.target.value as TaskWorkspaceDuePreset })}
                        className={SELECT_CLASS}
                    >
                        <option value="">Any due date</option>
                        {DUE_PRESET_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                    Sort by
                    <select
                        value={filters.sortBy}
                        onChange={(event) => onChange({ sortBy: event.target.value })}
                        className={SELECT_CLASS}
                    >
                        {TASK_SORT_BY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>

                <label className={FILTER_LABEL_CLASS}>
                    Direction
                    <select
                        value={filters.dir}
                        onChange={(event) => onChange({ dir: event.target.value })}
                        className={SELECT_CLASS}
                    >
                        {DIRECTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>

                </div>
                {hasActiveFilters && (
                    <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 text-muted-foreground"
                        onClick={onClear}
                    >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Clear filters
                    </Button>
                )}
            </div>
        </section>
    );
}

export default TaskWorkspaceToolbar;
