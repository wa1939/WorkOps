"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Search, CheckSquare, FolderKanban, StickyNote, BarChart3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SearchHit {
    type: "task" | "project" | "note" | "kpi";
    id: string;
    title: string;
    subtitle?: string | null;
    href: string;
}

const typeIcon = {
    task: CheckSquare,
    project: FolderKanban,
    note: StickyNote,
    kpi: BarChart3,
} as const;

const typeLabel = {
    task: "Task",
    project: "Project",
    note: "Note",
    kpi: "KPI",
} as const;

export function GlobalSearch() {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [hits, setHits] = useState<SearchHit[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    // Fetch with debounce
    useEffect(() => {
        if (query.trim().length < 2) {
            setHits([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        const t = setTimeout(async () => {
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
                if (res.ok) {
                    const data = await res.json();
                    setHits(data.hits ?? []);
                    setHighlight(0);
                }
            } finally {
                setLoading(false);
            }
        }, 180);
        return () => clearTimeout(t);
    }, [query]);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    // Cmd+/ focuses the search
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "/") {
                e.preventDefault();
                inputRef.current?.focus();
                setOpen(true);
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, []);

    const navigate = useCallback((href: string) => {
        setOpen(false);
        setQuery("");
        router.push(href);
    }, [router]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!open) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % Math.max(hits.length, 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + Math.max(hits.length, 1)) % Math.max(hits.length, 1));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const hit = hits[highlight];
            if (hit) {
                navigate(hit.href);
            } else if (query.trim()) {
                navigate(`/tasks?search=${encodeURIComponent(query.trim())}`);
            }
        } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
        }
    };

    return (
        <div ref={wrapRef} className="flex-1 max-w-md relative">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    ref={inputRef}
                    type="search"
                    placeholder="Search tasks, projects, notes, KPIs…"
                    className="pl-9 pr-16 bg-muted/50"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={() => setOpen(true)}
                />
                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground/60 border rounded px-1.5 py-0.5 select-none pointer-events-none hidden md:block">
                    ⌘/
                </kbd>
            </div>

            {open && (query.trim().length >= 2) && (
                <div className="absolute left-0 right-0 top-full mt-2 rounded-lg border bg-popover shadow-lg overflow-hidden z-50">
                    {loading && (
                        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                        </div>
                    )}
                    {!loading && hits.length === 0 && (
                        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                            No matches. Press Enter to open the full search results.
                        </div>
                    )}
                    {!loading && hits.length > 0 && (
                        <ul className="max-h-80 overflow-y-auto py-1">
                            {hits.map((h, i) => {
                                const Icon = typeIcon[h.type];
                                return (
                                    <li key={`${h.type}-${h.id}`}>
                                        <Link
                                            href={h.href}
                                            onClick={() => { setOpen(false); setQuery(""); }}
                                            onMouseEnter={() => setHighlight(i)}
                                            className={cn(
                                                "flex items-center gap-3 px-3 py-2 text-sm transition-colors",
                                                i === highlight ? "bg-accent" : "hover:bg-accent/60",
                                            )}
                                        >
                                            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="truncate">{h.title}</div>
                                                {h.subtitle && (
                                                    <div className="text-[11px] text-muted-foreground truncate">{h.subtitle}</div>
                                                )}
                                            </div>
                                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 shrink-0">
                                                {typeLabel[h.type]}
                                            </span>
                                        </Link>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground flex items-center justify-between">
                        <span>
                            <kbd className="border rounded px-1 py-0.5 mr-1">↑</kbd>
                            <kbd className="border rounded px-1 py-0.5 mr-1">↓</kbd>
                            navigate ·
                            <kbd className="border rounded px-1 py-0.5 mx-1">Enter</kbd>
                            open
                        </span>
                        <span>
                            <kbd className="border rounded px-1 py-0.5">Esc</kbd> close
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
