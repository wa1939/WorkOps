import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGLM, callGLMStream, callGLMText, callGLMVision, NUHA_MODEL } from "./glm";

const response = (): Response => new Response(JSON.stringify({
    choices: [{ message: { content: "vision-ready" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
}), { status: 200, headers: { "content-type": "application/json" } });

function record(value: unknown, label: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} is malformed`);
    return Object.fromEntries(Object.entries(value));
}

describe("GLM-5.3-Flash vision provider", () => {
    beforeEach(() => {
        process.env.GLM_API_KEY = "test-glm-key";
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => response()));
    });

    afterEach(() => {
        delete process.env.GLM_API_KEY;
        vi.unstubAllGlobals();
    });

    it("sends the documented native image content block and model code", async () => {
        await expect(callGLMVision("Describe this image", ["data:image/png;base64,AA=="])).resolves.toBe("vision-ready");
        const fetchMock = vi.mocked(fetch);
        const init = fetchMock.mock.calls[0]?.[1];
        if (!init || typeof init.body !== "string") throw new Error("vision request body was not captured");
        const request = record(JSON.parse(init.body), "vision request");
        expect(request.model).toBe("glm-5.3-flash");
        const messages = request.messages;
        if (!Array.isArray(messages)) throw new Error("vision messages are malformed");
        const message = record(messages[0], "vision message");
        const content = message.content;
        if (!Array.isArray(content)) throw new Error("vision content blocks are missing");
        expect(content).toEqual([
            { type: "text", text: "Describe this image" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
        ]);
    });

    it("rejects missing, unsafe, or over-bounded image input before calling the provider", async () => {
        await expect(callGLMVision("Describe", [])).rejects.toThrow(/image input/i);
        await expect(callGLMVision("Describe", ["http://example.test/image.png"])).rejects.toThrow(/image input/i);
        await expect(callGLMVision("Describe", ["data:image/png;base64," + "A".repeat(2_000_000)])).rejects.toThrow(/image input/i);
        await expect(callGLMVision(" ", ["data:image/png;base64,AA=="])).rejects.toThrow(/prompt/i);
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });
});

describe("explicit thinking request option", () => {
    beforeEach(() => {
        process.env.GLM_API_KEY = "test-glm-key";
        process.env.NUHA_API_KEY = "sk-nuha-test.key";
    });

    afterEach(() => {
        delete process.env.GLM_API_KEY;
        delete process.env.NUHA_API_KEY;
        vi.unstubAllGlobals();
    });

    it("serializes explicit thinking for structured JSON calls to ZAI", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => response());
        vi.stubGlobal("fetch", fetchMock);

        await expect(callGLM({
            messages: [{ role: "user", content: "structured request" }],
            fallbacks: [],
            thinking: "enabled",
        })).resolves.toMatchObject({ content: "vision-ready" });

        const body = record(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), "structured request body");
        expect(body.thinking).toEqual({ type: "enabled" });
    });

    it("forwards explicit thinking through text-only calls to ZAI", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => response());
        vi.stubGlobal("fetch", fetchMock);

        await expect(callGLMText("text-only request", { fallbacks: [], thinking: "disabled" })).resolves.toBe("vision-ready");

        const body = record(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), "text-only request body");
        expect(body.thinking).toEqual({ type: "disabled" });
    });

    it("does not send the ZAI-only thinking field to Nuha", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
            choices: [{ message: { content: "nuha-reply" }, finish_reason: "stop" }],
        }), { status: 200 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(callGLMText("nuha text-only request", {
            provider: "nuha",
            model: NUHA_MODEL,
            credentials: { nuha: "sk-nuha-test.key" },
            fallbacks: [],
            thinking: "disabled",
        })).resolves.toBe("nuha-reply");

        const body = record(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)), "Nuha request body");
        expect(body.thinking).toBeUndefined();
        expect(body.max_completion_tokens).toBe(2000);
    });
});

describe("Nuha-2.1 provider", () => {
    const nuhaResponse = () => new Response(JSON.stringify({
        choices: [{ message: { content: "nuha-reply" }, finish_reason: "stop" }],
    }), { status: 200, headers: { "content-type": "application/json" } });

    beforeEach(() => {
        process.env.GLM_API_KEY = "test-glm-key";
        process.env.NUHA_API_KEY = "sk-nuha-test.key";
    });

    afterEach(() => {
        delete process.env.GLM_API_KEY;
        delete process.env.NUHA_API_KEY;
        vi.unstubAllGlobals();
    });

    it("falls back to Nuha when the GLM provider keeps failing", async () => {
        const fetchMock = vi.fn<typeof fetch>(async (url) => {
            if (String(url).includes("nuhagf.llmtests.org")) return nuhaResponse();
            return new Response(JSON.stringify({ error: { code: "server_error" } }), { status: 500 });
        });
        vi.stubGlobal("fetch", fetchMock);

        const result = await callGLM({ messages: [{ role: "user", content: "hi" }] });

        expect(result.content).toBe("nuha-reply");
        const nuhaCall = fetchMock.mock.calls.find(([url]) => String(url).includes("nuhagf.llmtests.org"))!;
        expect(String(nuhaCall[0])).toBe("https://nuhagf.llmtests.org/v1/chat/completions");
        const body = record(JSON.parse(String((nuhaCall[1] as RequestInit).body)), "nuha body");
        expect(body.model).toBe(NUHA_MODEL);
        expect(body.max_completion_tokens).toBe(2000);
        expect(body.max_tokens).toBeUndefined();
        expect(record((nuhaCall[1] as RequestInit).headers, "headers").Authorization).toBe("Bearer sk-nuha-test.key");
    });

    it("uses Nuha as the primary when the admin assignment selects it", async () => {
        const fetchMock = vi.fn<typeof fetch>(async () => nuhaResponse());
        vi.stubGlobal("fetch", fetchMock);

        const result = await callGLM({ provider: "nuha", model: "Nuha-2.1", messages: [{ role: "user", content: "hi" }] });

        expect(result.content).toBe("nuha-reply");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toContain("nuhagf.llmtests.org");
    });

    it("uses an explicit stored credential for the primary provider request", async () => {
        const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
            expect(new Headers(init?.headers).get("authorization")).toBe("Bearer stored-zai-key");
            return response();
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(callGLM({ provider: "zai", credentials: { zai: "stored-zai-key" }, messages: [{ role: "user", content: "hi" }] }))
            .resolves.toMatchObject({ content: "vision-ready" });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("forwards text-call credentials to the assigned provider", async () => {
        const credential = ["synthetic", "runtime", "value"].join("-");
        const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
            expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${credential}`);
            return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(callGLMText("hello", { provider: "nuha", model: "Nuha-2.1", credentials: { nuha: credential } })).resolves.toBe("ok");
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("keeps the hard failure when no Nuha key is configured", async () => {
        delete process.env.NUHA_API_KEY;
        const fetchMock = vi.fn<typeof fetch>(async () => new Response("boom", { status: 500 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(callGLM({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/zai API error 500/);
        expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("nuhagf"))).toBe(true);
    });

    it("does not concatenate a fallback after a stream has emitted a delta", async () => {
        let sent = false;
        const streamResponse = () => new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent) {
                    controller.error(new Error("reader failed after output"));
                    return;
                }
                sent = true;
                controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'));
            },
        }), { status: 200 });
        const fetchMock = vi.fn<typeof fetch>(async (url) => String(url).includes("z.ai")
            ? streamResponse()
            : nuhaResponse());
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.map((chunk) => chunk.delta).filter(Boolean)).toEqual(["partial"]);
        expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("nuhagf"))).toBe(true);
        expect(chunks.at(-1).type).toBe("error");
    });

    it("tries Nuha after insufficient-balance fallback fails before emitting", async () => {
        const streamResponse = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "application/json" } });
        const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            if (String(url).includes("z.ai") && body.model === "glm-5") return streamResponse(402, JSON.stringify({ error: { code: "1113" } }));
            if (String(url).includes("z.ai")) return streamResponse(500, "fallback failed");
            return streamResponse(200, 'data: {"choices":[{"delta":{"content":"nuha"}}]}\n\ndata: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\n');
        });
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.some((chunk) => chunk.delta === "nuha")).toBe(true);
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes("nuhagf"))).toBe(true);
    });

    it("cancels and releases the provider reader when streaming fails", async () => {
        delete process.env.NUHA_API_KEY;
        const cancel = vi.fn(async () => undefined);
        const releaseLock = vi.fn();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ value: 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', done: false })
                .mockRejectedValueOnce(new Error("reader failed")),
            cancel,
            releaseLock,
        };
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => ({
            ok: true,
            status: 200,
            body: { pipeThrough: () => ({ getReader: () => reader }) },
        } as unknown as Response)));

        const chunks = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);

        expect(chunks.at(-1)).toMatchObject({ type: "error" });
        expect(cancel).toHaveBeenCalledOnce();
        expect(releaseLock).toHaveBeenCalledOnce();
    });

    const stream = (frames: string[], options?: { cancel?: ReturnType<typeof vi.fn>; releaseLock?: ReturnType<typeof vi.fn> }) => {
        const cancel = options?.cancel ?? vi.fn(async () => undefined);
        const releaseLock = options?.releaseLock ?? vi.fn();
        const bytes = new TextEncoder().encode(frames.join(""));
        return {
            response: new Response(new ReadableStream<Uint8Array>({
                start(controller) { controller.enqueue(bytes); controller.close(); },
            }), { status: 200 }),
            cancel,
            releaseLock,
        };
    };

    it("rejects an unterminated provider frame before it exceeds 256 KiB and does not finish", async () => {
        delete process.env.NUHA_API_KEY;
        const cancel = vi.fn(async () => undefined);
        const releaseLock = vi.fn();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ value: "data: " + "x".repeat(256 * 1024), done: false })
                .mockResolvedValueOnce({ value: undefined, done: true }),
            cancel,
            releaseLock,
        };
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => reader }) } } as unknown as Response)));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toMatchObject({ type: "error" });
        expect(chunks[0].message).toBe("GLM stream frame exceeds 256 KiB");
        expect(cancel).toHaveBeenCalledOnce();
        expect(releaseLock).toHaveBeenCalledOnce();
    });

    it("processes many individually bounded SSE frames from one large provider read", async () => {
        const frames = [
            ...Array.from({ length: 300 }, () => `comment: ${"x".repeat(1024)}\n\n`),
            ...Array.from({ length: 300 }, (_, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: "a" } }] })}\n\n`),
        ];
        frames.push(`data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`);
        const fetchMock = vi.fn<typeof fetch>(async () => stream(frames).response);
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.filter((chunk) => chunk.type === "content_delta")).toHaveLength(300);
        expect(chunks.at(-1)).toMatchObject({ type: "finish" });
    });

    it.each(["\n\n", "\r\n\r\n", "\r\r"] as const)("assembles provider events with %j delimiters split across reads", async (delimiter) => {
        delete process.env.NUHA_API_KEY;
        const wire = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: "one" } }] })}${delimiter}`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "two" } }] })}${delimiter}`,
            `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}${delimiter}`,
        ].join("");
        const chunks = Array.from({ length: wire.length }, (_, index) => wire.slice(index, index + 1));
        const reader = {
            read: vi.fn(async () => {
                const value = chunks.shift();
                return value === undefined ? { value: undefined, done: true } : { value, done: false };
            }),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        };
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => reader }) } } as unknown as Response)));
        const output: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) output.push(chunk);
        expect(output.map((chunk) => chunk.type === "content_delta" ? chunk.delta : chunk.type)).toEqual(["one", "two", "finish"]);
        expect(output.at(-1)).toMatchObject({ type: "finish", content: "onetwo", finishReason: "stop" });
    });

    it("assembles a large one-byte provider frame without quadratic encoding work", async () => {
        delete process.env.NUHA_API_KEY;
        const content = "ok";
        // 48 KiB still forces tens of thousands of one-character reads while keeping CI fast;
        // the linear TextEncoder input assertion catches the old per-read whole-buffer encoding.
        const wire = `comment: ${"x".repeat(48 * 1024)}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`;
        const pieces = Array.from({ length: wire.length }, (_, index) => wire.slice(index, index + 1));
        const reader = {
            read: vi.fn(async () => {
                const value = pieces.shift();
                return value === undefined ? { value: undefined, done: true } : { value, done: false };
            }),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        };
        const encode = vi.spyOn(TextEncoder.prototype, "encode");
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => ({ ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => reader }) } } as unknown as Response)));
        const output: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) output.push(chunk);
        const encodedInputLength = encode.mock.calls.reduce((total, [value]) => total + (value?.length ?? 0), 0);
        expect(output.at(-1)).toMatchObject({ type: "finish", content });
        expect(encodedInputLength).toBeLessThan(wire.length * 20);
        encode.mockRestore();
    });

    it("enforces the shared UTF-8 content cap before yielding an offending delta", async () => {
        const exact = "é".repeat(32 * 1024);
        const over = `${exact}x`;
        const frames = [
            `data: ${JSON.stringify({ choices: [{ delta: { content: exact } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
        ];
        const fetchMock = vi.fn<typeof fetch>(async () => stream(frames).response);
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.filter((chunk) => chunk.type === "content_delta").map((chunk) => [chunk.delta.length, new TextEncoder().encode(chunk.delta).byteLength])).toEqual([[exact.length, 65536]]);
        expect(chunks.at(-1)).toMatchObject({ type: "error" });
        expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
        expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("nuhagf"))).toBe(true);

        const exactAscii = "a".repeat(64 * 1024);
        const accepted = stream([`data: ${JSON.stringify({ choices: [{ delta: { content: exactAscii } }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`]);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => accepted.response));
        const acceptedChunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) acceptedChunks.push(chunk);
        expect(acceptedChunks.at(-1)).toMatchObject({ type: "finish", content: exactAscii });
        expect(new TextEncoder().encode(over).byteLength).toBe(65537);
    });

    it("rejects tool argument overflow and invalid or excessive partial calls", async () => {
        delete process.env.NUHA_API_KEY;
        const fragmented = stream([
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "id", function: { name: "fn", arguments: "a".repeat(60 * 1024) } }] } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "b".repeat(4 * 1024 + 1) } }] } }] })}\n\n`,
        ]);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => fragmented.response));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.map((chunk) => chunk.type)).toEqual(["tool_call_partial", "error"]);
        expect(chunks.at(-1)).toMatchObject({ type: "error" });
        expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);

        for (const toolCalls of [
            [{ index: -1 }],
            [{ index: 0, id: " ".repeat(129) }],
            Array.from({ length: 26 }, (_, index) => ({ index })),
        ]) {
            const invalid = stream([`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: toolCalls } }] })}\n\n`]);
            vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => invalid.response));
            const invalidChunks: any[] = [];
            for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) invalidChunks.push(chunk);
            expect(invalidChunks.at(-1)).toMatchObject({ type: "error" });
        }
    });

    it("uses cross-provider fallback after a bound failure before any safe output", async () => {
        const invalid = stream([`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: -1 }] } }] })}\n\n`]);
        const nuha = stream([
            `data: ${JSON.stringify({ choices: [{ delta: { content: "nuha" } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
        ]);
        const fetchMock = vi.fn<typeof fetch>(async (url) => String(url).includes("nuhagf") ? nuha.response : invalid.response);
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.some((chunk) => chunk.delta === "nuha")).toBe(true);
        expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
        expect(fetchMock.mock.calls.some(([url]) => String(url).includes("nuhagf"))).toBe(true);
    });

    it("accepts an exact 256 KiB aggregate, then rejects one more byte without finishing or falling back", async () => {
        delete process.env.NUHA_API_KEY;
        const calls = [
            ...Array.from({ length: 4 }, (_, index) => ({ index, id: `id-${index}`, function: { name: "fn", arguments: "a".repeat(64 * 1024) } })),
            { index: 4, id: "id-4", function: { name: "fn", arguments: "b" } },
        ];
        const responseData = stream(calls.map((call) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`));
        const fetchMock = vi.fn<typeof fetch>(async () => responseData.response);
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.filter((chunk) => chunk.type === "tool_call_partial")).toHaveLength(4);
        expect(chunks.at(-1)).toMatchObject({ type: "error", message: "GLM stream tool arguments exceed 256 KiB" });
        expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
        expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("nuhagf"))).toBe(true);
    });

    const runtimeTypeCases = [
        ...(["content", "reasoning_content"] as const).flatMap((field) =>
            ([{}, 7, false, []] as const).map((value) => ({ field, value }))),
    ];

    it.each(runtimeTypeCases)("rejects non-string $field without coercion or finish", async ({ field, value }) => {
        delete process.env.NUHA_API_KEY;
        const responseData = stream([
            `data: ${JSON.stringify({ choices: [{ delta: { [field]: value } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
        ]);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => responseData.response));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.filter((chunk) => chunk.type === "content_delta")).toHaveLength(0);
        expect(chunks.some((chunk) => chunk.type === "finish")).toBe(false);
        expect(chunks.at(-1)).toMatchObject({ type: "error", retryable: false });
        expect(chunks.at(-1).message).not.toContain("[object Object]");
        expect(chunks.at(-1).message.length).toBeLessThanOrEqual(512);
    });

    it("treats null content as absent while accepting reasoning and tool deltas", async () => {
        delete process.env.NUHA_API_KEY;
        const responseData = stream([
            `data: ${JSON.stringify({ choices: [{ delta: { content: null, reasoning_content: "reason", tool_calls: [{ index: 0, id: "id", function: { name: "fn", arguments: "{}" } }] } }] })}\n\n`,
            `data: ${JSON.stringify({ choices: [{ finish_reason: "stop", delta: {} }] })}\n\n`,
        ]);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => responseData.response));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.map((chunk) => chunk.type)).toEqual(["tool_call_partial", "finish"]);
        expect(JSON.stringify(chunks)).not.toContain('"reason"');
        expect(chunks.at(-1)).toMatchObject({ content: "", toolCalls: [{ id: "id", function: { name: "fn", arguments: "{}" } }] });
    });

    it.each(["id", "name", "arguments"] as const)("rejects non-string tool $field before partial output", async (field) => {
        delete process.env.NUHA_API_KEY;
        const tool = { index: 0, id: "id", function: { name: "fn", arguments: "{}" } } as Record<string, unknown>;
        if (field === "id") tool.id = 5;
        if (field === "name") (tool.function as Record<string, unknown>).name = {};
        if (field === "arguments") (tool.function as Record<string, unknown>).arguments = false;
        const responseData = stream([`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [tool] } }] })}\n\n`]);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => responseData.response));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.filter((chunk) => chunk.type === "tool_call_partial")).toHaveLength(0);
        expect(chunks.at(-1)).toMatchObject({ type: "error" });
    });

    it.each([
        { label: "choices", body: { choices: {} } },
        { label: "choice", body: { choices: [[]] } },
        { label: "delta", body: { choices: [{ delta: [] }] } },
        { label: "tool_calls", body: { choices: [{ delta: { tool_calls: {} } }] } },
        { label: "function", body: { choices: [{ delta: { tool_calls: [{ index: 0, function: [] }] } }] } },
        { label: "null function", body: { choices: [{ delta: { tool_calls: [{ index: 0, function: null }] } }] } },
    ])("rejects malformed runtime $label shape", async ({ body }) => {
        delete process.env.NUHA_API_KEY;
        const responseData = stream([`data: ${JSON.stringify(body)}\n\n`]);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => responseData.response));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.at(-1)).toMatchObject({ type: "error", retryable: false });
        expect(chunks.at(-1).message.length).toBeLessThanOrEqual(512);
    });

    it("cancels and releases a non-OK reader that rejects after a secret-bearing prefix", async () => {
        delete process.env.NUHA_API_KEY;
        const secret = new TextEncoder().encode("secret-prefix");
        const cancel = vi.fn(async () => undefined);
        const releaseLock = vi.fn();
        const reader = {
            read: vi.fn().mockResolvedValueOnce({ value: secret, done: false }).mockRejectedValueOnce(new Error("secret-reader-failure")),
            cancel,
            releaseLock,
        };
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => ({ ok: false, status: 400, body: { getReader: () => reader } } as unknown as Response)));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(cancel).toHaveBeenCalledOnce();
        expect(releaseLock).toHaveBeenCalledOnce();
        expect(chunks.at(-1)).toMatchObject({ type: "error", message: "zai stream error 400 (glm-5.3-flash)", retryable: false });
        expect(chunks.at(-1).message).not.toContain("secret");
    });

    it("bounds reader failures without leaking a repeated marker", async () => {
        process.env.NUHA_API_KEY = "sk-nuha-test.key";
        const marker = "secret-marker-".repeat(1000);
        const makeResponse = () => ({ ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => ({ read: vi.fn().mockRejectedValue(new Error(marker)), cancel: vi.fn(), releaseLock: vi.fn() }) }) } } as unknown as Response);
        vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => makeResponse()));
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.at(-1).type).toBe("error");
        expect(chunks.at(-1).message.length).toBeLessThanOrEqual(512);
        expect(chunks.at(-1).message).not.toBe(marker);
    });

    it("bounds failures after safe output without falling back or concatenating", async () => {
        process.env.NUHA_API_KEY = "sk-nuha-test.key";
        const marker = "after-output-secret-".repeat(1000);
        const responseData = { ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => ({ read: vi.fn().mockResolvedValueOnce({ value: `data: ${JSON.stringify({ choices: [{ delta: { content: "safe" } }] })}\n\n` }).mockRejectedValueOnce(new Error(marker)), cancel: vi.fn(), releaseLock: vi.fn() }) }) } } as unknown as Response;
        const fetchMock = vi.fn<typeof fetch>(async () => responseData);
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.map((chunk) => chunk.type)).toEqual(["content_delta", "error"]);
        expect(chunks.at(-1).message.length).toBeLessThanOrEqual(512);
        expect(chunks.at(-1).message).not.toBe(marker);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("bounds non-OK stream bodies, cancels and releases the reader, and never leaks body text", async () => {
        delete process.env.NUHA_API_KEY;
        const prefix = "provider-secret-prefix";
        const marker = "provider-secret-marker";
        const first = new TextEncoder().encode(prefix);
        const second = new TextEncoder().encode(marker + "x".repeat(1024 * 1024));
        let consumed = 0;
        const cancel = vi.fn(async () => undefined);
        const releaseLock = vi.fn();
        const reader = {
            read: vi.fn()
                .mockImplementationOnce(async () => { consumed += first.byteLength; return { value: first, done: false }; })
                .mockImplementationOnce(async () => { consumed += second.byteLength; return { value: second, done: false }; }),
            cancel,
            releaseLock,
        };
        const fetchMock = vi.fn<typeof fetch>(async () => ({ ok: false, status: 400, body: { getReader: () => reader } } as unknown as Response));
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(consumed).toBeLessThanOrEqual(4096 + second.byteLength);
        expect(reader.read).toHaveBeenCalledTimes(2);
        expect(cancel).toHaveBeenCalledOnce();
        expect(releaseLock).toHaveBeenCalledOnce();
        expect(chunks.at(-1)).toMatchObject({ type: "error", message: "zai stream error 400 (glm-5.3-flash)", retryable: false });
        expect(chunks.at(-1).message).not.toContain(prefix);
        expect(chunks.at(-1).message).not.toContain(marker);
        expect(chunks.at(-1).message.length).toBeLessThanOrEqual(512);
    });

    it("uses bounded JSON error code 1113 without exposing the provider message", async () => {
        delete process.env.NUHA_API_KEY;
        const responseData = new Response(JSON.stringify({ error: { code: "1113", message: "secret" } }), { status: 402 });
        const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
            const body = JSON.parse(String((init as RequestInit).body));
            if (String(url).includes("z.ai") && body.model === "glm-5") return responseData;
            return new Response("fallback", { status: 500 });
        });
        vi.stubGlobal("fetch", fetchMock);
        const chunks: any[] = [];
        for await (const chunk of callGLMStream({ messages: [{ role: "user", content: "hi" }] })) chunks.push(chunk);
        expect(chunks.at(-1).type).toBe("error");
        expect(chunks.at(-1).message).toContain("zai stream error");
        expect(chunks.at(-1).message).not.toContain("secret");
        expect(fetchMock).toHaveBeenCalled();
    });
});
