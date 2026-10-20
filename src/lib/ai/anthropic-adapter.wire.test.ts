import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { callAnthropic, streamAnthropic } from "./anthropic-adapter";

const TEST_KEY = "workops-loopback-wire-only";
const originalFetch = globalThis.fetch;
let server: Server;
let origin: string;
let captured: { url: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }[] = [];
let fail = false;

beforeAll(async () => {
    server = createServer(async (request, response) => {
        let text = "";
        for await (const chunk of request) text += chunk;
        const body = JSON.parse(text);
        captured.push({ url: request.url!, headers: request.headers, body });
        if (fail) {
            response.writeHead(401, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ error: { type: "authentication_error", message: `${TEST_KEY} private-prompt-content` } }));
            return;
        }
        const message = { id: "msg_wire", type: "message", role: "assistant", model: "claude-wire-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
        if (body.stream) {
            response.writeHead(200, { "Content-Type": "text/event-stream" });
            const events = [
                { type: "message_start", message },
                { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Wire response" } },
                { type: "content_block_stop", index: 0 },
                { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
                { type: "message_stop" },
            ];
            for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            response.end();
        } else {
            response.writeHead(200, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ ...message, content: [{ type: "text", text: "Wire response" }], stop_reason: "end_turn" }));
        }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
    captured = [];
    fail = false;
    vi.unstubAllGlobals();
});

afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function routeSdkToLoopback() {
    // Exercise the installed SDK's real serialization/parser, but never contact a vendor.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== "https://api.anthropic.com") throw new Error("Unexpected external request");
        return originalFetch(`${origin}${url.pathname}${url.search}`, init);
    });
}

describe("native Anthropic SDK against a loopback server", () => {
    it("sends native Messages headers, system prompt and exact model", async () => {
        routeSdkToLoopback();
        const result = await callAnthropic({ messages: [{ role: "system", content: "Test system" }, { role: "user", content: "Hello" }], max_tokens: 77 }, TEST_KEY, "claude-wire-model");
        expect(result.content).toBe("Wire response");
        expect(captured).toHaveLength(1);
        expect(captured[0].url).toBe("/v1/messages");
        expect(captured[0].headers["x-api-key"]).toBe(TEST_KEY);
        expect(captured[0].headers["anthropic-version"]).toBeTruthy();
        expect(captured[0].body).toMatchObject({ model: "claude-wire-model", system: "Test system", max_tokens: 77, messages: [{ role: "user", content: "Hello" }] });
    });

    it("parses native SSE events through the real SDK", async () => {
        routeSdkToLoopback();
        const chunks = [];
        for await (const chunk of streamAnthropic({ messages: [{ role: "user", content: "Hello" }] }, TEST_KEY, "claude-wire-model")) chunks.push(chunk);
        expect(captured[0].body.stream).toBe(true);
        expect(chunks).toContainEqual({ type: "content_delta", delta: "Wire response" });
        expect(chunks.at(-1)).toMatchObject({ type: "finish", content: "Wire response", finishReason: "stop" });
    });

    it("does not expose a provider's credential-bearing error body", async () => {
        routeSdkToLoopback();
        fail = true;
        await expect(callAnthropic({ messages: [{ role: "user", content: "Hello" }] }, TEST_KEY, "claude-wire-model"))
            .rejects.toMatchObject({ message: "Anthropic API error 401", status: 401, retryable: false });
        expect(captured).toHaveLength(1);
    });
});
