import { workflowSnapshotSchema, type WorkflowSnapshot, type WorkflowDecision } from "@/lib/sabah/workflows/schemas";
import type { SabahPageContext } from "./forms/contracts";
import { MAX_WORKFLOW_SNAPSHOTS } from "./state/sabah-reducer";

export class SabahClientError extends Error {
    readonly status: number;
    readonly correlationId: string | null;

    constructor(message: string, status: number, correlationId: string | null) {
        super(message);
        this.name = "SabahClientError";
        this.status = status;
        this.correlationId = correlationId;
    }
}

export class SabahAbortedError extends Error {
    constructor() {
        super("Request aborted");
        this.name = "SabahAbortedError";
    }
}

type RequestOptions = { signal?: AbortSignal };
type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

export type SabahChatStreamEvent =
    | { type: "conversation"; id: string }
    | { type: "token"; delta: string }
    | { type: "tool_start"; id: string; name: string }
    | { type: "tool_result"; id: string; name: string; params: unknown; result: { ok: true; data: unknown } | { ok: false; error: string } }
    | { type: "limit"; reason: "iterations" | "tool_calls" | "context" }
    | { type: "compression"; status: "pending" | "compressionSchedulerUnavailable" }
    | { type: "done" };

export type SendMessageOptions = RequestOptions & {
    history?: ChatHistoryMessage[];
    pageContext?: SabahPageContext | null;
    approvedWorkflowId?: string | null;
    onEvent?: (event: SabahChatStreamEvent) => void;
};

async function requestJson<T>(
    input: string,
    init: RequestInit & { signal?: AbortSignal },
    parse: (data: unknown) => { success: true; data: T } | { success: false }
): Promise<T> {
    const aborted = (error: unknown): boolean =>
        init.signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
    let response: Response;
    try {
        response = await fetch(input, init);
    } catch (error) {
        if (aborted(error)) {
            throw new SabahAbortedError();
        }
        throw new SabahClientError(error instanceof Error ? error.message : "Network error", 0, null);
    }
    if (!response.ok) {
        const correlationId = response.headers.get("x-correlation-id");
        let message = `Request failed with status ${response.status}`;
        try {
            const body = (await response.json()) as { error?: string; message?: string };
            if (body?.error) {
                message = body.error;
            } else if (body?.message) {
                message = body.message;
            }
        } catch (error) {
            if (aborted(error)) throw new SabahAbortedError();
            // non-JSON error body — keep the status-based message
        }
        throw new SabahClientError(message, response.status, correlationId);
    }
    let data: unknown;
    try {
        data = await response.json();
    } catch (error) {
        if (aborted(error)) throw new SabahAbortedError();
        throw new SabahClientError("Response was not valid JSON", response.status, response.headers.get("x-correlation-id"));
    }
    const parsed = parse(data);
    if (!parsed.success) {
        throw new SabahClientError("Response failed schema validation", response.status, response.headers.get("x-correlation-id"));
    }
    return parsed.data;
}

function zodParse<T>(schema: { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }) {
    return (data: unknown) => schema.safeParse(data);
}

import { z } from "zod";

const workflowListResponseSchema = z.object({
    workflows: z.array(workflowSnapshotSchema).max(MAX_WORKFLOW_SNAPSHOTS),
});

const MAX_CHAT_REPLY = 64 * 1024;
/** Bound on a SINGLE unterminated SSE frame, not the whole stream. */
const MAX_CHAT_FRAME = 256 * 1024;
const utf8Encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
    return utf8Encoder.encode(value).byteLength;
}

function nextSseBoundary(value: string): { index: number; length: number } | null {
    const match = /\n\n|\r\n\r\n|\r\r/.exec(value);
    return match ? { index: match.index, length: match[0].length } : null;
}

async function chatError(response: Response): Promise<SabahClientError> {
    let message = `Request failed with status ${response.status}`;
    try {
        const body: unknown = await response.json();
        if (body && typeof body === "object") {
            const record = Object.fromEntries(Object.entries(body));
            if (typeof record.error === "string") message = record.error;
        }
    } catch { /* keep the status-based message */ }
    return new SabahClientError(message, response.status, response.headers.get("x-correlation-id"));
}

async function sendChatMessage(baseUrl: string, conversationId: string | null, content: string, options?: SendMessageOptions): Promise<{ conversationId: string | null; reply: string }> {
    let response: Response;
    try {
        response = await fetch(`${baseUrl}/chat`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message: content, history: options?.history?.slice(-12), conversationId: conversationId ?? undefined, approvedWorkflowId: options?.approvedWorkflowId ?? undefined, pageContext: options?.pageContext ?? undefined }),
            signal: options?.signal,
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw new SabahAbortedError();
        throw new SabahClientError(error instanceof Error ? error.message : "Network error", 0, null);
    }
    if (!response.ok) throw await chatError(response);
    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new SabahClientError("Response stream unavailable", response.status, response.headers.get("x-correlation-id"));

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let readerCanceled = false;
    let readerCancelPromise: Promise<void> | null = null;
    const cancelReader = () => {
        if (readerCanceled) return;
        readerCanceled = true;
        readerCancelPromise = reader.cancel().catch(() => undefined);
    };
    const abortListener = () => cancelReader();
    let listenerAttached = false;
    if (options?.signal && !options.signal.aborted) {
        options.signal.addEventListener("abort", abortListener, { once: true });
        listenerAttached = true;
    }
    let buffer = "";
    let reply = "";
    let activeConversationId: string | null = null;
    const correlationId = response.headers.get("x-correlation-id");
    const malformed = (): never => { throw new SabahClientError("Malformed response stream", response.status, correlationId); };
    const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
    const hasExactKeys = (event: Record<string, unknown>, keys: string[]): boolean => {
        const actual = Object.keys(event).sort();
        return actual.length === keys.length && actual.every((key, index) => key === keys.slice().sort()[index]);
    };
    const boundedPayload = (value: unknown): boolean => {
        try {
            const serialized = JSON.stringify(value);
            return typeof serialized === "string" && utf8ByteLength(serialized) <= MAX_CHAT_FRAME;
        } catch { return false; }
    };
    const validToolResult = (value: unknown): value is { ok: true; data: unknown } | { ok: false; error: string } => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return false;
        const record = value as Record<string, unknown>;
        if (record.ok === true) return Object.keys(record).length === 2 && "data" in record && boundedPayload(record.data);
        return record.ok === false && Object.keys(record).length === 2 && boundedString(record.error, 512) && record.error.trim().length > 0;
    };
    const consume = (frame: string): void => {
        if (utf8ByteLength(frame) > MAX_CHAT_FRAME) throw new SabahClientError("Response frame exceeded bounds", response.status, correlationId);
        if (options?.signal?.aborted) throw new SabahAbortedError();
        const dataFrame = frame.trim();
        if (!dataFrame.startsWith("data:")) return;
        let value: unknown;
        try { value = JSON.parse(dataFrame.slice(5).trim()); } catch { malformed(); }
        if (!value || typeof value !== "object" || Array.isArray(value)) malformed();
        const event = value as Record<string, unknown>;
        let validated: SabahChatStreamEvent | null = null;
        if (event.type === "conversation" && hasExactKeys(event, ["type", "id"]) && boundedString(event.id, 128) && /^[A-Za-z0-9_-]{1,128}$/.test(event.id)) {
            activeConversationId = event.id;
            validated = { type: "conversation", id: event.id };
        } else if (event.type === "token" && hasExactKeys(event, ["type", "delta"]) && typeof event.delta === "string") {
            if (utf8ByteLength(reply) + utf8ByteLength(event.delta) > MAX_CHAT_REPLY) throw new SabahClientError("Response exceeded bounds", response.status, correlationId);
            reply += event.delta;
            validated = { type: "token", delta: event.delta };
        } else if (event.type === "tool_start" && hasExactKeys(event, ["type", "id", "name"]) && boundedString(event.id, 128) && /^[A-Za-z0-9_-]{1,128}$/.test(event.id) && boundedString(event.name, 128) && event.name.trim().length > 0) {
            validated = { type: "tool_start", id: event.id, name: event.name };
        } else if (event.type === "tool_result" && hasExactKeys(event, ["type", "id", "name", "params", "result"]) && boundedString(event.id, 128) && /^[A-Za-z0-9_-]{1,128}$/.test(event.id) && boundedString(event.name, 128) && event.name.trim().length > 0 && boundedPayload(event.params) && validToolResult(event.result)) {
            validated = { type: "tool_result", id: event.id, name: event.name, params: event.params, result: event.result };
        } else if (event.type === "limit" && hasExactKeys(event, ["type", "reason"]) && (event.reason === "iterations" || event.reason === "tool_calls" || event.reason === "context")) {
            validated = { type: "limit", reason: event.reason };
        } else if (event.type === "compression" && hasExactKeys(event, ["type", "status"]) && (event.status === "pending" || event.status === "compressionSchedulerUnavailable")) {
            validated = { type: "compression", status: event.status };
        } else if (event.type === "done" && hasExactKeys(event, ["type"])) {
            validated = { type: "done" };
        } else if (event.type === "error" && hasExactKeys(event, ["type", "message"]) && boundedString(event.message, 512) && event.message.trim().length > 0) {
            throw new SabahClientError(event.message, response.status, correlationId);
        } else {
            malformed();
        }
        const eventToEmit = validated;
        if (!eventToEmit) malformed();
        if (eventToEmit !== null) options?.onEvent?.(eventToEmit);
    };
    let completedNormally = false;
    try {
        if (options?.signal?.aborted) throw new SabahAbortedError();
        for (;;) {
            const next = await reader.read();
            if (options?.signal?.aborted) throw new SabahAbortedError();
            if (next.done) break;
            buffer += next.value;
            let boundary: { index: number; length: number } | null;
            while ((boundary = nextSseBoundary(buffer)) !== null) {
                consume(buffer.slice(0, boundary.index + boundary.length));
                buffer = buffer.slice(boundary.index + boundary.length);
                if (options?.signal?.aborted) throw new SabahAbortedError();
            }
            // Only the remaining unterminated partial frame is bounded, so
            // many small frames (or one large terminated frame) stream fine.
            if (utf8ByteLength(buffer) > MAX_CHAT_FRAME) throw new SabahClientError("Response frame exceeded bounds", response.status, response.headers.get("x-correlation-id"));
        }
        if (buffer.trim()) consume(buffer.trim());
        completedNormally = true;
    } catch (error) {
        if (error instanceof SabahClientError || error instanceof SabahAbortedError) throw error;
        if (error instanceof DOMException && error.name === "AbortError") throw new SabahAbortedError();
        throw new SabahClientError(error instanceof Error ? error.message : "Response stream failed", response.status, response.headers.get("x-correlation-id"));
    } finally {
        if (!completedNormally) {
            if (readerCancelPromise) await readerCancelPromise;
            else {
                try { await reader.cancel(); } catch { /* preserve the original stream error */ }
            }
            readerCanceled = true;
        }
        if (options?.signal && listenerAttached) {
            options.signal.removeEventListener("abort", abortListener);
        }
        reader.releaseLock();
    }
    // The server treats conversation persistence as best-effort; a reply with
    // no conversation event is still a valid reply.
    return { conversationId: activeConversationId, reply };
}

export type SabahClient = {
    sendMessage(conversationId: string | null, content: string, options?: SendMessageOptions): Promise<{ conversationId: string | null; reply: string }>;
    getWorkflow(workflowId: string, options?: RequestOptions): Promise<WorkflowSnapshot>;
    listWorkflows(conversationId: string, options?: RequestOptions): Promise<WorkflowSnapshot[]>;
    submitDecision(workflowId: string, decision: WorkflowDecision, options?: RequestOptions): Promise<WorkflowSnapshot>;
    executeWorkflow(workflowId: string, options?: RequestOptions): Promise<WorkflowSnapshot>;
    stopWorkflow(workflowId: string, options?: RequestOptions): Promise<WorkflowSnapshot>;
    subscribeConversation(conversationId: string, onEvent: (event: unknown) => void, options?: RequestOptions): () => void;
};

export function createSabahClient(baseUrl = "/api/ai"): SabahClient {
    return {
        async sendMessage(conversationId, content, options) {
            return sendChatMessage(baseUrl, conversationId, content, options);
        },
        getWorkflow(workflowId, options) {
            return requestJson(`${baseUrl}/workflows/${workflowId}`, { signal: options?.signal }, zodParse(workflowSnapshotSchema));
        },
        async listWorkflows(conversationId, options) {
            const query = new URLSearchParams({ conversationId, limit: String(MAX_WORKFLOW_SNAPSHOTS) });
            const result = await requestJson(`${baseUrl}/workflows?${query.toString()}`, { method: "GET", signal: options?.signal }, zodParse(workflowListResponseSchema));
            return result.workflows.slice(0, MAX_WORKFLOW_SNAPSHOTS);
        },
        submitDecision(workflowId, decision, options) {
            return requestJson(
                `${baseUrl}/workflows/${workflowId}/decision`,
                {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(decision),
                    signal: options?.signal,
                },
                zodParse(workflowSnapshotSchema)
            );
        },
        executeWorkflow(workflowId, options) {
            return requestJson(`${baseUrl}/workflows/${workflowId}/execute`, { method: "POST", signal: options?.signal }, zodParse(workflowSnapshotSchema));
        },
        stopWorkflow(workflowId, options) {
            return requestJson(`${baseUrl}/workflows/${workflowId}/stop`, { method: "POST", signal: options?.signal }, zodParse(workflowSnapshotSchema));
        },
        subscribeConversation(conversationId, onEvent, options) {
            const controller = new AbortController();
            let reader: ReadableStreamDefaultReader<string> | null = null;
            let completedNormally = false;
            let readerCanceled = false;
            let cancelPromise: Promise<void> | null = null;
            const cancelReader = (): Promise<void> => {
                if (completedNormally || readerCanceled || !reader) return cancelPromise ?? Promise.resolve();
                readerCanceled = true;
                cancelPromise = reader.cancel().catch(() => undefined);
                return cancelPromise;
            };
            const abortSubscription = () => {
                controller.abort();
                void cancelReader();
            };
            if (options?.signal?.aborted) {
                abortSubscription();
            } else {
                options?.signal?.addEventListener("abort", abortSubscription, { once: true });
            }
            (async () => {
                try {
                    const response = await fetch(`${baseUrl}/conversations/${conversationId}/stream`, { signal: controller.signal });
                    if (!response.ok || !response.body) {
                        onEvent({ type: "error", status: response.status });
                        completedNormally = true;
                        return;
                    }
                    reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                    if (controller.signal.aborted) {
                        await cancelReader();
                        throw new Error("subscription aborted");
                    }
                    let buffer = "";
                    const assertFrameBound = (frame: string) => {
                        if (utf8ByteLength(frame) > MAX_CHAT_FRAME) throw new Error("subscription frame exceeded bounds");
                    };
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += value;
                        let boundary: { index: number; length: number } | null;
                        while ((boundary = nextSseBoundary(buffer)) !== null) {
                            const frame = buffer.slice(0, boundary.index + boundary.length);
                            assertFrameBound(frame);
                            buffer = buffer.slice(boundary.index + boundary.length);
                            const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
                            if (!dataLine) continue;
                            let parsed: unknown;
                            try { parsed = JSON.parse(dataLine.slice(5).trim()); } catch { throw new Error("malformed subscription frame"); }
                            onEvent(parsed);
                        }
                        if (utf8ByteLength(buffer) > MAX_CHAT_FRAME) throw new Error("subscription frame exceeded bounds");
                    }
                    if (buffer.trim()) {
                        if (utf8ByteLength(buffer) > MAX_CHAT_FRAME) throw new Error("subscription frame exceeded bounds");
                        throw new Error("malformed subscription frame");
                    }
                    completedNormally = true;
                } catch {
                    // stream ended or aborted — nothing further to emit
                } finally {
                    if (reader) {
                        if (!completedNormally) await cancelReader();
                        reader.releaseLock();
                        reader = null;
                    }
                    options?.signal?.removeEventListener("abort", abortSubscription);
                }
            })();
            return abortSubscription;
        },
    };
}

