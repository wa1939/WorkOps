"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, MessageSquarePlus, Trash2 } from "lucide-react";
import type { ConversationSummary } from "@/components/ai-chat/conversation-list";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function relativeTime(iso: string): string {
    const parsed = Date.parse(iso);
    if (!Number.isFinite(parsed)) return "";
    const diff = Date.now() - parsed;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    try {
        return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(parsed));
    } catch {
        return "";
    }
}

/**
 * Slim history controls for the Sabah chat surface: start a fresh conversation
 * and browse/reopen/delete previous ones. Complements the free-text history
 * search, which finds messages but cannot list conversations.
 */
export function SabahHistoryBar({
    activeConversationId,
    disabled = false,
    onNewConversation,
    onOpenConversation,
    onDeletedConversation,
}: {
    activeConversationId: string | null;
    disabled?: boolean;
    onNewConversation: () => void;
    onOpenConversation: (conversationId: string) => void;
    onDeletedConversation?: (conversationId: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<ConversationSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);


    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/ai/conversations");
            if (!response.ok) throw new Error("list");
            const body: unknown = await response.json();
            const list = Array.isArray(body)
                ? body.filter((item): item is ConversationSummary => !!item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && SAFE_ID.test((item as { id: unknown }).id as string)).slice(0, 50)
                : [];
            setItems(list);
        } catch {
            setError("History unavailable.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (open) void load();
    }, [open, load]);

    const handleDelete = async (conversationId: string) => {
        if (!SAFE_ID.test(conversationId)) return;
        if (confirmingDeleteId !== conversationId) {
            setConfirmingDeleteId(conversationId);
            return;
        }
        setConfirmingDeleteId(null);
        try {
            const response = await fetch(`/api/ai/conversations/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
            if (!response.ok) throw new Error("delete");
            setItems((prev) => prev.filter((item) => item.id !== conversationId));
            onDeletedConversation?.(conversationId);
        } catch {
            setError("Could not delete that conversation.");
        }
    };

    return (
        <div className="border-b border-border" data-testid="sabah-history-bar">
            <div className="flex items-center gap-1 px-2 py-1.5">
                <button
                    type="button"
                    onClick={onNewConversation}
                    disabled={disabled}
                    aria-label="Start a new conversation"
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
                    New chat
                </button>
                <button
                    type="button"
                    onClick={() => setOpen((value) => !value)}
                    disabled={disabled}
                    aria-expanded={open}
                    aria-label={open ? "Hide conversation history" : "Browse conversation history"}
                    className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                    Chats
                </button>
                {loading && <Loader2 aria-hidden="true" className="h-3 w-3 motion-safe:animate-spin text-muted-foreground" />}
            </div>
            {open && (
                <div role="region" aria-label="Conversation history list" className="max-h-56 overflow-y-auto px-2 pb-2" data-testid="sabah-history-list">
                    {error && <p role="alert" className="px-1 py-1 text-xs text-destructive">{error}</p>}
                    {!loading && !error && items.length === 0 && <p className="px-1 py-1 text-xs text-muted-foreground">No previous chats yet.</p>}
                    <ul className="space-y-1">
                        {items.map((item) => {
                            const active = item.id === activeConversationId;
                            return (
                                <li key={item.id} className={`flex items-center gap-1 rounded-md border px-2 py-1.5 ${active ? "border-primary/40 bg-primary/5" : "border-border/70 bg-card"}`}>
                                    <button
                                        type="button"
                                        onClick={() => onOpenConversation(item.id)}
                                        aria-label={`Open conversation: ${(item.title ?? "Conversation").slice(0, 80)}`}
                                        aria-current={active ? "true" : undefined}
                                        className="min-w-0 flex-1 text-start"
                                    >
                                        <span className="block truncate text-xs font-medium text-foreground">{(item.title ?? "Conversation").slice(0, 80)}</span>
                                        <span className="block text-[10px] text-muted-foreground">
                                            {relativeTime(item.updatedAt)} · {item.messageCount} message{item.messageCount === 1 ? "" : "s"}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleDelete(item.id)}
                                        disabled={disabled}
                                        aria-label={confirmingDeleteId === item.id ? `Confirm delete conversation: ${(item.title ?? "Conversation").slice(0, 60)}` : `Delete conversation: ${(item.title ?? "Conversation").slice(0, 60)}`}
                                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-destructive ${confirmingDeleteId === item.id ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-accent hover:text-destructive"}`}
                                    >
                                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {items.length > 0 && <p className="px-1 pt-1 text-[10px] text-muted-foreground">Tap the bin twice to delete a chat.</p>}
                </div>
            )}
        </div>
    );
}
