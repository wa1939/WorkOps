/**
 * Z.AI adapter implementing the ProviderClient interface.
 * Provides timeout, retry logic, and error redaction (no API key leakage).
 */

export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string | null;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
    name?: string;
}

export interface CompletionRequest {
    messages: ChatMessage[];
    model: string;
    temperature?: number;
    maxTokens?: number;
    tools?: Array<{
        type: "function";
        function: { name: string; description: string; parameters: Record<string, unknown> };
    }>;
    toolChoice?: "auto" | "none" | "required";
    signal?: AbortSignal;
    timeoutMs?: number;
}

export interface CompletionResult {
    text: string;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    model: string;
}

export interface ZaiAdapterConfig {
    apiKey: string;
    baseUrl?: string;
    maxRetries?: number;
    baseRetryDelayMs?: number;
    defaultTimeoutMs?: number;
}

class ZaiError extends Error {
    constructor(
        message: string,
        public status: number,
        public retryable: boolean = false,
    ) {
        super(message);
        this.name = "ZaiError";
    }
}

/**
 * Redact sensitive data from messages before logging.
 */
function redactMessage(message: string, apiKey: string): string {
    let redacted = message;
    // Redact API key if present
    if (apiKey) {
        redacted = redacted.replaceAll(apiKey, "[REDACTED]");
    }
    return redacted;
}

/**
 * Create a Z.AI adapter instance.
 */
export function createZaiAdapter(config: ZaiAdapterConfig): {
    complete: (request: CompletionRequest) => Promise<CompletionResult>;
} {
    const {
        apiKey,
        baseUrl = "https://api.z.ai/api/paas/v4/chat/completions",
        maxRetries = 2,
        baseRetryDelayMs = 500,
        defaultTimeoutMs = 30000,
    } = config;

    function isRetryableStatus(status: number): boolean {
        return status === 429 || (status >= 500 && status < 600);
    }

    function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function doCall(request: CompletionRequest, attempt: number): Promise<CompletionResult> {
        const signal = request.signal ?? new AbortController().signal;
        const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;

        // Create abort controller for timeout
        const timeoutController = new AbortController();
        const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);

        // Combine signals
        const combinedSignal = new AbortController();
        const abortHandler = () => {
            combinedSignal.abort();
            clearTimeout(timeoutId);
        };
        signal.addEventListener("abort", abortHandler);
        timeoutController.signal.addEventListener("abort", abortHandler);

        try {
            const body: Record<string, unknown> = {
                model: request.model,
                messages: request.messages,
                temperature: request.temperature ?? 0.3,
                max_tokens: request.maxTokens ?? 2000,
            };

            if (request.tools && request.tools.length > 0) {
                body.tools = request.tools;
                body.tool_choice = request.toolChoice ?? "auto";
            }

            const response = await fetch(baseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(body),
                signal: combinedSignal.signal,
            });

            clearTimeout(timeoutId);
            signal.removeEventListener("abort", abortHandler);

            if (!response.ok) {
                const rawBody = await response.text();
                const redactedBody = redactMessage(rawBody, apiKey);
                const retryable = isRetryableStatus(response.status);
                throw new ZaiError(
                    `Z.AI API error ${response.status}: ${redactedBody.substring(0, 300)}`,
                    response.status,
                    retryable,
                );
            }

            const data = await response.json();
            const choice = data?.choices?.[0];

            if (!choice) {
                throw new ZaiError(`Empty response from Z.AI: ${JSON.stringify(data).substring(0, 300)}`, 200);
            }

            let content: string | null = choice.message?.content ?? null;
            if ((!content || content.trim() === "") && choice.message?.reasoning_content) {
                content = choice.message.reasoning_content;
            }

            if (!content) {
                throw new ZaiError("Z.AI returned empty content", 200);
            }

            const usage = data?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

            return {
                text: content,
                usage: {
                    promptTokens: usage.prompt_tokens,
                    completionTokens: usage.completion_tokens,
                    totalTokens: usage.total_tokens,
                },
                model: request.model,
            };
        } catch (e) {
            clearTimeout(timeoutId);
            signal.removeEventListener("abort", abortHandler);

            if (e instanceof ZaiError) {
                throw e;
            }

            if (e instanceof DOMException && e.name === "AbortError") {
                throw new ZaiError(`Z.AI request timeout after ${timeoutMs}ms`, 408, false);
            }

            const message = e instanceof Error ? e.message : String(e);
            throw new ZaiError(`Z.AI request failed: ${redactMessage(message, apiKey)}`, 0, /network|fetch/i.test(message));
        }
    }

    async function complete(request: CompletionRequest): Promise<CompletionResult> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                return await doCall(request, attempt);
            } catch (e) {
                lastError = e as Error;
                const retryable =
                    e instanceof ZaiError && e.retryable;

                if (attempt === maxRetries || !retryable) {
                    throw lastError;
                }

                // Exponential backoff with jitter
                const delay = baseRetryDelayMs * Math.pow(2, attempt) + Math.random() * 200;
                await sleep(delay);
            }
        }

        throw lastError!;
    }

    return { complete };
}