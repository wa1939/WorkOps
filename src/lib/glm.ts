import { callAnthropic, streamAnthropic, AnthropicTransportError } from "./ai/anthropic-adapter";
import { compatibleBaseUrl, configuredAiTarget, environmentCredential, isAiProvider, isModelName, type AiProviderId } from "./ai/provider-config";

export const ZAI_GLM_BASE_URLS = {
    standardGlobal: "https://api.z.ai/api/paas/v4",
    standardChina: "https://open.bigmodel.cn/api/paas/v4",
    codingGlobal: "https://api.z.ai/api/coding/paas/v4",
    codingChina: "https://open.bigmodel.cn/api/coding/paas/v4",
} as const;

export const DEFAULT_GLM_BASE_URL = ZAI_GLM_BASE_URLS.codingGlobal;
export const DEFAULT_GLM_MODEL: GLMModel = "glm-5.3-flash";
const APPROVED_GLM_BASE_URLS = new Set<string>(Object.values(ZAI_GLM_BASE_URLS));

/**
 * Resolve the configured Z.AI profile without allowing arbitrary server-side
 * URLs. Hermes uses GLM_BASE_URL as the explicit endpoint override; preserve
 * that contract while restricting this app to official standard/coding hosts.
 */
export function resolveGLMBaseUrl(): string {
    const configured = (process.env.GLM_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (!configured) return DEFAULT_GLM_BASE_URL;
    if (!APPROVED_GLM_BASE_URLS.has(configured)) {
        throw new Error("GLM_BASE_URL must use an approved Z.AI standard or Coding Plan endpoint");
    }
    return configured;
}

export type GLMModel = "glm-5" | "glm-5.3" | "glm-5.3-flash" | "glm-4.7" | "glm-4.5" | "glm-4.5-flash" | "glm-4.5-air" | "GLM-4.5-Flash" | (string & {});
export type AiProvider = AiProviderId;

const INSUFFICIENT_BALANCE_CODE = "1113";
const FALLBACK_MODEL: GLMModel = "glm-4.5-flash";

// Nuha-2.1: OpenAI-compatible provider (native Arabic/English, 250k context).
export const NUHA_MODEL = "Nuha-2.1";
export const NUHA_DEFAULT_BASE_URL = "https://nuhagf.llmtests.org/v1";

function resolveNuhaBaseUrl(): string {
    const configured = (process.env.NUHA_BASE_URL ?? "").trim().replace(/\/+$/, "");
    if (!configured) return NUHA_DEFAULT_BASE_URL;
    if (configured !== NUHA_DEFAULT_BASE_URL) {
        throw new Error("NUHA_BASE_URL must use the approved Nuha endpoint");
    }
    return configured;
}

type ProviderTarget = { url: string; apiKey: string; model: string; provider: AiProvider };

export function isNuhaConfigured(): boolean {
    return typeof process.env.NUHA_API_KEY === "string" && process.env.NUHA_API_KEY.length > 0;
}

function nuhaTarget(model?: string, credential?: string): ProviderTarget | null {
    const apiKey = credential ?? process.env.NUHA_API_KEY;
    if (!apiKey) return null;
    const base = resolveNuhaBaseUrl();
    return { url: `${base}/chat/completions`, apiKey, model: model && /^nuha/i.test(model) ? model : NUHA_MODEL, provider: "nuha" };
}

function zaiTarget(model: string, credential?: string): ProviderTarget | null {
    const apiKey = credential ?? process.env.GLM_API_KEY;
    if (!apiKey) return null;
    return { url: `${resolveGLMBaseUrl()}/chat/completions`, apiKey, model, provider: "zai" };
}

function providerTarget(provider: AiProvider, model: string, opts: GLMCallOptions): ProviderTarget | null {
    const credential = opts.credentials?.[provider] ?? environmentCredential(provider);
    if (provider === "zai") return zaiTarget(model, credential);
    if (provider === "nuha") return nuhaTarget(model, credential);
    if (!credential) return null;
    if (!isModelName(model)) throw new Error("Selected AI model is invalid");
    const url = provider === "anthropic" ? "https://api.anthropic.com/v1/messages" : `${compatibleBaseUrl(provider)}/chat/completions`;
    return { provider, model, apiKey: credential, url };
}

function defaultCallOptions(opts: GLMCallOptions): GLMCallOptions {
    if (opts.provider !== undefined) return opts;
    const configured = configuredAiTarget();
    if (!configured) return opts;
    return { ...opts, provider: configured.providerKey, model: configured.modelName };
}

export type GLMToolCall = {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string;
    };
};

export type GLMContentBlock =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } };

export type GLMMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null | GLMContentBlock[];
    tool_calls?: GLMToolCall[];
    tool_call_id?: string;
    name?: string;
};

export type GLMTool = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type GLMThinking = "disabled" | "enabled";

export type GLMResponse = {
    content: string | null;
    tool_calls: GLMToolCall[];
    finish_reason: string;
};

export type GLMDiagnosticEvent = {
    event: "request" | "response" | "error" | "fallback";
    provider: AiProvider;
    model: string;
    attempt: number;
    durationMs?: number;
    status?: number;
    errorCode?: string;
    message?: string;
};

export type GLMCallOptions = {
    model?: GLMModel;
    /** Primary provider; defaults to zai (GLM). Admin model assignments select nuha. */
    provider?: AiProvider;
    messages: GLMMessage[];
    tools?: GLMTool[];
    temperature?: number;
    max_tokens?: number;
    /** Optional Z.AI-only reasoning control; omitted unless explicitly set. */
    thinking?: GLMThinking;
    tool_choice?: "auto" | "none" | "required";
    signal?: AbortSignal;
    /** Runtime-only decrypted credentials; never persist or log these values. */
    credentials?: Partial<Record<AiProvider, string>>;
    onDiagnostic?: (event: GLMDiagnosticEvent) => void | Promise<void>;
    /** Undefined preserves legacy routing; [] disables all automatic fallback. */
    fallbacks?: ReadonlyArray<{ providerKey: AiProvider; modelName: string }>;
};

export type GLMStreamChunk =
    | { type: "content_delta"; delta: string }
    | { type: "tool_call_partial"; index: number; id?: string; name?: string; argumentsDelta?: string }
    | { type: "finish"; finishReason: string; toolCalls: GLMToolCall[]; content: string }
    | { type: "error"; message: string; retryable: boolean };

class GLMError extends Error {
    constructor(
        message: string,
        public status: number,
        public errorCode?: string,
        public retryable: boolean = false,
        public kind: "provider" | "runtime" = "provider",
    ) {
        super(message);
        this.name = "GLMError";
    }
}

function isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
}

function isAbortError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    try {
        return (error as { name?: unknown }).name === "AbortError";
    } catch {
        return false;
    }
}

async function withRetry<T>(
    fn: () => Promise<T>,
    opts: {
        retries?: number;
        baseMs?: number;
        onRetry?: (attempt: number, err: Error) => void;
        signal?: AbortSignal;
    } = {},
): Promise<T> {
    const retries = opts.retries ?? 2;
    const baseMs = opts.baseMs ?? 500;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (e) {
            lastErr = e as Error;
            if (opts.signal?.aborted || isAbortError(e)) throw lastErr;
            const retryable =
                (e instanceof GLMError && e.retryable) ||
                /fetch failed|network|ECONNRESET|ETIMEDOUT|aborted/i.test(safeErrorMessage(e, ""));

            if (attempt === retries || !retryable) throw lastErr;

            const delay = baseMs * Math.pow(2, attempt) + Math.random() * 200;
            opts.onRetry?.(attempt + 1, lastErr);
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    throw lastErr!;
}

function requestBody(target: ProviderTarget, opts: GLMCallOptions, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model: target.model,
        messages: opts.messages,
        temperature: opts.temperature ?? 0.3,
    };
    // Nuha documents max_completion_tokens; GLM uses max_tokens.
    const maxTokens = opts.max_tokens ?? (stream ? 2500 : 2000);
    if (target.provider === "nuha" || target.provider === "openai") body.max_completion_tokens = maxTokens;
    else body.max_tokens = maxTokens;
    if (target.provider === "zai" && opts.thinking !== undefined) {
        body.thinking = { type: opts.thinking };
    }
    if (stream) body.stream = true;
    if (opts.tools && opts.tools.length > 0) {
        body.tools = opts.tools;
        body.tool_choice = opts.tool_choice ?? "auto";
    }
    return body;
}

async function doCall(
    target: ProviderTarget,
    opts: GLMCallOptions,
): Promise<{ ok: true; data: GLMResponse } | { ok: false; status: number; rawBody: string; errorCode?: string }> {
    const resp = await fetch(target.url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${target.apiKey}`,
        },
        body: JSON.stringify(requestBody(target, opts, false)),
        signal: opts.signal,
    });

    const rawBody = await resp.text();

    if (!resp.ok) {
        let errorCode: string | undefined;
        try {
            errorCode = JSON.parse(rawBody)?.error?.code;
        } catch {
            // ignore
        }
        return { ok: false, status: resp.status, rawBody, errorCode };
    }

    const data = JSON.parse(rawBody);
    const choice = data?.choices?.[0];

    if (!choice) {
        return { ok: false, status: 200, rawBody: `Empty response: ${rawBody.substring(0, 300)}` };
    }

    // Provider reasoning is private, never a substitute for the final answer.
    const content: string | null = choice.message?.content ?? null;

    return {
        ok: true,
        data: {
            content,
            tool_calls: choice.message?.tool_calls ?? [],
            finish_reason: choice.finish_reason ?? "stop",
        },
    };
}

// Resolve the automatic provider order. The default is GLM primary, then a
// lower-cost GLM model, then Nuha only when its credential is configured.
function resolveAutomaticTargets(opts: GLMCallOptions): ProviderTarget[] {
    const model = opts.model ?? DEFAULT_GLM_MODEL;
    if (opts.provider && opts.provider !== "zai" && opts.provider !== "nuha") {
        const selected = providerTarget(opts.provider, model, opts);
        if (!selected) throw new Error("No configured credential for the selected AI provider");
        return [selected];
    }
    if (opts.provider === "nuha") {
        const primary = nuhaTarget(opts.model, opts.credentials?.nuha ?? environmentCredential("nuha"));
        if (!primary) throw new Error("NUHA_API_KEY is not configured");
        const glm = zaiTarget(DEFAULT_GLM_MODEL, opts.credentials?.zai);
        return [primary, ...(glm ? [glm] : [])];
    }
    const primary = zaiTarget(model, opts.credentials?.zai ?? environmentCredential("zai"));
    if (!primary) {
        const nuha = nuhaTarget(undefined, opts.credentials?.nuha);
        if (nuha) return [nuha];
        throw new Error("GLM_API_KEY is not configured");
    }
    const targets = [primary];
    if (primary.model !== FALLBACK_MODEL) targets.push({ ...primary, model: FALLBACK_MODEL });
    const nuha = nuhaTarget(undefined, opts.credentials?.nuha);
    if (nuha) targets.push(nuha);
    return targets;
}

/** Emits metadata only: never messages, credentials, headers, or provider bodies. */
function createAttemptObserver(opts: GLMCallOptions) {
    let attempt = 0;
    let previous = "";
    const emit = async (event: GLMDiagnosticEvent) => {
        try { await opts.onDiagnostic?.(event); } catch { console.error("AI diagnostic sink unavailable"); }
    };
    const currentAttempts = new Map<string, {
        context: { provider: AiProvider; model: string; attempt: number };
        started: number;
        streamErrorEmitted: boolean;
    }>();
    const observe = async <T>(target: ProviderTarget, operation: () => Promise<T>): Promise<T> => {
        const identity = `${target.provider}:${target.model}`;
        const context = { provider: target.provider, model: target.model, attempt: ++attempt };
        if (previous && identity !== previous) await emit({ ...context, event: "fallback" });
        previous = identity;
        await emit({ ...context, event: "request" });
        const started = Date.now();
        currentAttempts.set(identity, { context, started, streamErrorEmitted: false });
        try {
            opts.signal?.throwIfAborted();
            const result = await operation();
            await emit({ ...context, event: "response", status: 200, durationMs: Date.now() - started });
            return result;
        } catch (error) {
            const code = error instanceof GLMError && typeof error.errorCode === "string" && /^\d{3,6}$/.test(error.errorCode) ? error.errorCode : undefined;
            await emit({ ...context, event: "error", status: error instanceof GLMError ? error.status : undefined,
                errorCode: code, durationMs: Date.now() - started, message: opts.signal?.aborted ? "Request cancelled" : "Provider request failed" });
            throw error;
        }
    };
    const emitStreamError = async (target: ProviderTarget, error: unknown): Promise<void> => {
        const current = currentAttempts.get(`${target.provider}:${target.model}`);
        if (!current || current.streamErrorEmitted) return;
        current.streamErrorEmitted = true;
        const code = error instanceof GLMError && typeof error.errorCode === "string" && /^\d{3,6}$/.test(error.errorCode) ? error.errorCode : undefined;
        await emit({
            ...current.context,
            event: "error",
            status: error instanceof GLMError ? error.status : undefined,
            errorCode: code,
            durationMs: Date.now() - current.started,
            message: opts.signal?.aborted ? "Request cancelled" : "Provider stream failed",
        });
    };
    return { observe, emitStreamError };
}

function explicitTargets(opts: GLMCallOptions): ProviderTarget[] {
    if (!Array.isArray(opts.fallbacks) || opts.fallbacks.length > 4) throw new Error("Invalid fallback configuration");
    const requested = [{ providerKey: opts.provider ?? "zai", modelName: opts.model ?? (opts.provider === "nuha" ? NUHA_MODEL : DEFAULT_GLM_MODEL) }, ...opts.fallbacks];
    const targets: ProviderTarget[] = [];
    const seen = new Set<string>();
    for (const candidate of requested) {
        if (!candidate || !isAiProvider(candidate.providerKey) || !isModelName(candidate.modelName) ||
            (candidate.providerKey === "zai" && !/^glm-[a-z0-9.-]{1,60}$/i.test(candidate.modelName)) ||
            (candidate.providerKey === "nuha" && candidate.modelName !== NUHA_MODEL)) {
            throw new Error("Unsupported fallback provider or model");
        }
        const identity = `${candidate.providerKey}:${candidate.modelName}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        const target = providerTarget(candidate.providerKey, candidate.modelName, opts);
        if (target) targets.push(target);
    }
    if (!targets.length) throw new Error("No configured credential for selected AI targets");
    return targets;
}

export async function callGLM(opts: GLMCallOptions): Promise<GLMResponse> {
    opts = defaultCallOptions(opts);
    const automatic = opts.fallbacks === undefined;
    const targets = automatic ? resolveAutomaticTargets(opts) : explicitTargets(opts);

    const { observe } = createAttemptObserver(opts);
    const run = async (target: ProviderTarget): Promise<GLMResponse> => {
        return withRetry(() => observe(target, async () => {
            if (target.provider === "anthropic") {
                try { return await callAnthropic(opts, target.apiKey, target.model); }
                catch (error) {
                    if (error instanceof AnthropicTransportError) throw new GLMError(error.message, error.status, undefined, error.retryable);
                    throw error;
                }
            }
            const result = await doCall(target, opts);
            if (result.ok) return result.data;
            const retryable = isRetryableStatus(result.status);
            throw new GLMError(
                `${target.provider} API error ${result.status} (${target.model})`,
                result.status,
                result.errorCode,
                retryable,
            );
        }), { signal: opts.signal });
    };

    let lastError: unknown;
    const primary = targets[0];
    let firstAttempt = true;
    let allowAutomaticSameProviderFallback = false;
    for (const target of targets) {
        if (!target) continue;
        // Preserve the established automatic policy: a lower-cost GLM retry is
        // reserved for the provider's insufficient-balance response (1113).
        // Other failures go directly to the configured cross-provider target.
        if (automatic && !firstAttempt && target.provider === primary?.provider && !allowAutomaticSameProviderFallback) continue;
        opts.signal?.throwIfAborted();
        try {
            return await run(target);
        } catch (error) {
            lastError = error;
            if (firstAttempt) {
                allowAutomaticSameProviderFallback = automatic
                    && target.provider === "zai"
                    && target.model !== FALLBACK_MODEL
                    && error instanceof GLMError
                    && error.errorCode === INSUFFICIENT_BALANCE_CODE;
                firstAttempt = false;
            }
        }
    }
    throw lastError ?? new Error("No configured AI target");
}

export async function callGLMText(
    prompt: string,
    opts: Omit<GLMCallOptions, "messages" | "tools" | "tool_choice"> = {},
): Promise<string> {
    const resp = await callGLM({
        model: opts.model ?? (opts.provider === "nuha" ? NUHA_MODEL : DEFAULT_GLM_MODEL),
        provider: opts.provider,
        credentials: opts.credentials,
        fallbacks: opts.fallbacks,
        onDiagnostic: opts.onDiagnostic,
        messages: [{ role: "user", content: prompt }],
        temperature: opts.temperature ?? 0.75,
        max_tokens: opts.max_tokens ?? 2000,
        thinking: opts.thinking,
        signal: opts.signal,
    });

    if (!resp.content) {
        throw new Error("GLM returned empty content");
    }

    return resp.content;
}

function validVisionImageUrl(value: string): boolean {
    return value.length > 0 && value.length <= 2_000_000
        && (/^https:\/\//.test(value) || /^data:image\/(?:png|jpeg|jpg|webp);base64,/.test(value));
}

export async function callGLMVision(
    prompt: string,
    imageUrls: readonly string[],
    opts: { temperature?: number; max_tokens?: number } = {},
): Promise<string> {
    if (prompt.trim().length === 0 || prompt.length > 20_000) throw new Error("Vision prompt is invalid");
    if (imageUrls.length === 0 || imageUrls.length > 4 || imageUrls.some((url) => !validVisionImageUrl(url))) throw new Error("Vision image input is invalid");
    const content: GLMContentBlock[] = [
        { type: "text", text: prompt },
        ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
    ];
    const response = await callGLM({
        model: "glm-5.3-flash",
        messages: [{ role: "user", content }],
        temperature: opts.temperature ?? 1,
        max_tokens: opts.max_tokens ?? 2_000,
    });
    if (!response.content) throw new Error("GLM returned empty vision content");
    return response.content;
}

// =====================
// Streaming (SSE)
// =====================

async function readErrorPrefix(resp: Response): Promise<{ body: string; errorCode?: string }> {
    const reader = resp.body?.getReader();
    if (!reader) return { body: "" };
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let bytes = 0;
    let completedNormally = false;
    let canceled = false;
    try {
        while (bytes < 4096) {
            const { value, done } = await reader.read();
            if (done) {
                completedNormally = true;
                break;
            }
            if (!value) continue;
            const remaining = 4096 - bytes;
            const chunk = value.subarray(0, remaining);
            bytes += chunk.byteLength;
            parts.push(decoder.decode(chunk, { stream: true }));
            if (value.byteLength > remaining || bytes >= 4096) {
                canceled = true;
                try { await reader.cancel(); } catch { /* ignore cleanup failure */ }
                break;
            }
        }
        parts.push(decoder.decode());
    } catch {
        // Keep the status-based error generic, but still clean up the failed reader.
    } finally {
        if (!completedNormally && !canceled) {
            try { await reader.cancel(); } catch { /* ignore cleanup failure */ }
        }
        reader.releaseLock();
    }
    const body = parts.join("");
    let errorCode: string | undefined;
    try {
        const parsed: unknown = JSON.parse(body);
        if (isPlainObject(parsed) && isPlainObject(parsed.error)) errorCode = optionalString(parsed.error.code, "error code");
    } catch {
        // ignore malformed provider bodies
    }
    return { body, errorCode };
}

async function doStreamCall(
    target: ProviderTarget,
    opts: GLMCallOptions,
): Promise<Response> {
    const resp = await fetch(target.url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${target.apiKey}`,
        },
        body: JSON.stringify(requestBody(target, opts, true)),
        signal: opts.signal,
    });

    if (!resp.ok) {
        const { errorCode } = await readErrorPrefix(resp);
        throw new GLMError(
            `${target.provider} stream error ${resp.status} (${target.model})`,
            resp.status,
            errorCode,
            isRetryableStatus(resp.status),
        );
    }

    if (!resp.body) {
        throw new GLMError("GLM stream returned no body", 500, undefined, true);
    }

    return resp;
}

const MAX_PROVIDER_FRAME_BYTES = 256 * 1024;
const MAX_CONTENT_BYTES = 64 * 1024;
const MAX_PARTIAL_TOOL_CALLS = 25;
const MAX_TOOL_STRING_BYTES = 128;
const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
const MAX_TOTAL_TOOL_ARGUMENT_BYTES = 256 * 1024;

const encoder = new TextEncoder();
const utf8Bytes = (value: string): number => encoder.encode(value).byteLength;
const boundError = (message: string): GLMError => new GLMError(message, 400, undefined, false, "runtime");
function safeErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === "string") return error.trim().slice(0, 512) || fallback;
    if (error === null || (typeof error !== "object" && typeof error !== "function")) return fallback;
    try {
        const message = (error as { message?: unknown }).message;
        return typeof message === "string" ? message.trim().slice(0, 512) || fallback : fallback;
    } catch {
        return fallback;
    }
}
const boundedErrorMessage = (error: unknown): string => safeErrorMessage(error, "GLM stream failed");
const yieldedError = (error: unknown): GLMStreamChunk => ({
    type: "error",
    message: boundedErrorMessage(error),
    retryable: error instanceof GLMError ? error.retryable : false,
});

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const runtimeError = (field: string): GLMError => boundError(`GLM stream provider field ${field} has an invalid type`);

function optionalString(value: unknown, field: string, maxBytes?: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw runtimeError(field);
    if (maxBytes !== undefined && utf8Bytes(value) > maxBytes) throw boundError(`GLM stream ${field} exceeds its limit`);
    return value;
}

function validateRuntimeChoice(value: unknown): {
    delta: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } | undefined;
    finishReason?: string;
} {
    if (!isPlainObject(value)) throw runtimeError("choice");
    const deltaValue = value.delta;
    let delta: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } | undefined;
    if (deltaValue !== undefined && deltaValue !== null) {
        if (!isPlainObject(deltaValue)) throw runtimeError("delta");
        const content = optionalString(deltaValue.content, "content");
        const reasoning = optionalString(deltaValue.reasoning_content, "reasoning_content");
        let toolCalls: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> | undefined;
        if (deltaValue.tool_calls !== undefined && deltaValue.tool_calls !== null) {
            if (!Array.isArray(deltaValue.tool_calls) || deltaValue.tool_calls.length > MAX_PARTIAL_TOOL_CALLS) throw runtimeError("tool_calls");
            toolCalls = deltaValue.tool_calls.map((value) => {
                if (!isPlainObject(value)) throw runtimeError("tool_call");
                const index = value.index;
                if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) throw runtimeError("tool_call");
                let fn: { name?: string; arguments?: string } | undefined;
                if (value.function !== undefined) {
                    if (!isPlainObject(value.function)) throw runtimeError("function");
                    fn = {
                        name: optionalString(value.function.name, "tool name", MAX_TOOL_STRING_BYTES),
                        arguments: optionalString(value.function.arguments, "tool arguments"),
                    };
                }
                return { index, id: optionalString(value.id, "tool id", MAX_TOOL_STRING_BYTES), function: fn };
            });
        }
        delta = { content, reasoning_content: reasoning, tool_calls: toolCalls };
    }
    const finishReason = optionalString(value.finish_reason, "finish_reason", MAX_TOOL_STRING_BYTES);
    return { delta, finishReason };
}

interface PartialToolCall {
    id?: string;
    index: number;
    name?: string;
    arguments: string;
    argumentBytes: number;
}

export async function* callGLMStream(opts: GLMCallOptions): AsyncGenerator<GLMStreamChunk> {
    opts = defaultCallOptions(opts);
    const automatic = opts.fallbacks === undefined;
    const targets = automatic ? resolveAutomaticTargets(opts) : explicitTargets(opts);

    let emittedInAttempt = false;
    const { observe, emitStreamError } = createAttemptObserver(opts);
    const run = async function* (target: ProviderTarget): AsyncGenerator<GLMStreamChunk> {
        if (target.provider === "anthropic") {
            try {
                for await (const chunk of streamAnthropic(opts, target.apiKey, target.model)) {
                    emittedInAttempt = true;
                    yield chunk;
                }
            } catch (error) {
                if (error instanceof AnthropicTransportError) throw new GLMError(error.message, error.status, undefined, error.retryable);
                throw error;
            }
            return;
        }
        const resp = await withRetry(() => observe(target, () => doStreamCall(target, opts)), { signal: opts.signal });
        let reader: ReadableStreamDefaultReader<string> | undefined;

        const partials = new Map<number, PartialToolCall>();
        let accumulatedContent = "";
        let contentBytes = 0;
        let totalToolArgumentBytes = 0;
        let finishReason = "stop";
        const frameParts: string[] = [];
        let frameBytes = 0;
        let candidate = "";
        let completed = false;

        const delimiterPrefixes = ["\n", "\r", "\r\n", "\r\r", "\r\n\r"];
        const delimiters = ["\n\n", "\r\n\r\n", "\r\r"];
        const appendFrameChar = (char: string) => {
            frameParts.push(char);
            frameBytes += utf8Bytes(char);
            if (frameBytes > MAX_PROVIDER_FRAME_BYTES) throw boundError("GLM stream frame exceeds 256 KiB");
        };
        const feed = (input: string, frames: string[]) => {
            for (const char of input) {
                candidate += char;
                while (candidate && !delimiterPrefixes.includes(candidate) && !delimiters.includes(candidate)) {
                    appendFrameChar(candidate[0]);
                    candidate = candidate.slice(1);
                }
                const delimiter = delimiters.find((value) => candidate === value);
                if (delimiter) {
                    frames.push(frameParts.join(""));
                    frameParts.length = 0;
                    frameBytes = 0;
                    candidate = "";
                }
            }
        };

        try {
            reader = resp.body!.pipeThrough(new TextDecoderStream()).getReader();
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    for (const char of candidate) appendFrameChar(char);
                    candidate = "";
                    completed = true;
                    break;
                }
                const frames: string[] = [];
                feed(value, frames);
                for (const rawFrame of frames) {
                    const frame = rawFrame.trim();
                    if (!frame.startsWith("data:")) continue;
                    const payload = frame.substring(5).trim();
                    if (payload === "[DONE]") continue;

                    let json: unknown;
                    try { json = JSON.parse(payload); } catch { continue; }
                    if (!isPlainObject(json) || json.choices === undefined) continue;
                    if (!Array.isArray(json.choices) || json.choices.length > MAX_PARTIAL_TOOL_CALLS) throw runtimeError("choices");
                    if (json.choices.length === 0) continue;
                    const validated = validateRuntimeChoice(json.choices[0]);
                    const delta = validated.delta;
                    const contentDelta = delta?.content;
                    if (contentDelta) {
                        const deltaBytes = utf8Bytes(contentDelta);
                        if (contentBytes + deltaBytes > MAX_CONTENT_BYTES) throw boundError("GLM stream content exceeds 64 KiB");
                        contentBytes += deltaBytes;
                        accumulatedContent += contentDelta;
                        emittedInAttempt = true;
                        yield { type: "content_delta", delta: contentDelta };
                    }
                    if (delta?.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            let existing = partials.get(tc.index);
                            if (!existing) {
                                if (partials.size >= MAX_PARTIAL_TOOL_CALLS) throw boundError("GLM stream has too many tool calls");
                                existing = { index: tc.index, arguments: "", argumentBytes: 0 };
                                partials.set(tc.index, existing);
                            }
                            for (const [label, value] of [["id", tc.id], ["name", tc.function?.name]] as const) {
                                if (value !== undefined) {
                                    const trimmed = value.trim();
                                    if (trimmed.length === 0 || /[\u0000-\u001f\u007f]/.test(trimmed)) throw boundError(`GLM stream tool ${label} is invalid`);
                                    existing[label] = trimmed;
                                }
                            }
                            const argumentDelta = tc.function?.arguments;
                            if (argumentDelta) {
                                const argumentBytes = utf8Bytes(argumentDelta);
                                if (existing.argumentBytes + argumentBytes > MAX_TOOL_ARGUMENT_BYTES) throw boundError("GLM stream tool arguments exceed 64 KiB");
                                if (totalToolArgumentBytes + argumentBytes > MAX_TOTAL_TOOL_ARGUMENT_BYTES) throw boundError("GLM stream tool arguments exceed 256 KiB");
                                existing.argumentBytes += argumentBytes;
                                totalToolArgumentBytes += argumentBytes;
                                existing.arguments += argumentDelta;
                            }
                            emittedInAttempt = true;
                            yield { type: "tool_call_partial", index: tc.index, id: existing.id, name: existing.name, argumentsDelta: argumentDelta };
                        }
                    }
                    if (validated.finishReason) finishReason = validated.finishReason;
                }
            }
        } catch (error) {
            await emitStreamError(target, error);
            throw error;
        } finally {
            if (reader) {
                if (!completed) { try { await reader.cancel(); } catch { /* stream already failed */ } }
                reader.releaseLock();
            }
        }

        const toolCalls: GLMToolCall[] = Array.from(partials.values())
            .sort((a, b) => a.index - b.index)
            .filter((p) => p.id && p.name)
            .map((p) => ({
                id: p.id!,
                type: "function" as const,
                function: { name: p.name!, arguments: p.arguments },
            }));

        emittedInAttempt = true;
        yield {
            type: "finish",
            finishReason,
            toolCalls,
            content: accumulatedContent,
        };
    };

    const attempt = async function* (target: ProviderTarget): AsyncGenerator<GLMStreamChunk> {
        emittedInAttempt = false;
        yield* run(target);
    };
    let lastError: unknown;
    const primary = targets[0];
    let firstAttempt = true;
    let allowAutomaticSameProviderFallback = false;
    for (const target of targets) {
        if (!target) continue;
        if (automatic && !firstAttempt && target.provider === primary?.provider && !allowAutomaticSameProviderFallback) continue;
        try {
            opts.signal?.throwIfAborted();
            yield* attempt(target);
            return;
        } catch (error) {
            lastError = error;
            if (firstAttempt) {
                allowAutomaticSameProviderFallback = automatic
                    && target.provider === "zai"
                    && target.model !== FALLBACK_MODEL
                    && error instanceof GLMError
                    && error.errorCode === INSUFFICIENT_BALANCE_CODE;
                firstAttempt = false;
            }
            if (emittedInAttempt || opts.signal?.aborted) {
                yield yieldedError(error);
                return;
            }
        }
    }
    yield yieldedError(lastError);
}
