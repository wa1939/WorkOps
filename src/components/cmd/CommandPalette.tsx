"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Command } from "cmdk";
import {
    CheckSquare,
    Clock,
    FolderKanban,
    Loader2,
    Search,
    StickyNote,
    Users,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
    COMMAND_ACTIONS,
    filterCommands,
    type CommandDefinition,
    type CommandGroup,
} from "@/lib/cmd/actions";

type PaletteMode = "command" | "search";
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

const RECENTS_STORAGE_KEY = "command-palette-recents";
const MAX_RECENTS = 5;
const COMMAND_GROUPS: readonly CommandGroup[] = [
    "Navigation",
    "Quick actions",
    "Views",
    "Appearance",
];

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

function readRecentCommandIds(): string[] {
    try {
        const raw = window.localStorage.getItem(RECENTS_STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        const ids: string[] = [];
        parsed.forEach((value) => {
            if (typeof value === "string" && !ids.includes(value)) ids.push(value);
        });
        return ids.slice(0, MAX_RECENTS);
    } catch {
        return [];
    }
}

function writeRecentCommandIds(ids: readonly string[]): void {
    try {
        window.localStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(ids));
    } catch {
        // Storage can be unavailable in private browsing; commands still work.
    }
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable
        || target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT";
}

export function CommandPalette({ isAdmin = false }: { isAdmin?: boolean }) {
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<PaletteMode>("command");
    const [query, setQuery] = useState("");
    const [recentIds, setRecentIds] = useState<string[]>([]);
    const [groups, setGroups] = useState<SearchGroup[]>(() => emptyGroups());
    const [loading, setLoading] = useState(false);
    const requestIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    const visibleCommands = useMemo(
        () => COMMAND_ACTIONS.filter((command) => !command.adminOnly || isAdmin),
        [isAdmin],
    );
    const commandsById = useMemo(() => {
        const result = new Map<string, CommandDefinition>();
        visibleCommands.forEach((command) => result.set(command.id, command));
        return result;
    }, [visibleCommands]);
    const isSearchMode = mode === "search" || query.startsWith(">");
    const searchQuery = (query.startsWith(">") ? query.slice(1) : query).trim();
    const filteredCommands = useMemo(
        () => isSearchMode ? [] : filterCommands(visibleCommands, query),
        [isSearchMode, query, visibleCommands],
    );
    const recentCommands = useMemo(() => {
        const commands: CommandDefinition[] = [];
        recentIds.forEach((id) => {
            const command = commandsById.get(id);
            if (command) commands.push(command);
        });
        return filterCommands(commands, query);
    }, [commandsById, query, recentIds]);

    useEffect(() => {
        if (open) setRecentIds(readRecentCommandIds());
    }, [open]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                if (open) {
                    abortRef.current?.abort();
                    setMode("command");
                    setQuery("");
                    setGroups(emptyGroups());
                    setLoading(false);
                }
                setOpen((current) => !current);
                return;
            }

            if (
                event.key === "/"
                && !event.metaKey
                && !event.ctrlKey
                && !event.altKey
                && !isEditableTarget(event.target)
            ) {
                event.preventDefault();
                setOpen(true);
                setMode("command");
                setQuery("");
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open]);

    useEffect(() => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        abortRef.current?.abort();

        if (!open || !isSearchMode || searchQuery.length < 2) {
            setGroups(emptyGroups());
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        const timeoutId = window.setTimeout(async () => {
            try {
                const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`, {
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
    }, [isSearchMode, open, searchQuery]);

    const close = useCallback(() => {
        abortRef.current?.abort();
        setOpen(false);
        setMode("command");
        setQuery("");
        setGroups(emptyGroups());
        setLoading(false);
    }, []);

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        if (nextOpen) {
            setOpen(true);
            return;
        }
        close();
    }, [close]);

    const rememberCommand = useCallback((id: string) => {
        setRecentIds((current) => {
            const next = [id].concat(current.filter((currentId) => currentId !== id)).slice(0, MAX_RECENTS);
            writeRecentCommandIds(next);
            return next;
        });
    }, []);

    const navigateToCommand = useCallback((command: CommandDefinition) => {
        rememberCommand(command.id);
        close();
        if (command.action === "toggle-theme") {
            setTheme(theme === "dark" ? "light" : "dark");
            return;
        }
        if (command.href) router.push(command.href);
    }, [close, rememberCommand, router, setTheme, theme]);

    const selectSearchHit = useCallback((hit: SearchHit) => {
        close();
        router.push(hit.href);
    }, [close, router]);

    const handleQueryChange = useCallback((nextQuery: string) => {
        setQuery(nextQuery);
        if (nextQuery.startsWith(">")) setMode("search");
    }, []);

    const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        if (mode === "search" && event.shiftKey) {
            setMode("command");
            setQuery("");
            return;
        }
        if (mode === "command") {
            setMode("search");
            if (query.startsWith(">")) setQuery(query.slice(1).trimStart());
        }
    }, [mode, query]);

    return (
        <Command.Dialog
            open={open}
            onOpenChange={handleOpenChange}
            label="Command palette"
            shouldFilter={false}
            overlayClassName="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            contentClassName="fixed left-1/2 top-[15vh] z-50 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-2xl"
        >
            <div className="flex items-center gap-3 border-b px-4">
                <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
                <Command.Input
                    value={query}
                    onValueChange={handleQueryChange}
                    onKeyDown={handleInputKeyDown}
                    placeholder={isSearchMode ? "Search tasks, projects, people, and notes..." : "Type a command..."}
                    className="h-14 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    autoFocus
                />
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="relative h-8 w-8 shrink-0 after:absolute after:inset-[-6px] after:content-['']"
                    onClick={close}
                    aria-label="Close command palette"
                >
                    <X className="h-4 w-4" />
                </Button>
            </div>

            <Command.List label={isSearchMode ? "Global search results" : "Commands"} className="max-h-[min(60vh,30rem)] overflow-y-auto p-2">
                {isSearchMode ? (
                    <>
                        {loading && (
                            <Command.Loading className="flex items-center gap-2 px-3 py-5 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 motion-safe:animate-spin motion-reduce:animate-none motion-reduce:opacity-60" />
                                Searching...
                            </Command.Loading>
                        )}
                        {!loading && searchQuery.length === 0 && (
                            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                Search across your tasks, projects, people, and notes.
                            </div>
                        )}
                        {!loading && searchQuery.length === 1 && (
                            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                                Type at least 2 characters to search.
                            </div>
                        )}
                        {!loading && searchQuery.length >= 2 && !groups.some((group) => group.results.length > 0) && (
                            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                                No results found.
                            </Command.Empty>
                        )}
                        {!loading && groups.some((group) => group.results.length > 0) && groups.map((group) => {
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
                                            onSelect={() => selectSearchHit(hit)}
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
                    </>
                ) : (
                    <>
                        {recentCommands.length > 0 && (
                            <>
                                <Command.Group heading="Recent" className="py-1">
                                    {recentCommands.map((command) => {
                                        const Icon = command.icon;
                                        return (
                                            <Command.Item
                                                key={`recent-${command.id}`}
                                                value={`recent-${command.id} ${command.label}`}
                                                onSelect={() => navigateToCommand(command)}
                                                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm aria-selected:bg-accent"
                                            >
                                                {Icon ? <Icon className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                                                <span className="text-xs text-muted-foreground">Recent</span>
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                                <Command.Separator className="my-1 h-px bg-border" />
                            </>
                        )}

                        {COMMAND_GROUPS.map((group) => {
                            const commands = filteredCommands.filter((command) => command.group === group);
                            if (commands.length === 0) return null;
                            return (
                                <Command.Group key={group} heading={group} className="py-1">
                                    {commands.map((command) => {
                                        const Icon = command.icon;
                                        return (
                                            <Command.Item
                                                key={command.id}
                                                value={`${command.label} ${command.description ?? ""}`}
                                                keywords={command.keywords ? Array.from(command.keywords) : []}
                                                onSelect={() => navigateToCommand(command)}
                                                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm aria-selected:bg-accent"
                                            >
                                                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate">{command.label}</span>
                                                    {command.description && (
                                                        <span className="block truncate text-xs text-muted-foreground">{command.description}</span>
                                                    )}
                                                </span>
                                                {command.href && <span className="text-xs text-muted-foreground">↵</span>}
                                            </Command.Item>
                                        );
                                    })}
                                </Command.Group>
                            );
                        })}
                        {filteredCommands.length === 0 && recentCommands.length === 0 && (
                            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
                                No commands found.
                            </Command.Empty>
                        )}
                    </>
                )}
            </Command.List>

            <div className="flex flex-wrap items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground">
                <span><kbd className="rounded border px-1">↑</kbd> <kbd className="rounded border px-1">↓</kbd> navigate</span>
                <span><kbd className="rounded border px-1">Enter</kbd> select</span>
                <span><kbd className="rounded border px-1">Tab</kbd> search</span>
                <span><kbd className="rounded border px-1">Esc</kbd> close</span>
            </div>
        </Command.Dialog>
    );
}
