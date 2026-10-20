import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from "@anthropic-ai/sdk";
import type {
    GLMCallOptions,
    GLMMessage,
    GLMResponse,
    GLMStreamChunk,
    GLMToolCall,
} from "@/lib/glm";

// Native Anthropic adapter for the bring-your-own-provider layer. Mirrors the
// GLM/Nuha message + stream contract from @/lib/glm without altering it:
// the outer routing layer owns retries (maxRetries: 0 here), model selection
// (explicit `model` argument), and credential handling (explicit `apiKey`).
// Transport failures surface as sanitized AnthropicTransportError values that
// never embed the raw provider body, the prompt, or the API key.

const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_STREAM_MAX_TOKENS = 2500;

export class AnthropicTransportError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly retryable: boolean,
    ) {
        super(message);
        this.name = "AnthropicTransportError";
    }
}

function isRetryableStatus(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
}

/**
 * Map any SDK failure to a sanitized transport error. SDK error messages can
 * echo provider response bodies, so only the numeric status and a fixed
 * description are preserved.
 */
function toTransportError(error: unknown): AnthropicTransportError {
    if (error instanceof APIUserAbortError) {
        return new AnthropicTransportError("Anthropic request cancelled", 499, false);
    }
    if (error instanceof APIConnectionError) {
        return new AnthropicTransportError("Anthropic connection failed", 503, true);
    }
    if (error instanceof APIError && typeof error.status === "number") {
        return new AnthropicTransportError(
            `Anthropic API error ${error.status}`,
            error.status,
            isRetryableStatus(error.status),
        );
    }
    return new AnthropicTransportError("Anthropic request failed", 500, false);
}

function createClient(apiKey: string): Anthropic {
    // Retries belong to the outer provider layer, never to the SDK client.
    return new Anthropic({ apiKey, maxRetries: 0 });
}

function systemText(message: GLMMessage): string {
    if (typeof message.content === "string") return message.content;
    if (!Array.isArray(message.content)) return "";
    return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
}

function imageSource(url: string): Anthropic.ImageBlockParam["source"] {
    if (/^https?:\/\//.test(url)) return { type: "url", url };
    const match = /^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i.exec(url);
    if (match) {
        const mediaType = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
        return {
            type: "base64",
            media_type: `image/${mediaType}` as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: match[2],
        };
    }
    // The raw URL is prompt content — never echo it back.
    throw new Error("Anthropic adapter: user image must be an https URL or an image data URL");
}

function userContent(content: GLMMessage["content"]): Anthropic.MessageParam["content"] {
    if (content === null) return [];
    if (typeof content === "string") return content;
    return content.map((block) =>
        block.type === "text"
            ? { type: "text" as const, text: block.text }
            : { type: "image" as const, source: imageSource(block.image_url.url) },
    );
}

function parseToolArguments(argumentsJson: string): unknown {
    try {
        return JSON.parse(argumentsJson);
    } catch {
        return {};
    }
}

function assistantContent(message: GLMMessage): Anthropic.MessageParam["content"] {
    const blocks: Anthropic.ContentBlockParam[] = [];
    if (typeof message.content === "string" && message.content.length > 0) {
        blocks.push({ type: "text", text: message.content });
    } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
            if (block.type === "text") blocks.push({ type: "text", text: block.text });
        }
    }
    for (const toolCall of message.tool_calls ?? []) {
        blocks.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: parseToolArguments(toolCall.function.arguments),
        });
    }
    return blocks;
}

function toolResultMessage(message: GLMMessage): Anthropic.MessageParam {
    const content =
        typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
                ? message.content
                      .filter((block) => block.type === "text")
                      .map((block) => block.text)
                      .join("\n")
                : "";
    return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.tool_call_id ?? "", content }],
    };
}

function toolChoice(
    toolChoice: NonNullable<GLMCallOptions["tool_choice"]>,
): Anthropic.ToolChoice {
    if (toolChoice === "required") return { type: "any" };
    return { type: toolChoice };
}

function buildRequest(opts: GLMCallOptions, model: string, stream: boolean): Anthropic.MessageCreateParamsNonStreaming {
    const system = opts.messages
        .filter((message) => message.role === "system")
        .map(systemText)
        .filter((part) => part.length > 0)
        .join("\n\n");

    const messages: Anthropic.MessageParam[] = opts.messages
        .filter((message) => message.role !== "system")
        .map((message) => {
            if (message.role === "assistant") return { role: "assistant" as const, content: assistantContent(message) };
            if (message.role === "tool") return toolResultMessage(message);
            return { role: "user" as const, content: userContent(message.content) };
        });

    const params: Anthropic.MessageCreateParamsNonStreaming = {
        model,
        max_tokens: opts.max_tokens ?? (stream ? DEFAULT_STREAM_MAX_TOKENS : DEFAULT_MAX_TOKENS),
        messages,
    };
    if (system) params.system = system;
    if (typeof opts.temperature === "number") params.temperature = opts.temperature;
    if (opts.tools && opts.tools.length > 0) {
        params.tools = opts.tools.map((tool) => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters as Anthropic.Tool.InputSchema,
        }));
        if (opts.tool_choice) params.tool_choice = toolChoice(opts.tool_choice);
    }
    return params;
}

/** Anthropic stop_reason -> OpenAI-style finish_reason used by the GLM contract. */
function mapStopReason(stopReason: string | null | undefined): string {
    if (stopReason === "tool_use") return "tool_calls";
    if (stopReason === "max_tokens") return "length";
    return "stop";
}

function serializeToolInput(input: unknown): string {
    return JSON.stringify(input) ?? "{}";
}

export async function callAnthropic(
    opts: GLMCallOptions,
    apiKey: string,
    model: string,
): Promise<GLMResponse> {
    const client = createClient(apiKey);
    try {
        const message = await client.messages.create(buildRequest(opts, model, false), {
            signal: opts.signal,
        });
        let content: string | null = null;
        const toolCalls: GLMToolCall[] = [];
        for (const block of message.content) {
            if (block.type === "text") content = (content ?? "") + block.text;
            else if (block.type === "tool_use") {
                toolCalls.push({
                    id: block.id,
                    type: "function",
                    function: { name: block.name, arguments: serializeToolInput(block.input) },
                });
            }
            // Thinking/redacted-thinking blocks are provider-private reasoning and stay internal.
        }
        return { content, tool_calls: toolCalls, finish_reason: mapStopReason(message.stop_reason) };
    } catch (error) {
        throw toTransportError(error);
    }
}

export async function* streamAnthropic(
    opts: GLMCallOptions,
    apiKey: string,
    model: string,
): AsyncGenerator<GLMStreamChunk> {
    const client = createClient(apiKey);
    const partials = new Map<number, { id?: string; name?: string; arguments: string }>();
    let content = "";
    let finishReason = "stop";

    try {
        const stream = client.messages.stream(buildRequest(opts, model, true), {
            signal: opts.signal,
        });
        for await (const event of stream) {
            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
                partials.set(event.index, {
                    id: event.content_block.id,
                    name: event.content_block.name,
                    arguments: "",
                });
                yield {
                    type: "tool_call_partial",
                    index: event.index,
                    id: event.content_block.id,
                    name: event.content_block.name,
                };
            } else if (event.type === "content_block_delta") {
                if (event.delta.type === "text_delta") {
                    content += event.delta.text;
                    yield { type: "content_delta", delta: event.delta.text };
                } else if (event.delta.type === "input_json_delta") {
                    const partial = partials.get(event.index);
                    if (partial) {
                        partial.arguments += event.delta.partial_json;
                        yield { type: "tool_call_partial", index: event.index, argumentsDelta: event.delta.partial_json };
                    }
                }
                // thinking_delta / signature_delta / citations_delta are ignored:
                // reasoning is provider-private and never exposed through this contract.
            } else if (event.type === "message_delta" && event.delta.stop_reason) {
                finishReason = mapStopReason(event.delta.stop_reason);
            }
        }
    } catch (error) {
        throw toTransportError(error);
    }

    const toolCalls: GLMToolCall[] = Array.from(partials.entries())
        .sort(([a], [b]) => a - b)
        .filter(([, partial]) => partial.id && partial.name)
        .map(([, partial]) => ({
            id: partial.id!,
            type: "function" as const,
            function: { name: partial.name!, arguments: partial.arguments },
        }));

    yield { type: "finish", finishReason, toolCalls, content };
}
