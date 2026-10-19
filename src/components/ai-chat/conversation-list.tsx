"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2, MessageSquare, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type ConversationSummary = {
    id: string;
    title: string | null;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
};

interface Props {
    activeId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    refreshKey: number;
}

export function ConversationList({ activeId, onSelect, onNew, refreshKey }: Props) {
    const [convs, setConvs] = useState<ConversationSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const resp = await fetch("/api/ai/conversations");
                if (resp.ok) {
                    const data = (await resp.json()) as ConversationSummary[];
                    if (!cancelled) setConvs(data);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [refreshKey]);

    const handleDelete = async (id: string) => {
        setDeleting(id);
        try {
            const resp = await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" });
            if (resp.ok) {
                setConvs((prev) => prev.filter((c) => c.id !== id));
                if (activeId === id) onNew();
            }
        } finally {
            setDeleting(null);
        }
    };

    return (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
            <button
                type="button"
                onClick={onNew}
                className="flex w-full items-center gap-2 rounded-lg bg-gradient-to-r from-violet-500/15 to-fuchsia-500/15 border border-violet-500/30 px-3 py-2 text-sm font-medium text-violet-200 hover:from-violet-500/25 hover:to-fuchsia-500/25 transition-colors"
            >
                <Plus className="h-3.5 w-3.5" />
                New chat
            </button>

            {loading && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading…
                </div>
            )}

            {!loading && convs.length === 0 && (
                <p className="px-3 py-4 text-xs text-muted-foreground italic text-center">
                    No past conversations yet.
                </p>
            )}

            {!loading && convs.map((c) => {
                const isActive = c.id === activeId;
                return (
                    <div
                        key={c.id}
                        className={cn(
                            "group relative flex items-center rounded-lg transition-colors",
                            isActive ? "bg-violet-500/15" : "hover:bg-accent",
                        )}
                    >
                        <button
                            type="button"
                            onClick={() => onSelect(c.id)}
                            className={cn(
                                "flex-1 flex items-start gap-2 px-3 py-2 text-left min-w-0",
                                isActive ? "text-violet-200" : "text-foreground",
                            )}
                        >
                            <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">
                                    {c.title || "Untitled chat"}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                    {relativeTime(c.updatedAt)} · {c.messageCount} msg
                                </p>
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(c.id)}
                            disabled={deleting === c.id}
                            className="absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-background text-muted-foreground hover:text-red-500 transition-all"
                            title="Delete conversation"
                            aria-label="Delete conversation"
                        >
                            {deleting === c.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                                <Trash2 className="h-3 w-3" />
                            )}
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

function relativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    const diff = Date.now() - then;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
}
