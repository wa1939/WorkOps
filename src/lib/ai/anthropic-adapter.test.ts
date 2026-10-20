import { afterEach, describe, expect, it, vi } from "vitest";
import { callAnthropic, streamAnthropic, AnthropicTransportError } from "@/lib/ai/anthropic-adapter";
import type { GLMCallOptions } from "@/lib/glm";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const KEY = "synthetic-anthropic-key";
const MODEL = "claude-sonnet-4-5";

function abortError(): Error {
    return Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
}

function headersOf(init?: RequestInit): Record<string, string> {
    const headers = new Headers(init?.headers);
    return Object.fromEntries(headers.entries());
}

function jsonMessageResponse(message: Record<string, unknown>): Response {
    return new Response(JSON.stringify(message), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

function syntheticMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: MODEL,
        content: [{ type: "text", text: "Hello, Claude!" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
        ...overrides,
    };
}

function sse(events: Array<Record<string, unknown>>): Response {
    const body = events
        .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        .join("");
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const messageStart = {
    type: "message_start",
    message: syntheticMessage({ content: [] }),
};
const messageDelta = (stopReason: string) => ({
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
});
const messageStop = { type: "message_stop" };

function textOnlyOpts(overrides: Partial<GLMCallOptions> = {}): GLMCallOptions {
    return {
        messages: [
            { role: "system", content: "Be brief." },
            { role: "user", content: "Say hi" },
        ],
        ...overrides,
    };
}

async function collectChunks(opts: GLMCallOptions): Promise<Array<Record<string, unknown>>> {
    const chunks: Array<Record<string, unknown>> = [];
    for await (const chunk of streamAnthropic(opts, KEY, MODEL)) chunks.push(chunk as Record<string, unknown>);
    return chunks;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("callAnthropic", () => {
    it("translates text conversation onto the native messages API and maps the response", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () =>
            jsonMessageResponse(syntheticMessage()),
        );
        vi.stubGlobal("fetch", fetchMock);

        const response = await callAnthropic(
            textOnlyOpts({ temperature: 0.4, max_tokens: 1234 }),
            KEY,
            MODEL,
        );

        expect(response).toEqual({ content: "Hello, Claude!", tool_calls: [], finish_reason: "stop" });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(String(url)).toBe(ENDPOINT);
        const body = JSON.parse(String((init as RequestInit).body)) as Record<string, any>;
        expect(body).toMatchObject({
            model: MODEL,
            max_tokens: 1234,
            temperature: 0.4,
            system: "Be brief.",
            messages: [{ role: "user", content: "Say hi" }],
        });
        // Explicit credential reaches the provider without ever logging it.
        const headers = headersOf(init as RequestInit);
        expect(headers["x-api-key"]).toBe(KEY);
    });

    it("defaults max_tokens, preserves tool ids and JSON schema tools, and maps tool_use responses", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () =>
            jsonMessageResponse(
                syntheticMessage({
                    content: [
                        { type: "text", text: "Checking." },
                        { type: "tool_use", id: "toolu_42", name: "get_weather", input: { city: "Paris" } },
                    ],
                    stop_reason: "tool_use",
                }),
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const opts: GLMCallOptions = {
            messages: [
                { role: "user", content: "Weather in Paris?" },
                {
                    role: "assistant",
                    content: null,
                    tool_calls: [
                        {
                            id: "call_42",
                            type: "function",
                            function: { name: "get_weather", arguments: '{"city":"Paris"}' },
                        },
                    ],
                },
                { role: "tool", tool_call_id: "call_42", name: "get_weather", content: "18C" },
            ],
            tools: [
                {
                    type: "function",
                    function: {
                        name: "get_weather",
                        description: "Current weather",
                        parameters: {
                            type: "object",
                            properties: { city: { type: "string" } },
                            required: ["city"],
                        },
                    },
                },
            ],
            tool_choice: "required",
        };
        const response = await callAnthropic(opts, KEY, MODEL);

        const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, any>;
        expect(body.max_tokens).toBe(2000);
        expect(body.tool_choice).toEqual({ type: "any" });
        expect(body.tools).toEqual([
            {
                name: "get_weather",
                description: "Current weather",
                input_schema: {
                    type: "object",
                    properties: { city: { type: "string" } },
                    required: ["city"],
                },
            },
        ]);
        expect(body.messages).toEqual([
            { role: "user", content: "Weather in Paris?" },
            {
                role: "assistant",
                content: [
                    { type: "tool_use", id: "call_42", name: "get_weather", input: { city: "Paris" } },
                ],
            },
            {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: "call_42", content: "18C" }],
            },
        ]);

        expect(response.content).toBe("Checking.");
        expect(response.finish_reason).toBe("tool_calls");
        expect(response.tool_calls).toEqual([
            {
                id: "toolu_42",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Paris"}' },
            },
        ]);
        expect(JSON.parse(response.tool_calls[0].function.arguments)).toEqual({ city: "Paris" });
    });

    it("translates user image_url blocks to native url and base64 image sources", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () =>
            jsonMessageResponse(syntheticMessage()),
        );
        vi.stubGlobal("fetch", fetchMock);

        await callAnthropic(
            textOnlyOpts({
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Compare" },
                            { type: "image_url", image_url: { url: "https://example.com/a.png" } },
                            {
                                type: "image_url",
                                image_url: { url: "data:image/png;base64,c3ludGhldGlj" },
                            },
                        ],
                    },
                ],
            }),
            KEY,
            MODEL,
        );

        const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, any>;
        expect(body.messages[0].content).toEqual([
            { type: "text", text: "Compare" },
            { type: "image", source: { type: "url", url: "https://example.com/a.png" } },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "c3ludGhldGlj" } },
        ]);
    });

    it("maps every supported tool_choice value", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => jsonMessageResponse(syntheticMessage()));
        vi.stubGlobal("fetch", fetchMock);
        const tools = [
            {
                type: "function" as const,
                function: { name: "t", description: "d", parameters: { type: "object" } },
            },
        ];

        await callAnthropic(textOnlyOpts({ tools, tool_choice: "auto" }), KEY, MODEL);
        await callAnthropic(textOnlyOpts({ tools, tool_choice: "none" }), KEY, MODEL);

        const bodies = fetchMock.mock.calls.map(
            ([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, any>,
        );
        expect(bodies[0].tool_choice).toEqual({ type: "auto" });
        expect(bodies[1].tool_choice).toEqual({ type: "none" });
    });

    it("throws a sanitized AnthropicTransportError on API failure without retrying", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () =>
            new Response(JSON.stringify({ type: "error", error: "secret-provider-body" }), {
                status: 429,
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const error = await callAnthropic(textOnlyOpts(), KEY, MODEL).catch((e) => e);
        expect(error).toBeInstanceOf(AnthropicTransportError);
        expect(error.status).toBe(429);
        expect(error.retryable).toBe(true);
        expect(String(error.message)).not.toContain("secret-provider-body");
        expect(String(error.message)).not.toContain(KEY);
        // maxRetries: 0 — the outer layer owns retries, so exactly one fetch.
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const badRequestFetch = vi.fn<typeof fetch>(async () =>
            new Response(JSON.stringify({ type: "error", error: {} }), {
                status: 400,
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", badRequestFetch);
        const badRequestError = await callAnthropic(textOnlyOpts(), KEY, MODEL).catch((e) => e);
        expect(badRequestError).toBeInstanceOf(AnthropicTransportError);
        expect(badRequestError.status).toBe(400);
        expect(badRequestError.retryable).toBe(false);
    });

    it("cancels through the caller signal and reports a sanitized abort", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
            if ((init as RequestInit).signal?.aborted) throw abortError();
            return jsonMessageResponse(syntheticMessage());
        });
        vi.stubGlobal("fetch", fetchMock);

        const error = await callAnthropic(textOnlyOpts({ signal: controller.signal }), KEY, MODEL).catch((e) => e);
        expect(error).toBeInstanceOf(AnthropicTransportError);
        expect(error.status).toBe(499);
        expect(error.retryable).toBe(false);
    });
});

describe("streamAnthropic", () => {
    it("streams text deltas, omits reasoning deltas, and emits a normalized finish", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () =>
            sse([
                messageStart,
                { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
                { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret chain of thought" } },
                { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
                { type: "content_block_stop", index: 0 },
                { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
                { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hel" } },
                { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "lo" } },
                { type: "content_block_stop", index: 1 },
                messageDelta("end_turn"),
                messageStop,
            ]),
        );
        vi.stubGlobal("fetch", fetchMock);

        const controller = new AbortController();
        const chunks = await collectChunks(textOnlyOpts({ max_tokens: 555, signal: controller.signal }));

        expect(chunks).toEqual([
            { type: "content_delta", delta: "Hel" },
            { type: "content_delta", delta: "lo" },
            { type: "finish", finishReason: "stop", toolCalls: [], content: "Hello" },
        ]);
        const serialized = JSON.stringify(chunks);
        expect(serialized).not.toContain("secret chain of thought");
        expect(serialized).not.toContain("sig");
        // Streaming body uses the stream max_tokens default, signal passes through.
        const [url, init] = fetchMock.mock.calls[0] ?? [];
        expect(String(url)).toBe(ENDPOINT);
        const body = JSON.parse(String((init as RequestInit).body)) as Record<string, any>;
        expect(body.max_tokens).toBe(555);
        expect(body.stream).toBe(true);
        // The SDK merges the caller signal into its own request controller, so
        // identity is not preserved — propagation is asserted by the abort tests.
        expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });

    it("streams partial tool JSON and assembles parsed arguments in finish", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () =>
            sse([
                messageStart,
                {
                    type: "content_block_start",
                    index: 0,
                    content_block: { type: "tool_use", id: "toolu_7", name: "get_weather", input: {} },
                },
                { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"city"' } },
                { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ':"Paris"}' } },
                { type: "content_block_stop", index: 0 },
                messageDelta("tool_use"),
                messageStop,
            ]),
        );
        vi.stubGlobal("fetch", fetchMock);

        const chunks = await collectChunks(textOnlyOpts());

        expect(chunks.slice(0, -1)).toEqual([
            { type: "tool_call_partial", index: 0, id: "toolu_7", name: "get_weather" },
            { type: "tool_call_partial", index: 0, argumentsDelta: '{"city"' },
            { type: "tool_call_partial", index: 0, argumentsDelta: ':"Paris"}' },
        ]);
        const finish = chunks[chunks.length - 1];
        expect(finish.type).toBe("finish");
        expect(finish.finishReason).toBe("tool_calls");
        expect(finish.content).toBe("");
        expect(finish.toolCalls).toEqual([
            {
                id: "toolu_7",
                type: "function",
                function: { name: "get_weather", arguments: '{"city":"Paris"}' },
            },
        ]);
    });

    it("throws a sanitized AnthropicTransportError when the stream request fails", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () =>
            new Response(JSON.stringify({ type: "error", error: "secret-stream-body" }), {
                status: 503,
                headers: { "content-type": "application/json" },
            }),
        );
        vi.stubGlobal("fetch", fetchMock);

        const error = await streamAnthropic(textOnlyOpts(), KEY, MODEL)
            .next()
            .catch((e) => e);
        expect(error).toBeInstanceOf(AnthropicTransportError);
        expect(error.status).toBe(503);
        expect(error.retryable).toBe(true);
        expect(String(error.message)).not.toContain("secret-stream-body");
    });

    it("propagates a caller abort on the streaming path as a sanitized abort", async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
            if ((init as RequestInit).signal?.aborted) throw abortError();
            return sse([messageStart, messageStop]);
        });
        vi.stubGlobal("fetch", fetchMock);

        const error = await streamAnthropic(textOnlyOpts({ signal: controller.signal }), KEY, MODEL)
            .next()
            .catch((e) => e);
        expect(error).toBeInstanceOf(AnthropicTransportError);
        expect(error.status).toBe(499);
        expect(error.retryable).toBe(false);
    });
});
