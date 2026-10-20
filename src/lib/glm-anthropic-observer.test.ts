import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("./ai/anthropic-adapter", async (importOriginal) => ({ ...await importOriginal<typeof import("./ai/anthropic-adapter")>(), streamAnthropic: mocked.stream }));
import { callGLMStream, type GLMDiagnosticEvent } from "./glm";
import { AnthropicTransportError } from "./ai/anthropic-adapter";
afterEach(() => vi.clearAllMocks());
const options = (events: GLMDiagnosticEvent[]) => ({ provider: "anthropic" as const, model: "operator-claude", credentials: { anthropic: "synthetic-private-key" }, fallbacks: [], messages: [{ role: "user" as const, content: "private fixture prompt" }], onDiagnostic: (event: GLMDiagnosticEvent) => { events.push(event); } });

describe("native Anthropic stream diagnostics", () => {
    it("records exactly one error when the provider rejects before producing output", async () => {
        mocked.stream.mockImplementation(async function* () { throw new AnthropicTransportError("Anthropic API error 401", 401, false); });
        const events: GLMDiagnosticEvent[] = [];
        for await (const _ of callGLMStream(options(events))) { /* drain the sanitized failure */ }
        expect(events.map(event => event.event)).toEqual(["request", "error"]);
        expect(events.at(-1)).toMatchObject({ status: 401 });
    });
    it("records request and response metadata around the first stream result", async () => {
        mocked.stream.mockImplementation(async function* () { yield { type: "content_delta", delta: "answer" }; yield { type: "finish", finishReason: "stop", toolCalls: [], content: "answer" }; });
        const events: GLMDiagnosticEvent[] = [];
        const chunks = []; for await (const chunk of callGLMStream(options(events))) chunks.push(chunk);
        expect(chunks.at(-1)).toMatchObject({ type: "finish" });
        expect(events.map(event => event.event)).toEqual(["request", "response"]);
        expect(events[0]).toMatchObject({ provider: "anthropic", model: "operator-claude" });
        expect(JSON.stringify(events)).not.toMatch(/private fixture|synthetic-private-key/);
    });
    it("records a sanitized error after a partial stream and never restarts after output", async () => {
        mocked.stream.mockImplementation(async function* () { yield { type: "content_delta", delta: "partial" }; throw new AnthropicTransportError("Anthropic API error 500", 500, true); });
        const events: GLMDiagnosticEvent[] = [];
        const chunks = []; for await (const chunk of callGLMStream(options(events))) chunks.push(chunk);
        expect(chunks.map(chunk => chunk.type)).toEqual(["content_delta", "error"]);
        expect(events.map(event => event.event)).toEqual(["request", "response", "error"]);
        expect(events.at(-1)).toMatchObject({ provider: "anthropic", status: 500 });
        expect(mocked.stream).toHaveBeenCalledTimes(1);
    });
});
