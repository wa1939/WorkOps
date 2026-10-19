"use client";
import React, { FormEvent, useState } from "react";

type SearchItem = { messageId?: string; conversationId?: string; title?: string; excerpt?: string; role?: string; createdAt?: string };
type SearchMeta = { hasMore: boolean; nextCursor: string | null; truncated: boolean };
export type ConversationSearchProps = { endpoint?: string; maxLimit?: number; onJump?: (conversationId: string, messageId: string) => void };
export const safeConversationSegment = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export function ConversationSearch({ endpoint = "/api/ai/conversations/search", maxLimit = 20, onJump }: ConversationSearchProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [meta, setMeta] = useState<SearchMeta>({ hasMore: false, nextCursor: null, truncated: false });
  const [state, setState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const bounded = query.trim().slice(0, 200);
    if (!bounded) return;
    setState("loading");
    try {
      const response = await fetch(`${endpoint}?query=${encodeURIComponent(bounded)}&limit=${Math.min(Math.max(maxLimit, 1), 50)}`);
      if (!response.ok) throw new Error("Search unavailable.");
      const body: unknown = await response.json();
      const object = body && typeof body === "object" ? body as { items?: unknown; hasMore?: unknown; nextCursor?: unknown; truncated?: unknown } : {};
      const next = Array.isArray(object.items) ? object.items.slice(0, 50).filter((item): item is SearchItem => !!item && typeof item === "object") : [];
      setItems(next);
      setMeta({ hasMore: object.hasMore === true, nextCursor: typeof object.nextCursor === "string" ? object.nextCursor.slice(0, 512) : null, truncated: object.truncated === true });
      setState(next.length ? "idle" : "empty");
    } catch { setItems([]); setMeta({ hasMore: false, nextCursor: null, truncated: false }); setState("error"); }
  };
  return <section aria-label="Conversation history search" className="space-y-2">
    <form onSubmit={submit} className="flex gap-2"><label className="sr-only" htmlFor="conversation-search">Search conversation history</label><input id="conversation-search" role="searchbox" value={query} maxLength={200} onChange={(event) => setQuery(event.target.value)} className="min-h-11 flex-1 rounded border px-2 py-1.5 text-sm md:min-h-0" placeholder="Search history" /><button type="submit" disabled={state === "loading"} className="min-h-11 rounded border px-3 py-1.5 text-sm md:min-h-0">Search</button></form>
    {state === "loading" && <p role="status" className="text-xs">Searching…</p>}{state === "error" && <p role="alert" className="text-xs text-destructive">Search unavailable.</p>}{state === "empty" && <p className="text-xs text-muted-foreground">No matching history.</p>}
    {meta.truncated && <p role="status" className="text-xs text-muted-foreground">History results were truncated.</p>}{meta.hasMore && <p role="status" className="text-xs text-muted-foreground">More results available; search again to continue.</p>}
    <ul className="space-y-2">{items.map((item, index) => { const canJump = safeConversationSegment(item.conversationId) && safeConversationSegment(item.messageId); return <li key={`${item.conversationId ?? "conversation"}-${item.messageId ?? index}`} className="rounded border p-2 text-sm">{canJump && onJump ? <button type="button" className="font-medium underline" onClick={() => onJump(item.conversationId!, item.messageId!)}>{(item.title ?? "Conversation").slice(0, 128)}</button> : <span className="font-medium">{canJump ? (item.title ?? "Conversation").slice(0, 128) : "Conversation"}</span>}<p className="max-h-12 overflow-hidden text-xs">{typeof item.excerpt === "string" ? item.excerpt.slice(0, 280) : ""}</p></li>; })}</ul>
  </section>;
}
