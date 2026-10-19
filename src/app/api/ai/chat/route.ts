import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { callGLMStream, type AiProvider, type GLMMessage, type GLMModel, type GLMToolCall, type GLMDiagnosticEvent } from "@/lib/glm";
import { resolveModelForRole, getConfiguredFallbacks } from "@/lib/sabah/providers/roles";
import { buildOperationalAiTarget, DEFAULT_OPERATIONAL_MODEL } from "@/lib/ai/provider-resolution";
import { resolveRuntimeProviderCredentials, type RuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";
import { AI_TOOLS } from "@/lib/ai/tools";
import { runTool, type ExecutorContext } from "@/lib/ai/executors";
import { verifiedToolResultOmission } from "@/lib/ai/verified-links";
import { buildSystemPrompt, formatUntrustedPageContext } from "@/lib/ai/system-prompt";
import { stampCurrentDate } from "@/lib/ai/date-stamp";
import { compressConversation } from "@/lib/sabah/continuity/compression";
import { toSabahActor, SabahForbiddenError, type SabahActor } from "@/lib/sabah/auth/actor";
import {
    checkRateLimit,
    MAX_LOOP_ITERATIONS,
    MAX_TOOL_CALLS_PER_MESSAGE,
    MAX_CONTEXT_CHARS,
} from "@/lib/ai/rate-limit";
import { createDiagnosticCorrelationId } from "@/lib/diagnostics/admin";
import { recordDiagnostic, redactDiagnosticText } from "@/lib/diagnostics";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** Bounded server-side transcript rebuild for owned conversations. */
const MAX_PERSISTED_HISTORY = 20;
const MAX_REPLY_CHARS = 64 * 1024;
const MAX_FRAME_BYTES = 256 * 1024;
/** Persisted tool-call JSON is bounded independently of individual SSE frames. */
const MAX_PERSISTED_TOOL_CALL_BYTES = 256 * 1024;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

function utf8Prefix(value: string, maxBytes: number): string {
    if (utf8ByteLength(value) <= maxBytes) return value;
    let end = Math.min(value.length, maxBytes);
    while (end > 0 && utf8ByteLength(value.slice(0, end)) > maxBytes) end -= 1;
    if (end > 0 && end < value.length && /[\uD800-\uDBFF]/.test(value[end - 1] ?? "") && /[\uDC00-\uDFFF]/.test(value[end] ?? "")) end -= 1;
    return value.slice(0, end);
}

// Client-supplied history may only contain plain user/assistant text. Tool and
// system roles, tool_calls, and tool_call_id are rejected so forged transcripts
// cannot steer tool execution (see prompt-injection hardening).
const chatMessageSchema = z
    .object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(12_000),
    })
    .strict();

const pageContextSchema = z.object({
    formId: z.string().min(1).max(120),
    entityType: z.string().min(1).max(80),
    entityId: z.string().max(200).nullable(),
    recordVersion: z.string().max(200).nullable(),
    fields: z.record(z.object({ value: z.string().max(2000) }).strict()).superRefine((fields, ctx) => {
        if (Object.keys(fields).length > 32) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Too many page context fields" });
        const sensitive = /(?:password|passcode|token|secret|credential|api[-_]?key|private[-_]?key|authorization|auth)/i;
        for (const name of Object.keys(fields)) {
            if (name.length > 80 || sensitive.test(name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: "Sensitive page context field is not allowed" });
        }
    }),
}).strict();

const requestSchema = z.object({
    message: z.string().min(1).max(4000),
    history: z.array(chatMessageSchema).max(20).optional(),
    conversationId: z.string().optional(),
    /** Reference only; executors revalidate ownership, exact args, and approval server-side. */
    approvedWorkflowId: z.string().regex(SAFE_ID).optional(),
    pageContext: pageContextSchema.optional(),
});

export type ChatToolCall = {
    name: string;
    params: unknown;
    result: { ok: true; data: unknown } | { ok: false; error: string };
};

export type ChatStreamEvent =
    | { type: "conversation"; id: string }
    | { type: "token"; delta: string }
    | { type: "tool_start"; id: string; name: string }
    | { type: "tool_result"; id: string; name: string; params: unknown; result: ChatToolCall["result"] }
    | { type: "limit"; reason: "iterations" | "tool_calls" | "context" }
    | { type: "compression"; status: "pending" | "compressionSchedulerUnavailable" }
    | { type: "error"; message: string }
    | { type: "done" };

function contextSize(messages: GLMMessage[]): number {
    return messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
}

type CompressionScheduler = (conversationId: string, actor: SabahActor) => Promise<"pending" | "compressionSchedulerUnavailable">;
const activeCompressionJobs = new Set<string>();
function trimForContext(messages: GLMMessage[]): void {
    if (contextSize(messages) <= MAX_CONTEXT_CHARS) return;
    const systemMessage = messages[0]?.role === "system" ? messages[0] : undefined;
    const currentUserIndex = messages.reduce((index, message, candidate) => message.role === "user" ? candidate : index, -1);
    const currentUser = currentUserIndex >= 0 ? messages[currentUserIndex] : undefined;
    const currentLength = currentUser?.content?.length ?? 0;
    const systemBudget = Math.max(0, MAX_CONTEXT_CHARS - currentLength);
    const system = systemMessage ? { ...systemMessage, content: systemMessage.content?.slice(0, systemBudget) ?? null } : undefined;
    let remaining = Math.max(0, MAX_CONTEXT_CHARS - (system?.content?.length ?? 0) - currentLength);
    const suffix = currentUserIndex >= 0 ? messages.slice(currentUserIndex + 1) : [];
    const units: GLMMessage[][] = [];
    for (let i = 0; i < suffix.length;) {
        const message = suffix[i];
        if (message.role === "assistant" && message.tool_calls?.length) {
            const ids = new Set(message.tool_calls.map(call => call.id));
            const group = [message];
            let j = i + 1;
            while (j < suffix.length && ids.size) {
                const candidate = suffix[j];
                if (candidate.role === "tool" && candidate.tool_call_id && ids.has(candidate.tool_call_id)) {
                    group.push(candidate);
                    ids.delete(candidate.tool_call_id);
                } else if (candidate.role === "assistant" || candidate.role === "user") break;
                j += 1;
            }
            if (ids.size === 0) units.push(group);
            i = j;
        } else if (message.role !== "tool") {
            units.push([message]);
            i += 1;
        } else {
            i += 1;
        }
    }
    const selected: GLMMessage[][] = [];
    for (let i = units.length - 1; i >= 0; i -= 1) {
        const unit = units[i];
        const size = contextSize(unit);
        if (size <= remaining) { selected.unshift(unit); remaining -= size; }
    }
    messages.splice(0, messages.length, ...(system ? [system] : []), ...(currentUser ? [currentUser] : []), ...selected.flat());
}

/** Plan 8 durable queue remains deferred; this is a best-effort in-process seam. */
const requestBackgroundCompression: CompressionScheduler = async (conversationId, actor) => {
    if (activeCompressionJobs.has(conversationId)) return "pending";
    activeCompressionJobs.add(conversationId);
    void Promise.resolve().then(() => compressConversation(conversationId, actor)).catch(() => undefined).finally(() => activeCompressionJobs.delete(conversationId));
    return "pending";
};

function boundedError(value: unknown, fallback = "Chat failed"): string {
    let message: unknown;
    if (typeof value === "string") message = value;
    else if (value !== null && (typeof value === "object" || typeof value === "function")) {
        try { message = (value as { message?: unknown }).message; } catch { message = undefined; }
    }
    return redactDiagnosticText(typeof message === "string" && message.trim() ? message.trim() : fallback, 512);
}

type ChatDiagnosticInput = {
    category: string;
    level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL" | "SECURITY";
    message: string;
    metadata?: unknown;
};

function hasExactKeys(value: object, keys: string[]): boolean {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isValidEvent(event: ChatStreamEvent): boolean {
    if (!event || typeof event !== "object" || typeof event.type !== "string") return false;
    if (event.type === "conversation") return hasExactKeys(event, ["type", "id"]) && typeof event.id === "string" && SAFE_ID.test(event.id);
    if (event.type === "token") return hasExactKeys(event, ["type", "delta"]) && typeof event.delta === "string" && utf8ByteLength(event.delta) <= MAX_REPLY_CHARS;
    if (event.type === "tool_start") return hasExactKeys(event, ["type", "id", "name"]) && typeof event.id === "string" && SAFE_ID.test(event.id) && typeof event.name === "string" && event.name.trim().length > 0 && event.name.length <= 128;
    if (event.type === "tool_result") return hasExactKeys(event, ["type", "id", "name", "params", "result"]) && typeof event.id === "string" && SAFE_ID.test(event.id) && typeof event.name === "string" && event.name.trim().length > 0 && event.name.length <= 128 && typeof event.result === "object" && event.result !== null &&
        (event.result.ok ? hasExactKeys(event.result, ["ok", "data"]) && event.result.ok === true : hasExactKeys(event.result, ["ok", "error"]) && event.result.ok === false && typeof event.result.error === "string" && event.result.error.trim().length > 0 && event.result.error.length <= 512);
    if (event.type === "limit") return hasExactKeys(event, ["type", "reason"]) && ["iterations", "tool_calls", "context"].includes(event.reason);
    if (event.type === "compression") return hasExactKeys(event, ["type", "status"]) && ["pending", "compressionSchedulerUnavailable"].includes(event.status);
    if (event.type === "error") return hasExactKeys(event, ["type", "message"]) && typeof event.message === "string" && event.message.trim().length > 0 && event.message.length <= 512;
    return event.type === "done" && hasExactKeys(event, ["type"]);
}

function encodeEvent(event: ChatStreamEvent): Uint8Array | null {
    if (!isValidEvent(event)) return null;
    const encoded = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
    return encoded.length <= MAX_FRAME_BYTES ? encoded : null;
}

function projectForSse(value: unknown, maxBytes: number, omission: unknown = { omitted: true }): unknown {
    try {
        if (new TextEncoder().encode(JSON.stringify(value)).length <= maxBytes) return value;
    } catch { /* fall through to omission */ }
    return omission;
}

function projectToolResult(id: string, name: string, params: unknown, result: ChatToolCall["result"]): { params: unknown; result: ChatToolCall["result"] } {
    const successOmission = verifiedToolResultOmission(name, result);
    const safeResult = result.ok ? { ok: true as const, data: result.data } : { ok: false as const, error: boundedError(result.error, "Tool execution failed") };
    const candidates = [
        { params, result: safeResult },
        { params: projectForSse(params, 16 * 1024), result: result.ok ? { ok: true as const, data: projectForSse(result.data, 180 * 1024, successOmission) } : safeResult },
        { params: { omitted: true }, result: result.ok ? { ok: true as const, data: successOmission } : safeResult },
    ];
    for (const candidate of candidates) {
        if (encodeEvent({ type: "tool_result", id, name, ...candidate })) return candidate;
    }
    return { params: { omitted: true }, result: result.ok ? { ok: true, data: successOmission } : safeResult };
}

function persistedToolCalls(calls: ChatToolCall[]): string {
    const perCall = Math.floor(MAX_PERSISTED_TOOL_CALL_BYTES / Math.max(1, MAX_TOOL_CALLS_PER_MESSAGE)) - 256;
    const projected = calls.map((call) => ({
        name: call.name,
        params: projectForSse(call.params, Math.max(512, perCall / 4), { omitted: true, summary: "Tool parameters omitted from persistence size limit." }),
        result: call.result.ok
            ? { ok: true as const, data: projectForSse(call.result.data, Math.max(512, perCall / 2), verifiedToolResultOmission(call.name, call.result, Math.max(512, perCall / 2))) }
            : { ok: false as const, error: boundedError(call.result.error, "Tool execution failed") },
    }));
    let encoded = JSON.stringify(projected);
    if (utf8ByteLength(encoded) <= MAX_PERSISTED_TOOL_CALL_BYTES) return encoded;
    const minimal = projected.map((call) => ({
        name: call.name,
        params: { omitted: true, summary: "Tool parameters omitted from persistence size limit." },
        result: call.result.ok
            ? { ok: true as const, data: { omitted: true, summary: "Tool result omitted from persistence size limit." } }
            : { ok: false as const, error: call.result.error },
    }));
    encoded = JSON.stringify(minimal);
    if (utf8ByteLength(encoded) <= MAX_PERSISTED_TOOL_CALL_BYTES) return encoded;

    // This is unreachable while MAX_TOOL_CALLS_PER_MESSAGE, tool-name, and
    // bounded-error caps hold. Do not fabricate a success/failure status if a
    // future change breaks that invariant; the empty array remains shape-safe.
    const emergency = "[]";
    if (utf8ByteLength(emergency) <= MAX_PERSISTED_TOOL_CALL_BYTES) return emergency;
    throw new Error("Persisted tool-call size invariant violated");
}

class StreamAbortError extends Error {}

export async function POST(request: Request) {
    const correlationId = createDiagnosticCorrelationId();
    const startedAt = Date.now();
    let diagnosticActorId: string | undefined;
    let diagnosticConversationId: string | undefined;

    const writeDiagnostic = async (input: ChatDiagnosticInput): Promise<void> => {
        try {
            await recordDiagnostic({
                correlationId,
                ...(diagnosticActorId ? { actorId: diagnosticActorId } : {}),
                ...(diagnosticConversationId ? { conversationId: diagnosticConversationId } : {}),
                ...input,
            });
        } catch {
            // recordDiagnostic is intentionally nonthrowing; this guard also
            // protects the chat path if a test/custom sink violates that seam.
        }
    };
    const json = (body: unknown, status: number): NextResponse => {
        const response = NextResponse.json(body, { status });
        response.headers.set("X-Correlation-ID", correlationId);
        response.headers.set("Cache-Control", "no-store");
        return response;
    };
    const failureResponse = async (status: number, body: unknown, message: string, metadata?: unknown): Promise<NextResponse> => {
        await writeDiagnostic({ category: "CHAT_REQUEST_FAILURE", level: status >= 500 ? "ERROR" : "WARN", message, metadata });
        return json(body, status);
    };

    await writeDiagnostic({ category: "CHAT_REQUEST_START", level: "INFO", message: "AI chat request started", metadata: { method: "POST" } });

    const session = await auth();
    if (!session?.user?.id) {
        return failureResponse(401, { error: "Unauthorized" }, "AI chat request rejected: unauthenticated");
    }

    let runtimeCredentials: RuntimeProviderCredentials;
    try {
        runtimeCredentials = await resolveRuntimeProviderCredentials();
    } catch {
        runtimeCredentials = {};
        await writeDiagnostic({ category: "CHAT_REQUEST_FAILURE", level: "WARN", message: "Runtime provider credential lookup failed; continuing with environment configuration", metadata: { stage: "runtime_credentials" } });
    }
    if (!process.env.GLM_API_KEY && !process.env.NUHA_API_KEY && !runtimeCredentials.zai && !runtimeCredentials.nuha) {
        return failureResponse(503, { error: "AI is not configured" }, "AI chat request rejected: AI is not configured");
    }

    const rate = await checkRateLimit(session.user.id);
    if (!rate.allowed) {
        await writeDiagnostic({ category: "CHAT_LIMIT", level: "WARN", message: "AI chat rate limit reached", metadata: { reason: "rate", resetAt: rate.resetAt } });
        const response = json(
            { error: "Rate limit exceeded. Please slow down.", resetAt: rate.resetAt },
            429,
        );
        response.headers.set("Retry-After", String(rate.retryAfterSec ?? Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
        return response;
    }

    let parsed;
    try {
        const body = await request.json();
        parsed = requestSchema.parse(body);
    } catch (e) {
        if (e instanceof z.ZodError) {
            return failureResponse(400, { error: redactDiagnosticText(e.errors[0].message, 512) }, "AI chat request body failed validation", { stage: "request_validation" });
        }
        return failureResponse(400, { error: "Invalid request body" }, "AI chat request body could not be parsed", { stage: "request_parsing" });
    }

    const requestNow = new Date();

    // Single controlled actor: role comes from the DB (MANAGER→LEAD, isActive
    // checked), never from the session JWT.
    let actor: SabahActor;
    try {
        actor = await toSabahActor(session.user);
        diagnosticActorId = actor.id;
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return failureResponse(403, { error: "Forbidden" }, "AI chat request rejected: actor forbidden");
        }
        console.error(JSON.stringify({ event: "chat_actor_resolution_failure", correlationId, message: "Unable to resolve chat actor" }));
        return failureResponse(500, { error: "Unable to resolve user" }, "AI chat actor resolution failed");
    }

    const userId = actor.id;
    const userName = session.user.name ?? "User";
    const userEmail = session.user.email ?? "";

    const ctx: ExecutorContext = { userId, userRole: actor.role, conversationId: null, approvedWorkflowId: parsed.approvedWorkflowId ?? null };

    let streamCanceled = false;
    let cancellationRecorded = false;
    const recordCancellation = async (reason: unknown): Promise<void> => {
        if (cancellationRecorded) return;
        cancellationRecorded = true;
        await writeDiagnostic({
            category: "CHAT_CANCELED",
            level: "WARN",
            message: "AI chat stream canceled",
            metadata: { reason: typeof reason === "string" ? redactDiagnosticText(reason, 128) : "consumer_cancelled" },
        });
    };
    request.signal.addEventListener("abort", () => { streamCanceled = true; });

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            let failed = false;
            let safeErrorSent = false;
            let streamOutcome: "completed" | "failed" | "canceled" = "failed";
            const send = (event: ChatStreamEvent) => {
                const encoded = encodeEvent(event);
                if (!encoded) {
                    failed = true;
                    if (!safeErrorSent) {
                        safeErrorSent = true;
                        const fallback = encodeEvent({ type: "error", message: "Chat response exceeded the safe output limit" });
                        if (fallback) {
                            try { controller.enqueue(fallback); } catch { /* controller closed */ }
                        }
                    }
                    throw new StreamAbortError("Invalid outbound event");
                }
                try {
                    controller.enqueue(encoded);
                } catch {
                    failed = true;
                    throw new StreamAbortError("Stream controller rejected output");
                }
            };

            try {
                // Resolve or create the conversation. Persistence is best-effort:
                // if the AiConversation/AiMessage tables don't exist yet (migration
                // not applied), we skip persistence silently so chat still works.
                let activeConvId: string | null = null;
                // Model transcript rebuilt server-side from persisted messages
                // for owned conversations; client history never overrides it.
                let persistedHistory: GLMMessage[] = [];
                try {
                    let conversationId = parsed.conversationId;
                    if (conversationId) {
                        const existing = await prisma.aiConversation.findUnique({
                            where: { id: conversationId },
                            select: { userId: true },
                        });
                        if (!existing || existing.userId !== userId) {
                            conversationId = undefined;
                        }
                    }
                    if (conversationId) {
                        const rows = await prisma.aiMessage.findMany({
                            where: { conversationId },
                            orderBy: { createdAt: "desc" },
                            take: MAX_PERSISTED_HISTORY,
                            select: { role: true, content: true },
                        });
                        persistedHistory = rows
                            .reverse()
                            .filter((row): row is { role: "user" | "assistant"; content: string } =>
                                (row.role === "user" || row.role === "assistant") && typeof row.content === "string" && row.content.length > 0)
                            .map((row) => ({ role: row.role, content: row.content }));
                    }
                    if (!conversationId) {
                        const newConv = await prisma.aiConversation.create({
                            data: {
                                userId,
                                title: parsed.message.slice(0, 60).trim() || null,
                            },
                        });
                        conversationId = newConv.id;
                    }
                    activeConvId = conversationId;
                    ctx.conversationId = activeConvId;
                    diagnosticConversationId = activeConvId;
                    send({ type: "conversation", id: activeConvId });

                    // Persist the user message
                    await prisma.aiMessage.create({
                        data: {
                            conversationId: activeConvId,
                            role: "user",
                            content: parsed.message,
                        },
                    });
                } catch (persistErr) {
                    if (persistErr instanceof StreamAbortError) throw persistErr;
                    console.warn("AI persistence unavailable:", boundedError(persistErr, "Persistence unavailable"));
                    await writeDiagnostic({
                        category: "CHAT_PERSISTENCE_FAILURE",
                        level: "WARN",
                        message: "AI conversation or user message persistence failed",
                        metadata: { stage: "conversation_or_user_message", error: boundedError(persistErr, "Persistence unavailable") },
                    });
                    activeConvId = null;
                    diagnosticConversationId = undefined;
                }

                const systemPrompt = await buildSystemPrompt({
                    id: userId,
                    name: userName,
                    email: userEmail,
                    role: actor.role,
                    now: requestNow,
                });

                // Only server-persisted messages may supply conversation context.
                // Client history is display state and is never a trusted model input.
                const seedHistory: GLMMessage[] = parsed.conversationId
                    ? persistedHistory
                    : [];
                const currentUserMessage = stampCurrentDate(parsed.message, requestNow);
                const untrustedPageContext = parsed.pageContext
                    ? `\n\n${formatUntrustedPageContext(parsed.pageContext)}`
                    : "";


                // Honor the admin-assigned CHAT model; Nuha assignments switch
                // the primary provider. Explicit fallback configuration is
                // validated by the roles service and passed through unchanged.
                let assignment: Awaited<ReturnType<typeof resolveModelForRole>> | null;
                try {
                    assignment = await resolveModelForRole("CHAT", prisma, { defaultTarget: DEFAULT_OPERATIONAL_MODEL });
                } catch (error) {
                    // Invalid persisted assignments must fail visibly. A
                    // transient DB lookup failure may continue on the safe
                    // default, but it is still observable in diagnostics.
                    if (error instanceof Error && error.name === "InvalidModelAssignmentConfigError") {
                        await writeDiagnostic({ category: "CHAT_REQUEST_FAILURE", level: "ERROR", message: "Configured CHAT model assignment is invalid", metadata: { stage: "model_assignment" } });
                        throw error;
                    }
                    await writeDiagnostic({ category: "CHAT_MODEL_ASSIGNMENT_FALLBACK", level: "WARN", message: "CHAT model assignment lookup failed; using safe default", metadata: { stage: "model_assignment_lookup" } });
                    assignment = null;
                }
                let configuredFallbacks: ReadonlyArray<{ providerKey: "zai" | "nuha"; modelName: string }> | undefined;
                if (assignment) {
                    try {
                        configuredFallbacks = getConfiguredFallbacks("CHAT", JSON.stringify(assignment.config));
                    } catch (error) {
                        await writeDiagnostic({ category: "CHAT_REQUEST_FAILURE", level: "ERROR", message: "Configured CHAT fallback assignment is invalid", metadata: { stage: "model_fallbacks", error: boundedError(error, "Invalid fallback configuration") } });
                        throw error;
                    }
                }
                let chatModel: { provider: AiProvider; model: GLMModel };
                try {
                    const target = buildOperationalAiTarget(assignment, runtimeCredentials);
                    chatModel = { provider: target.provider, model: target.model };
                    configuredFallbacks = configuredFallbacks ?? target.fallbacks;
                } catch (error) {
                    await writeDiagnostic({
                        category: "CHAT_REQUEST_FAILURE",
                        level: "ERROR",
                        message: "Configured CHAT provider or model is unsupported",
                        metadata: { stage: "model_assignment", error: boundedError(error, "Unsupported CHAT target") },
                    });
                    throw error;
                }

                const messages: GLMMessage[] = [
                    { role: "system", content: systemPrompt },
                    ...seedHistory,
                    { role: "user", content: `${currentUserMessage}${untrustedPageContext}` },
                ];

                let toolCallsMade = 0;
                let iteration = 0;
                let finalContent = "";
                let finalContentBytes = 0;
                const aggregatedToolResults: ChatToolCall[] = [];

                while (iteration < MAX_LOOP_ITERATIONS) {
                    iteration += 1;

                    if (contextSize(messages) > MAX_CONTEXT_CHARS) {
                        await writeDiagnostic({ category: "CHAT_LIMIT", level: "WARN", message: "AI chat context was trimmed to the safe limit", metadata: { reason: "context", iteration } });
                        send({ type: "limit", reason: "context" });
                        trimForContext(messages);
                    }

                    let aggregatedCalls: GLMToolCall[] = [];
                    let accumulatedContent = "";
                    let streamErr: string | null = null;

                    for await (const chunk of callGLMStream({
                        provider: chatModel.provider,
                        model: chatModel.model,
                        messages,
                        tools: AI_TOOLS,
                        temperature: 0.3,
                        max_tokens: 2500,
                        signal: request.signal,
                        credentials: runtimeCredentials,
                        fallbacks: configuredFallbacks,
                        onDiagnostic: async (event: GLMDiagnosticEvent) => {
                            const category = event.event === "request"
                                ? "PROVIDER_REQUEST"
                                : event.event === "response"
                                    ? "PROVIDER_RESPONSE"
                                    : event.event === "error"
                                        ? "PROVIDER_ERROR"
                                        : "PROVIDER_FALLBACK";
                            const level = event.event === "error" ? "ERROR" : event.event === "fallback" ? "WARN" : "INFO";
                            const metadata: Record<string, unknown> = {
                                provider: redactDiagnosticText(event.provider, 64),
                                model: redactDiagnosticText(event.model, 128),
                                attempt: Number.isFinite(event.attempt) ? Math.max(0, Math.min(100, Math.trunc(event.attempt))) : 0,
                                ...(typeof event.durationMs === "number" && Number.isFinite(event.durationMs) ? { durationMs: Math.max(0, Math.min(300_000, Math.trunc(event.durationMs))) } : {}),
                                ...(typeof event.status === "number" && Number.isFinite(event.status) ? { status: Math.max(0, Math.min(999, Math.trunc(event.status))) } : {}),
                                ...(event.errorCode ? { errorCode: redactDiagnosticText(event.errorCode, 128) } : {}),
                            };
                            await writeDiagnostic({
                                category,
                                level,
                                message: redactDiagnosticText(event.message ?? `Provider ${event.event}`, 512),
                                metadata,
                            });
                        },
                    })) {
                        if (chunk.type === "content_delta") {
                            const remaining = MAX_REPLY_CHARS - finalContentBytes;
                            const deltaBytes = utf8ByteLength(chunk.delta);
                            if (deltaBytes > remaining) {
                                if (remaining > 0) {
                                    const partial = utf8Prefix(chunk.delta, remaining);
                                    accumulatedContent += partial;
                                    finalContent += partial;
                                    finalContentBytes += utf8ByteLength(partial);
                                    send({ type: "token", delta: partial });
                                }
                                await writeDiagnostic({ category: "CHAT_LIMIT", level: "WARN", message: "AI chat response exceeded the safe output limit", metadata: { reason: "output", iteration } });
                                send({ type: "error", message: "Chat response exceeded the safe output limit" });
                                failed = true;
                                break;
                            }
                            accumulatedContent += chunk.delta;
                            finalContent += chunk.delta;
                            finalContentBytes += deltaBytes;
                            send({ type: "token", delta: chunk.delta });
                        } else if (chunk.type === "finish") {
                            aggregatedCalls = chunk.toolCalls;
                            if (chunk.content && !accumulatedContent) {
                                const remaining = MAX_REPLY_CHARS - finalContentBytes;
                                const contentBytes = utf8ByteLength(chunk.content);
                                if (contentBytes > remaining) {
                                    if (remaining > 0) {
                                        const partial = utf8Prefix(chunk.content, remaining);
                                        accumulatedContent = partial;
                                        finalContent += partial;
                                        finalContentBytes += utf8ByteLength(partial);
                                        send({ type: "token", delta: partial });
                                    }
                                    await writeDiagnostic({ category: "CHAT_LIMIT", level: "WARN", message: "AI chat response exceeded the safe output limit", metadata: { reason: "output", iteration } });
                                send({ type: "error", message: "Chat response exceeded the safe output limit" });
                                    failed = true;
                                    break;
                                }
                                accumulatedContent = chunk.content;
                                finalContent += chunk.content;
                                finalContentBytes += contentBytes;
                                send({ type: "token", delta: chunk.content });
                            }
                        } else if (chunk.type === "error") {
                            streamErr = chunk.message;
                        }
                    }

                    if (streamErr) {
                        await writeDiagnostic({ category: "CHAT_REQUEST_FAILURE", level: "ERROR", message: "AI provider stream failed", metadata: { stage: "provider_stream", error: boundedError(streamErr, "Provider stream failed"), iteration } });
                        send({ type: "error", message: boundedError(streamErr) });
                        failed = true;
                        break;
                    }
                    if (failed) break;

                    if (aggregatedCalls.length === 0) {
                        // Model chose to respond without tool calls; we're done
                        break;
                    }

                    if (toolCallsMade + aggregatedCalls.length > MAX_TOOL_CALLS_PER_MESSAGE) {
                        await writeDiagnostic({ category: "CHAT_LIMIT", level: "WARN", message: "AI chat tool-call limit reached", metadata: { reason: "tool_calls", iteration, toolCallsMade } });
                        send({ type: "limit", reason: "tool_calls" });
                        break;
                    }

                    messages.push({
                        role: "assistant",
                        content: accumulatedContent || null,
                        tool_calls: aggregatedCalls,
                    });

                    for (const tc of aggregatedCalls) {
                        if (typeof tc.id !== "string" || !SAFE_ID.test(tc.id) || typeof tc.function.name !== "string" || tc.function.name.trim().length === 0 || tc.function.name.length > 128) {
                            await writeDiagnostic({ category: "CHAT_REQUEST_FAILURE", level: "ERROR", message: "AI provider returned an invalid tool call", metadata: { stage: "tool_validation" } });
                            send({ type: "error", message: "Invalid tool call" });
                            failed = true;
                            break;
                        }
                        send({ type: "tool_start", id: tc.id, name: tc.function.name });

                        const toolStartedAt = Date.now();
                        let result;
                        try {
                            result = await runTool(tc.function.name, tc.function.arguments, ctx);
                        } catch (toolError) {
                            result = { ok: false as const, error: boundedError(toolError, "Tool execution failed") };
                        }

                        await writeDiagnostic({
                            category: "CHAT_TOOL_OUTCOME",
                            level: result.ok ? "INFO" : "WARN",
                            message: result.ok ? "AI tool completed" : "AI tool failed",
                            metadata: {
                                toolName: redactDiagnosticText(tc.function.name, 128),
                                ok: result.ok,
                                durationMs: Math.max(0, Math.min(300_000, Date.now() - toolStartedAt)),
                            },
                        });

                        let parsedParams: unknown = tc.function.arguments;
                        try {
                            parsedParams = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
                        } catch {
                            // keep raw string
                        }

                        toolCallsMade += 1;
                        const { params: projectedParams, result: projectedResult } = projectToolResult(tc.id, tc.function.name, parsedParams, result);
                        aggregatedToolResults.push({ name: tc.function.name, params: projectedParams, result: projectedResult });

                        send({
                            type: "tool_result",
                            id: tc.id,
                            name: tc.function.name,
                            params: projectedParams,
                            result: projectedResult,
                        });

                        messages.push({
                            role: "tool",
                            tool_call_id: tc.id,
                            content: JSON.stringify(result),
                        });
                    }

                    if (failed) break;

                    if (iteration === MAX_LOOP_ITERATIONS) {
                        await writeDiagnostic({ category: "CHAT_LIMIT", level: "WARN", message: "AI chat iteration limit reached", metadata: { reason: "iterations", iteration } });
                        send({ type: "limit", reason: "iterations" });
                    }
                }

                // Persist the assistant message + bump conversation updatedAt
                if (!failed && activeConvId) {
                    try {
                        await prisma.aiMessage.create({
                            data: {
                                conversationId: activeConvId,
                                role: "assistant",
                                content: finalContent || null,
                                toolCallsJson: aggregatedToolResults.length > 0
                                    ? persistedToolCalls(aggregatedToolResults)
                                    : null,
                            },
                        });
                        await prisma.aiConversation.update({
                            where: { id: activeConvId },
                            data: { updatedAt: new Date() },
                        });
                    } catch (persistErr) {
                        console.error(JSON.stringify({ event: "chat_assistant_persistence_failure", correlationId, message: "Failed to persist AI assistant message", error: boundedError(persistErr, "Persistence unavailable") }));
                        await writeDiagnostic({
                            category: "CHAT_PERSISTENCE_FAILURE",
                            level: "ERROR",
                            message: "AI assistant message persistence failed",
                            metadata: { stage: "assistant_message", error: boundedError(persistErr, "Persistence unavailable") },
                        });
                    }
                    if (contextSize(messages) > MAX_CONTEXT_CHARS) {
                        const status = await requestBackgroundCompression(activeConvId, actor);
                        send({ type: "compression", status });
                    }
                }

                if (!failed) {
                    streamOutcome = "completed";
                    send({ type: "done" });
                }
            } catch (error) {
                if (error instanceof StreamAbortError) {
                    if (streamCanceled || request.signal.aborted) await recordCancellation("stream_abort");
                    return;
                }
                console.error(JSON.stringify({ event: "chat_stream_failure", correlationId, message: "AI chat stream failed", error: boundedError(error) }));
                failed = true;
                await writeDiagnostic({ category: "CHAT_REQUEST_FAILURE", level: "ERROR", message: "AI chat stream failed", metadata: { stage: "stream", error: boundedError(error) } });
                try { send({ type: "error", message: boundedError(error) }); } catch { /* controller closed */ }
            } finally {
                if (streamCanceled || request.signal.aborted) {
                    streamOutcome = "canceled";
                    await recordCancellation("consumer_cancelled");
                } else if (failed) {
                    streamOutcome = "failed";
                }
                await writeDiagnostic({
                    category: "CHAT_REQUEST_COMPLETE",
                    level: streamOutcome === "completed" ? "INFO" : "WARN",
                    message: "AI chat request completed",
                    metadata: {
                        outcome: streamOutcome,
                        durationMs: Math.max(0, Math.min(300_000, Date.now() - startedAt)),
                        persistedConversation: Boolean(ctx.conversationId),
                    },
                });
                if (controller.desiredSize !== null) {
                    try { controller.close(); } catch { /* consumer canceled or stream already closed */ }
                }
            }
        },
        async cancel(reason) {
            streamCanceled = true;
            await recordCancellation(reason);
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Correlation-ID": correlationId,
        },
    });
}
