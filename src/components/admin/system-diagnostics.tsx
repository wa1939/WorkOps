"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type View = "all" | "logs" | "chats";
type Source = "all" | "diagnostic" | "audit" | "operational" | "workflow";
type Level = "" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL" | "SECURITY";

type DiagnosticLog = {
    id: string;
    source: string;
    category: string;
    level: string;
    message: string;
    correlationId?: string;
    conversationId?: string;
    metadata: unknown;
    createdAt: string;
};

type DiagnosticConversation = {
    id: string;
    title: string | null;
    user?: { id: string; name: string; email: string } | null;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
};

type Page = { limit: number; hasMore: boolean; nextCursor: string | null };
type DiagnosticsPayload = {
    logs: DiagnosticLog[];
    conversations: DiagnosticConversation[];
    pagination: { logs: Page; conversations: Page };
    retention?: { days: number; readFilter: boolean; automaticPurge: boolean; prune: string };
};
type TranscriptMessage = {
    id: string;
    role: string;
    content: string | null;
    toolCalls: unknown;
    truncated: boolean;
    createdAt: string;
};
type TranscriptPayload = {
    conversation: DiagnosticConversation | null;
    messages: TranscriptMessage[];
    pagination: Page;
    redaction?: { applied: boolean; transcriptDuplicatedInLogs: boolean };
};

type DiagnosticsRequestError = Error & { traceId?: string };

const EMPTY_PAYLOAD: DiagnosticsPayload = {
    logs: [],
    conversations: [],
    pagination: {
        logs: { limit: 25, hasMore: false, nextCursor: null },
        conversations: { limit: 25, hasMore: false, nextCursor: null },
    },
};

function errorFromResponse(response: Response, body: unknown, fallback: string): DiagnosticsRequestError {
    const message = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `${fallback} (HTTP ${response.status})`;
    const error = new Error(message) as DiagnosticsRequestError;
    const traceId = response.headers.get("X-Correlation-ID");
    if (traceId) error.traceId = traceId;
    return error;
}

async function requestJson<T>(input: string): Promise<{ data: T; traceId: string | null }> {
    let response: Response;
    try {
        response = await fetch(input, { cache: "no-store" });
    } catch (cause) {
        const message = cause instanceof Error && cause.message.trim() ? cause.message : "Network request failed";
        throw new Error(`Diagnostics request failed: ${message}`);
    }

    let body: unknown = null;
    try {
        body = await response.json();
    } catch {
        if (!response.ok) throw errorFromResponse(response, null, "Diagnostics request failed");
        throw errorFromResponse(response, null, "Diagnostics returned an invalid response");
    }
    if (!response.ok) throw errorFromResponse(response, body, "Diagnostics request failed");
    return { data: body as T, traceId: response.headers.get("X-Correlation-ID") };
}

function displayError(error: unknown): { message: string; traceId?: string } {
    if (error && typeof error === "object") {
        const candidate = error as { message?: unknown; traceId?: unknown };
        return {
            message: typeof candidate.message === "string" && candidate.message.trim() ? candidate.message : "Diagnostics request failed",
            ...(typeof candidate.traceId === "string" && candidate.traceId ? { traceId: candidate.traceId } : {}),
        };
    }
    return { message: "Diagnostics request failed" };
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value || "Unknown time" : date.toLocaleString();
}

function formatMetadata(value: unknown): string {
    if (value === null || value === undefined) return "No metadata";
    try {
        return JSON.stringify(value, null, 2) || "No metadata";
    } catch {
        return "Metadata could not be displayed";
    }
}

function traceLabel(value: string | undefined): string {
    return value ? `Trace ${value}` : "Trace unavailable";
}

export function SystemDiagnostics() {
    const [view, setView] = useState<View>("all");
    const [source, setSource] = useState<Source>("all");
    const [level, setLevel] = useState<Level>("");
    const [category, setCategory] = useState("");
    const [correlationId, setCorrelationId] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [payload, setPayload] = useState<DiagnosticsPayload>(EMPTY_PAYLOAD);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<{ message: string; traceId?: string } | null>(null);
    const [logCursor, setLogCursor] = useState<string | null>(null);
    const [chatCursor, setChatCursor] = useState<string | null>(null);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
    const [transcriptLoading, setTranscriptLoading] = useState(false);
    const [transcriptError, setTranscriptError] = useState<{ message: string; traceId?: string } | null>(null);

    const query = useMemo(() => ({ view, source, level, category, correlationId, from, to }), [view, source, level, category, correlationId, from, to]);

    const loadDiagnostics = useCallback(async (options: { append: boolean; collection?: "logs" | "chats"; logCursor: string | null; chatCursor: string | null }) => {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ view: options.append ? options.collection ?? query.view : query.view, source: query.source, limit: "25" });
        if (query.level) params.set("level", query.level);
        if (query.category.trim()) params.set("category", query.category.trim());
        if (query.correlationId.trim()) params.set("correlationId", query.correlationId.trim());
        if (query.from) params.set("from", query.from);
        if (query.to) params.set("to", query.to);
        if (options.append && options.collection === "logs" && options.logCursor) params.set("logCursor", options.logCursor);
        if (options.append && options.collection === "chats" && options.chatCursor) params.set("chatCursor", options.chatCursor);

        try {
            const result = await requestJson<DiagnosticsPayload>(`/api/admin/diagnostics?${params.toString()}`);
            setPayload((current) => options.append
                ? {
                    ...current,
                    logs: options.collection === "logs" ? [...current.logs, ...result.data.logs] : current.logs,
                    conversations: options.collection === "chats" ? [...current.conversations, ...result.data.conversations] : current.conversations,
                    pagination: {
                        logs: options.collection === "logs" ? result.data.pagination.logs : current.pagination.logs,
                        conversations: options.collection === "chats" ? result.data.pagination.conversations : current.pagination.conversations,
                    },
                }
                : result.data);
            if (!options.append || options.collection === "logs") setLogCursor(result.data.pagination.logs.nextCursor);
            if (!options.append || options.collection === "chats") setChatCursor(result.data.pagination.conversations.nextCursor);
        } catch (cause) {
            setError(displayError(cause));
            if (!options.append) setPayload(EMPTY_PAYLOAD);
        } finally {
            setLoading(false);
        }
    }, [query]);

    useEffect(() => {
        setLogCursor(null);
        setChatCursor(null);
        void loadDiagnostics({ append: false, logCursor: null, chatCursor: null });
    }, [loadDiagnostics]);

    const openTranscript = useCallback(async (conversationId: string) => {
        setSelectedConversationId(conversationId);
        setTranscript(null);
        setTranscriptError(null);
        setTranscriptLoading(true);
        try {
            const result = await requestJson<TranscriptPayload>(`/api/admin/diagnostics/conversations/${encodeURIComponent(conversationId)}?limit=100`);
            setTranscript(result.data);
        } catch (cause) {
            setTranscriptError(displayError(cause));
        } finally {
            setTranscriptLoading(false);
        }
    }, []);

    return (
        <section className="space-y-4" aria-labelledby="system-diagnostics-heading">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 id="system-diagnostics-heading" className="text-xl font-semibold">System diagnostics</h2>
                    <p className="text-sm text-muted-foreground">Bounded system, audit, workflow, AI event, and chat history views. Transcripts are server-redacted.</p>
                </div>
                <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void loadDiagnostics({ append: false, logCursor: null, chatCursor: null })} disabled={loading}>
                    {loading ? "Refreshing…" : "Refresh"}
                </button>
            </div>

            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Diagnostics view">
                {(["all", "logs", "chats"] as const).map((value) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={view === value}
                        className={`rounded-md border px-3 py-2 text-sm ${view === value ? "bg-primary text-primary-foreground" : ""}`}
                        onClick={() => setView(value)}
                    >
                        {value === "all" ? "All" : value === "logs" ? "Events" : "Chats"}
                    </button>
                ))}
            </div>

            <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-3 lg:grid-cols-6">
                <label className="grid gap-1 text-sm">
                    Source
                    <select aria-label="Diagnostics source" className="rounded-md border bg-background px-2 py-2" value={source} onChange={(event) => setSource(event.target.value as Source)}>
                        <option value="all">All sources</option>
                        <option value="diagnostic">System</option>
                        <option value="audit">Audit</option>
                        <option value="operational">AI events</option>
                        <option value="workflow">Workflow</option>
                    </select>
                </label>
                <label className="grid gap-1 text-sm">
                    Level
                    <select aria-label="Diagnostics level" className="rounded-md border bg-background px-2 py-2" value={level} onChange={(event) => setLevel(event.target.value as Level)}>
                        <option value="">All levels</option>
                        {(["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL", "SECURITY"] as const).map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                </label>
                <label className="grid gap-1 text-sm">
                    Category
                    <input aria-label="Diagnostics category" className="rounded-md border bg-background px-2 py-2" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="PROVIDER_ERROR" />
                </label>
                <label className="grid gap-1 text-sm">
                    Trace ID
                    <input aria-label="Diagnostics trace ID" className="rounded-md border bg-background px-2 py-2" value={correlationId} onChange={(event) => setCorrelationId(event.target.value)} placeholder="diag-…" />
                </label>
                <label className="grid gap-1 text-sm">
                    From
                    <input aria-label="Diagnostics from date" type="datetime-local" className="rounded-md border bg-background px-2 py-2" value={from} onChange={(event) => setFrom(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm">
                    To
                    <input aria-label="Diagnostics to date" type="datetime-local" className="rounded-md border bg-background px-2 py-2" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
            </div>

            {error && (
                <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    <strong>Diagnostics error:</strong> {error.message}. {error.traceId ? `trace ${error.traceId}` : "No trace ID was returned."}
                    <button type="button" className="ml-3 underline" onClick={() => void loadDiagnostics({ append: false, logCursor: null, chatCursor: null })}>Retry</button>
                </div>
            )}
            {loading && <p role="status" className="text-sm text-muted-foreground">Loading diagnostics…</p>}

            <div className="grid gap-4 xl:grid-cols-2">
                {view !== "chats" && (
                    <section aria-labelledby="diagnostic-events-heading" className="rounded-lg border">
                        <div className="border-b p-3"><h3 id="diagnostic-events-heading" className="font-semibold">Events</h3><p className="text-xs text-muted-foreground">System, audit, workflow, and AI operational records</p></div>
                        <div className="divide-y">
                            {payload.logs.length === 0 && !loading ? <p className="p-4 text-sm text-muted-foreground">No diagnostic events matched the filters.</p> : payload.logs.map((log) => (
                                <article key={`${log.source}-${log.id}`} className="space-y-1 p-3 text-sm">
                                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{log.category || "Unknown event"}</span><span className="rounded border px-1.5 py-0.5 text-xs">{log.level || "UNKNOWN"}</span><span className="text-xs text-muted-foreground">{log.source}</span></div>
                                    <p>{log.message || "No event message was returned."}</p>
                                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>{formatDate(log.createdAt)}</span><code>{traceLabel(log.correlationId)}</code>{log.conversationId && <code>Conversation {log.conversationId}</code>}</div>
                                    <details><summary className="cursor-pointer text-xs text-muted-foreground">Metadata</summary><pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{formatMetadata(log.metadata)}</pre></details>
                                </article>
                            ))}
                        </div>
                        {payload.pagination.logs.hasMore && <button type="button" className="m-3 rounded-md border px-3 py-2 text-sm" onClick={() => void loadDiagnostics({ append: true, collection: "logs", logCursor, chatCursor: null })} disabled={loading}>Load more events</button>}
                    </section>
                )}

                {view !== "logs" && (
                    <section aria-labelledby="diagnostic-chats-heading" className="rounded-lg border">
                        <div className="border-b p-3"><h3 id="diagnostic-chats-heading" className="font-semibold">Existing chats</h3><p className="text-xs text-muted-foreground">Open a server-redacted transcript for an admin investigation</p></div>
                        <div className="divide-y">
                            {payload.conversations.length === 0 && !loading ? <p className="p-4 text-sm text-muted-foreground">No conversations matched the filters.</p> : payload.conversations.map((conversation) => (
                                <div key={conversation.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                                    <div className="min-w-0"><p className="truncate font-medium">{conversation.title || "Untitled chat"}</p><p className="text-xs text-muted-foreground">{conversation.messageCount} messages · {formatDate(conversation.updatedAt)}</p></div>
                                    <button type="button" className="shrink-0 rounded-md border px-2 py-1 text-xs" aria-label={`Open ${conversation.title || conversation.id}`} onClick={() => void openTranscript(conversation.id)}>Open transcript</button>
                                </div>
                            ))}
                        </div>
                        {payload.pagination.conversations.hasMore && <button type="button" className="m-3 rounded-md border px-3 py-2 text-sm" onClick={() => void loadDiagnostics({ append: true, collection: "chats", logCursor: null, chatCursor })} disabled={loading}>Load more chats</button>}
                    </section>
                )}
            </div>

            {selectedConversationId && (
                <section aria-labelledby="diagnostic-transcript-heading" className="rounded-lg border">
                    <div className="flex flex-wrap items-start justify-between gap-3 border-b p-3"><div><h3 id="diagnostic-transcript-heading" className="font-semibold">Redacted transcript</h3><p className="text-xs text-muted-foreground">Conversation {selectedConversationId}; secret values and tool payloads are filtered by the API.</p></div><button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => { setSelectedConversationId(null); setTranscript(null); }}>Close</button></div>
                    {transcriptLoading && <p role="status" className="p-4 text-sm text-muted-foreground">Loading redacted transcript…</p>}
                    {transcriptError && <div role="alert" className="m-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"><strong>Transcript error:</strong> {transcriptError.message}. {transcriptError.traceId ? `trace ${transcriptError.traceId}` : "No trace ID was returned."}</div>}
                    {transcript && <div className="divide-y"><div className="p-3 text-sm"><span className="font-medium">{transcript.conversation?.title || "Untitled chat"}</span><span className="ml-3 text-xs text-muted-foreground">{transcript.redaction?.applied ? "Server redaction applied" : "Redaction status unavailable"}</span></div>{transcript.messages.length === 0 ? <p className="p-4 text-sm text-muted-foreground">This conversation has no readable messages.</p> : transcript.messages.map((message) => <article key={message.id} className="space-y-1 p-3 text-sm"><div className="flex gap-2 text-xs text-muted-foreground"><span className="font-medium uppercase">{message.role || "unknown"}</span><span>{formatDate(message.createdAt)}</span>{message.truncated && <span>content truncated</span>}</div><p className="whitespace-pre-wrap break-words">{message.content ?? "[No text content]"}</p>{message.toolCalls !== null && message.toolCalls !== undefined && <details><summary className="cursor-pointer text-xs text-muted-foreground">Redacted tool details</summary><pre className="mt-2 max-h-40 overflow-auto rounded bg-muted p-2 text-xs">{formatMetadata(message.toolCalls)}</pre></details>}</article>)}</div>}
                </section>
            )}

            {payload.retention && <p className="text-xs text-muted-foreground">Diagnostic event read window: {payload.retention.days} days; automatic purge: {payload.retention.automaticPurge ? "enabled" : "off"}.</p>}
        </section>
    );
}
