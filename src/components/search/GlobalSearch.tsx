"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
    CheckSquare,
    FolderKanban,
    Loader2,
    Search,
    StickyNote,
    Users,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SearchEntityType = "task" | "project" | "member" | "note";

type SearchHit = {
    type: SearchEntityType;
    id: string;
    title: string;
    subtitle?: string | null;
    href: string;
};

type SearchGroup = {
    type: SearchEntityType;
    label: string;
    results: SearchHit[];
};

type SearchResponse = {
    groups?: SearchGroup[];
};

const groupIcons: Record<SearchEntityType, typeof Search> = {
    task: CheckSquare,
    project: FolderKanban,
    member: Users,
    note: StickyNote,
};

function emptyGroups(): SearchGroup[] {
    return [
        { type: "task", label: "Tasks", results: [] },
        { type: "project", label: "Projects", results: [] },
        { type: "member", label: "People", results: [] },
        { type: "note", label: "Notes", results: [] },
    ];
}

export function GlobalSearch({ collapsed = false }: { collapsed?: boolean }) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [groups, setGroups] = useState<SearchGroup[]>(() => emptyGroups());
    const [loading, setLoading] = useState(false);
    const requestIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const trimmedQuery = query.trim();
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        abortRef.current?.abort();

        if (!open || trimmedQuery.length < 2) {
            setGroups(emptyGroups());
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        const timeoutId = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`, {
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error(`Search failed with status ${response.status}`);
                const data = (await response.json()) as SearchResponse;
                if (controller.signal.aborted || requestId !== requestIdRef.current) return;
                setGroups(Array.isArray(data.groups) ? data.groups : emptyGroups());
            } catch (error) {
                if (controller.signal.aborted || requestId !== requestIdRef.current) return;
                if (error instanceof Error && error.name === "AbortError") return;
                setGroups(emptyGroups());
            } finally {
                if (!controller.signal.aborted && requestId === requestIdRef.current) {
                    setLoading(false);
                }
            }
        }, 300);

        return () => {
            window.clearTimeout(timeoutId);
            controller.abort();
            if (abortRef.current === controller) abortRef.current = null;
        };
    }, [open, query]);

    const close = useCallback(() => {
        setOpen(false);
        setQuery("");
        setGroups(emptyGroups());
    }, []);

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        if (nextOpen) {
            setOpen(true);
            return;
        }
        close();
    }, [close]);

    const selectHit = useCallback((hit: SearchHit) => {
        close();
        router.push(hit.href);
    }, [close, router]);

    const hasResults = groups.some((group) => group.results.length > 0);
    const trimmedQuery = query.trim();

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size={collapsed ? "icon" : "sm"}
                className={cn(
                    "shrink-0 text-muted-foreground hover:text-foreground",
                    collapsed ? "relative h-8 w-8 after:absolute after:inset-[-6px] after:content-['']" : "flex-1 justify-start gap-2",
                )}
                onClick={() => setOpen(true)}
                aria-label="Search"
                title="Search"
            >
                <Search className="h-4 w-4" />
                {!collapsed && <span>Search</span>}
            </Button>

            <Command.Dialog
                open={open}
                onOpenChange={handleOpenChange}
                label="Global search"
                shouldFilter={false}
                overlayClassName="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
                contentClassName="fixed left-1/2 top-[15vh] z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl"
            >
                <div className="flex items-center gap-3 border-b px-4">
                    <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <Command.Input
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search tasks, projects, people, and notes..."
                        className="h-14 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        autoFocus
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="relative h-8 w-8 shrink-0 after:absolute after:inset-[-6px] after:content-['']"
                        onClick={close}
                        aria-label="Close search"
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>

                <Command.List label="Search results" className="max-h-[min(60vh,30rem)] overflow-y-auto p-2">
                    {loading && (
                        <Command.Loading className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Searching...
                        </Command.Loading>
                    )}

                    {!loading && trimmedQuery.length === 0 && (
                        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                            Search across your tasks, projects, people, and notes.
                        </div>
                    )}

                    {!loading && trimmedQuery.length === 1 && (
                        <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                            Type at least 2 characters to search.
                        </div>
                    )}

                    {!loading && trimmedQuery.length >= 2 && !hasResults && (
                        <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                            No results found.
                        </Command.Empty>
                    )}

                    {!loading && hasResults && groups.map((group) => {
                        if (group.results.length === 0) return null;
                        const Icon = groupIcons[group.type];
                        return (
                            <Command.Group
                                key={group.type}
                                value={group.type}
                                heading={<span className="px-2 text-xs font-medium text-muted-foreground">{group.label}</span>}
                                className="py-1"
                            >
                                {group.results.map((hit) => (
                                    <Command.Item
                                        key={`${hit.type}-${hit.id}`}
                                        value={`${hit.title} ${hit.subtitle ?? ""}`}
                                        keywords={[hit.title, hit.subtitle ?? ""]}
                                        onSelect={() => selectHit(hit)}
                                        className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm aria-selected:bg-accent"
                                    >
                                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate">{hit.title}</span>
                                            {hit.subtitle && (
                                                <span className="block truncate text-xs text-muted-foreground">{hit.subtitle}</span>
                                            )}
                                        </span>
                                    </Command.Item>
                                ))}
                            </Command.Group>
                        );
                    })}
                </Command.List>

                <div className="flex items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
                    <span><kbd className="rounded border px-1">↑</kbd> <kbd className="rounded border px-1">↓</kbd> navigate</span>
                    <span><kbd className="rounded border px-1">Enter</kbd> select</span>
                    <span><kbd className="rounded border px-1">Esc</kbd> close</span>
                </div>
            </Command.Dialog>
        </>
    );
}
