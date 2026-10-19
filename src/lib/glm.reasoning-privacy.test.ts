import { afterEach, expect, it, vi } from "vitest";
import { callGLM, callGLMStream } from "./glm";

afterEach(() => { vi.unstubAllGlobals(); });
const options = { messages: [{ role: "user" as const, content: "Create my tasks" }], credentials: { zai: "synthetic-test-key" }, fallbacks: [] };

it("does not substitute non-stream reasoning for an empty final answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: null, reasoning_content: "PRIVATE_SYNTHETIC_REASONING" }, finish_reason: "stop" }] }), { status: 200 })));
    const result = await callGLM(options);
    expect(result.content).toBeNull();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SYNTHETIC_REASONING");
});

it("does not emit reasoning-only deltas before the final answer", async () => {
    const deltas = [{ reasoning_content: "PRIVATE_SYNTHETIC_REASONING" }, { content: "Tasks require confirmation." }];
    const body = deltas.map(delta => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`).join("") + "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const chunks = [];
    for await (const chunk of callGLMStream(options)) chunks.push(chunk);
    expect(JSON.stringify(chunks)).not.toContain("PRIVATE_SYNTHETIC_REASONING");
    expect(JSON.stringify(chunks)).toContain("Tasks require confirmation.");
});
