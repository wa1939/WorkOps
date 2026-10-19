"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LayoutGrid, List, Calendar } from "lucide-react";
import type { Block } from "./block-editor";

type Option = { id: string; name: string };
type SelectorState = { options: Option[]; error: string | null; loading: boolean };

const viewTypes = [
    { value: "board", label: "Board", icon: LayoutGrid },
    { value: "table", label: "Table", icon: List },
    { value: "calendar", label: "Calendar", icon: Calendar },
] as const;
const priorities = ["all", "LOW", "MEDIUM", "HIGH", "URGENT"];
const statuses = ["all", "TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"];
const dateRanges = ["all", "overdue", "today", "this-week"];
const groupModes = ["none", "status", "priority", "assignee", "project"];
const sortFields = ["updatedAt", "createdAt", "taskKey", "title", "status", "priority", "dueDate"];

function valuesFor(block: Block, key: string): string[] {
    const rawBlock = block as unknown as Record<string, unknown>;
    const filters = block.filters ?? {};
    const flatten = (value: unknown): string[] => {
        if (Array.isArray(value)) return value.flatMap(flatten);
        if (typeof value !== "string") return [];
        return value.split(",").map((part) => part.trim()).filter(Boolean);
    };
    return Array.from(new Set([...flatten(rawBlock[key]), ...flatten(filters[key])]));
}

function scalarFor(block: Block, ...keys: string[]): string | undefined {
    const rawBlock = block as unknown as Record<string, unknown>;
    for (const key of keys) {
        const value = rawBlock[key] ?? block.filters?.[key];
        if (typeof value === "string" && value.length > 0) return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
    return undefined;
}

function updateListField(block: Block, key: string, values: string[]): Block {
    const next = { ...block } as Block & Record<string, unknown>;
    const filters = { ...(block.filters ?? {}) };
    const blockHasField = Object.prototype.hasOwnProperty.call(block, key);
    const filterHasField = Object.prototype.hasOwnProperty.call(filters, key);
    const uniqueValues = Array.from(new Set(values));
    if (blockHasField || !filterHasField) next[key] = uniqueValues;
    if (filterHasField) {
        if (uniqueValues.length === 0) delete filters[key];
        else filters[key] = typeof filters[key] === "string" ? uniqueValues.join(",") : uniqueValues;
    }
    next.filters = filters;
    return next;
}

function updateProjectSelection(block: Block, value: string | undefined): Block {
    const next = { ...block } as Block & Record<string, unknown>;
    const filters = { ...(block.filters ?? {}) };

    delete next.projectIds;
    delete filters.projectId;
    delete filters.projectIds;
    if (value === undefined) delete next.projectId;
    else next.projectId = value;
    next.filters = filters;
    return next;
}

function updateScalarField(block: Block, key: string, value: string | undefined): Block {
    const next = { ...block } as Block & Record<string, unknown>;
    const filters = { ...(block.filters ?? {}) };
    const blockHasField = Object.prototype.hasOwnProperty.call(block, key);
    const filterHasField = Object.prototype.hasOwnProperty.call(filters, key);
    if (value === undefined) {
        delete next[key];
        delete filters[key];
    } else {
        if (blockHasField || !filterHasField) next[key] = value;
        if (filterHasField) filters[key] = value;
    }
    next.filters = filters;
    return next;
}

function selectorClassName(): string {
    return "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
}

function normalizeOptions(value: unknown, nameKey = "name"): Option[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((row): Option[] => {
        if (!row || typeof row !== "object") return [];
        const record = row as Record<string, unknown>;
        if (typeof record.id !== "string") return [];
        const name = typeof record[nameKey] === "string" ? record[nameKey] as string : typeof record.email === "string" ? record.email : record.id;
        return [{ id: record.id, name }];
    });
}

async function loadOptions(url: string, signal: AbortSignal): Promise<Option[]> {
    const response = await fetch(url, { signal, cache: "no-store" });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return normalizeOptions(payload);
}

export function TaskViewBlockEditor({ block, onUpdate }: { block: Block; onUpdate: (block: Block) => void }) {
    const instanceId = useId().replaceAll(":", "");
    const [users, setUsers] = useState<SelectorState>({ options: [], error: null, loading: true });
    const [projects, setProjects] = useState<SelectorState>({ options: [], error: null, loading: true });
    const [tags, setTags] = useState<SelectorState>({ options: [], error: null, loading: true });
    const assigneeIds = valuesFor(block, "assigneeIds");
    const tagIds = valuesFor(block, "tagIds");
    const currentViewType = block.viewType || "board";
    const hasRequiredProject = Boolean(scalarFor(block, "projectId") || valuesFor(block, "projectIds").length > 0);

    useEffect(() => {
        const controller = new AbortController();
        const load = async (url: string, setter: React.Dispatch<React.SetStateAction<SelectorState>>, label: string) => {
            try {
                const options = await loadOptions(url, controller.signal);
                if (!controller.signal.aborted) setter({ options, error: null, loading: false });
            } catch (error: unknown) {
                if (!controller.signal.aborted) setter({ options: [], error: `Could not load ${label}.`, loading: false });
            }
        };
        void load("/api/users", setUsers, "users");
        void load("/api/projects", setProjects, "projects");
        void load("/api/tags", setTags, "tags");
        return () => controller.abort();
    }, []);

    const persistedProjectId = scalarFor(block, "projectId");
    const persistedProjectIds = valuesFor(block, "projectIds");
    const persistedProjectOptionIds = Array.from(new Set([
        ...(persistedProjectId ? [persistedProjectId] : []),
        ...persistedProjectIds,
    ]));
    const hasConflictingProjectList = Boolean(
        persistedProjectId && persistedProjectIds.some((projectId) => projectId !== persistedProjectId),
    );
    const selectedProject = hasConflictingProjectList
        ? "__compound__"
        : persistedProjectId ?? (persistedProjectIds.length === 1 ? persistedProjectIds[0] : persistedProjectIds.length > 1 ? "__multiple__" : "all");
    const selectedDateRange = scalarFor(block, "dueRange") ?? "all";
    const selectedGroup = scalarFor(block, "groupBy") ?? "none";
    const persistedSort = scalarFor(block, "sortBy");
    const selectedSort = persistedSort === "dueAt" ? "dueDate" : persistedSort ?? "updatedAt";
    const selectedDirection = scalarFor(block, "sortDir", "dir") ?? "desc";
    const selectedPriority = scalarFor(block, "priority") ?? "all";
    const selectedStatus = scalarFor(block, "status") ?? "all";
    const controlId = (name: string) => `task-view-${name}-${instanceId}`;
    const optionErrors = useMemo(() => [users.error, projects.error, tags.error].filter(Boolean) as string[], [projects.error, tags.error, users.error]);

    const toggleAssignee = (id: string, checked: boolean) => {
        const next = checked ? [...assigneeIds, id] : assigneeIds.filter((value) => value !== id);
        onUpdate(updateListField(block, "assigneeIds", next));
    };
    const toggleTag = (id: string, checked: boolean) => {
        const next = checked ? [...tagIds, id] : tagIds.filter((value) => value !== id);
        onUpdate(updateListField(block, "tagIds", next));
    };
    const updateFilter = (key: string, value: string) => {
        onUpdate(updateScalarField(block, key, !value || value === "all" ? undefined : value));
    };

    return (
        <div className="space-y-5" data-task-view-editor>
            <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Task View Block</p>
                <p className="mt-1 text-sm text-muted-foreground">Read-only task results use the authorized view-data query and keep saved filters local to this block.</p>
            </div>

            {currentViewType === "gallery" || currentViewType === "timeline" ? (
                <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">This is an unsupported legacy <strong>{currentViewType}</strong> presentation. Choose Board, Table, or Calendar to migrate this saved view.</div>
            ) : null}
            {optionErrors.length > 0 && <div role="alert" aria-label="Could not load task view selectors." className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{optionErrors.join(" ")}</div>}
            {block.projectSelectionRequired && !hasRequiredProject && <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Setup required: choose a project before this block can show tasks.</div>}

            <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Presentation</legend>
                <div className="flex flex-wrap gap-2">
                    {viewTypes.map((view) => <Button key={view.value} type="button" variant={currentViewType === view.value ? "default" : "outline"} className="min-h-11" onClick={() => onUpdate({ ...block, viewType: view.value })}><view.icon className="mr-2 h-4 w-4" aria-hidden="true" />{view.label}</Button>)}
                </div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label htmlFor={controlId("priority")}>Priority filter</Label><Select value={selectedPriority} onValueChange={(value) => updateFilter("priority", value)}><SelectTrigger id={controlId("priority")} className="min-h-11"><SelectValue placeholder="All priorities" /></SelectTrigger><SelectContent>{priorities.map((priority) => <SelectItem key={priority} value={priority}>{priority === "all" ? "All priorities" : priority}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor={controlId("status")}>Status filter</Label><Select value={selectedStatus} onValueChange={(value) => updateFilter("status", value)}><SelectTrigger id={controlId("status")} className="min-h-11"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent>{statuses.map((status) => <SelectItem key={status} value={status}>{status === "all" ? "All statuses" : status}</SelectItem>)}</SelectContent></Select></div>
            </div>

            <fieldset className="space-y-3"><legend className="text-sm font-medium">Assignees</legend>
                <label className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"><Checkbox aria-label="Me" checked={assigneeIds.includes("@me")} onCheckedChange={(checked) => toggleAssignee("@me", checked === true)} /><span>Me (current actor)</span></label>
                {users.loading && <p className="text-xs text-muted-foreground" aria-live="polite">Loading users…</p>}
                <div className="grid gap-2 sm:grid-cols-2">{users.options.map((user) => <label key={user.id} className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"><Checkbox aria-label={user.name} checked={assigneeIds.includes(user.id)} onCheckedChange={(checked) => toggleAssignee(user.id, checked === true)} /><span dir="auto">{user.name}</span></label>)}</div>
            </fieldset>

            <div className="space-y-2"><Label htmlFor={controlId("project")}>Project filter</Label><select id={controlId("project")} aria-label="Project filter" className={selectorClassName()} value={selectedProject} onChange={(event) => onUpdate(updateProjectSelection(block, event.target.value === "all" ? undefined : event.target.value))}>
                <option value="all">All projects</option>
                {selectedProject === "__multiple__" && <option value="__multiple__" disabled>Multiple saved projects ({persistedProjectIds.length})</option>}
                {selectedProject === "__compound__" && <option value="__compound__" disabled>Project plus saved list restriction</option>}
                {persistedProjectOptionIds.filter((projectId) => !projects.options.some((project) => project.id === projectId)).map((projectId) => <option key={`saved-${projectId}`} value={projectId}>Saved project ({projectId})</option>)}
                {projects.options.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select></div>

            <fieldset className="space-y-3"><legend className="text-sm font-medium">Tags</legend>
                {tags.loading && <p className="text-xs text-muted-foreground" aria-live="polite">Loading tags…</p>}
                <div className="grid gap-2 sm:grid-cols-2">{tags.options.map((tag) => <label key={tag.id} className="flex min-h-11 items-center gap-3 rounded-md border border-border px-3 py-2 text-sm"><Checkbox aria-label={tag.name} checked={tagIds.includes(tag.id)} onCheckedChange={(checked) => toggleTag(tag.id, checked === true)} /><span dir="auto">{tag.name}</span></label>)}</div>
            </fieldset>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2"><Label htmlFor={controlId("date-range")}>Date range</Label><select id={controlId("date-range")} aria-label="Date range" className={selectorClassName()} value={selectedDateRange} onChange={(event) => onUpdate(updateScalarField(block, "dueRange", event.target.value === "all" ? undefined : event.target.value))}>{dateRanges.map((range) => <option key={range} value={range}>{range === "all" ? "Any due date" : range}</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor={controlId("group")}>Group tasks by</Label><select id={controlId("group")} aria-label="Group tasks by" className={selectorClassName()} value={selectedGroup} onChange={(event) => onUpdate(updateScalarField(block, "groupBy", event.target.value === "none" ? undefined : event.target.value))}>{groupModes.map((group) => <option key={group} value={group}>{group === "none" ? "No grouping" : group}</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor={controlId("sort")}>Sort tasks by</Label><select id={controlId("sort")} aria-label="Sort tasks by" className={selectorClassName()} value={selectedSort} onChange={(event) => onUpdate(updateScalarField(block, "sortBy", event.target.value))}>{sortFields.map((field) => <option key={field} value={field}>{field === "dueDate" ? "Due date" : field}</option>)}</select></div>
                <div className="space-y-2"><Label htmlFor={controlId("sort-direction")}>Sort direction</Label><select id={controlId("sort-direction")} aria-label="Sort direction" className={selectorClassName()} value={selectedDirection} onChange={(event) => onUpdate(updateScalarField(block, "sortDir", event.target.value))}><option value="asc">Ascending</option><option value="desc">Descending</option></select></div>
            </div>

            {block.projectSelectionRequired && <p className="text-xs text-muted-foreground">This template requires a specific project selection; it will not silently fall back to all projects.</p>}
        </div>
    );
}
