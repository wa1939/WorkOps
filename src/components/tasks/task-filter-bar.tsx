"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowUpDown, CalendarClock, Flame, Search, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFilterPersistence } from "@/hooks/use-filter-persistence";

export const SORT_OPTIONS = [
    { value: "due-asc", label: "Due soonest" },
    { value: "due-desc", label: "Due latest" },
    { value: "priority", label: "Priority" },
    { value: "created-desc", label: "Newest" },
    { value: "created-asc", label: "Oldest" },
    { value: "title", label: "Title A–Z" },
] as const;

export const DUE_OPTIONS = [
    { value: "overdue", label: "Overdue" },
    { value: "today", label: "Due today" },
    { value: "week", label: "Next 7 days" },
    { value: "none", label: "No due date" },
] as const;

const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;

const TASK_FILTER_SCHEMA = {
    search: "",
    sort: "",
    due: "",
    priority: "",
};

/**
 * Filters live in the URL so a filtered list stays shareable and survives a refresh.
 * Every control rewrites the current query string rather than replacing it, so tab,
 * view and member selections are never dropped.
 */
export function TaskFilterBar() {
    const { filters, setFilters } = useFilterPersistence(TASK_FILTER_SCHEMA);
    const [isPending, startTransition] = useTransition();
    const [search, setSearch] = useState(filters.search);

    useEffect(() => {
        setSearch(filters.search);
    }, [filters.search]);

    const sort = filters.sort || "priority";
    const due = filters.due;
    const priority = filters.priority;

    const push = (changes: Partial<typeof TASK_FILTER_SCHEMA>) => {
        startTransition(() => setFilters(changes));
    };

    const submitSearch = (e: React.FormEvent) => {
        e.preventDefault();
        push({ search: search.trim() });
    };

    const hasFilters = Boolean(filters.due || filters.priority || filters.search || filters.sort);

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <form onSubmit={submitSearch} className="relative flex-1 min-w-[220px] max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search these tasks…"
                        aria-label="Search tasks"
                        className="pl-9 pr-8 h-9"
                    />
                    {search && (
                        <button
                            type="button"
                            aria-label="Clear search"
                            onClick={() => {
                                setSearch("");
                                push({ search: "" });
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </form>

                <label className="flex items-center gap-1.5 text-sm">
                    <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="sr-only">Sort by</span>
                    <select
                        value={sort}
                        onChange={(e) => push({ sort: e.target.value })}
                        className="h-9 rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                        {SORT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </label>

                {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

                {hasFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto text-muted-foreground"
                        onClick={() => {
                            setSearch("");
                            push({ search: "", due: "", priority: "", sort: "" });
                        }}
                    >
                        <X className="mr-1 h-3.5 w-3.5" />
                        Clear filters
                    </Button>
                )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" />
                    Due
                </span>
                <FilterChip active={!due} onClick={() => push({ due: "" })}>Any</FilterChip>
                {DUE_OPTIONS.map((o) => (
                    <FilterChip
                        key={o.value}
                        active={due === o.value}
                        onClick={() => push({ due: due === o.value ? "" : o.value })}
                    >
                        {o.label}
                    </FilterChip>
                ))}

                <span className="ml-2 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Flame className="h-3.5 w-3.5" />
                    Priority
                </span>
                <FilterChip active={!priority} onClick={() => push({ priority: "" })}>Any</FilterChip>
                {PRIORITIES.map((p) => (
                    <FilterChip
                        key={p}
                        active={priority === p}
                        onClick={() => push({ priority: priority === p ? "" : p })}
                    >
                        {p.charAt(0) + p.slice(1).toLowerCase()}
                    </FilterChip>
                ))}
            </div>
        </div>
    );
}

function FilterChip({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30",
            )}
        >
            {children}
        </button>
    );
}
