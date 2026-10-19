import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callGLM, callGLMStream, callGLMText, DEFAULT_GLM_MODEL, NUHA_MODEL } from "./glm";
const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
const denial = () => new Response(JSON.stringify({ error: { code: "1113", message: "synthetic failure" } }), { status: 400 });
const streamReply = () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
const messages = [{ role: "user" as const, content: "hello" }];
const models = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model);
describe("explicit provider routing and diagnostic events", () => {
  beforeEach(() => { vi.stubEnv("GLM_API_KEY", "synthetic-zai-credential"); vi.stubEnv("NUHA_API_KEY", "synthetic-nuha-credential"); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  it("uses the shared current default for a no-options automatic call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply()));

    await expect(callGLM({ messages })).resolves.toMatchObject({ content: "ok" });

    expect(models()).toEqual([DEFAULT_GLM_MODEL]);
  });
  it("uses only the selected same-provider fallback, not hidden balance or cross-provider defaults", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(denial()).mockResolvedValueOnce(reply()));
    const result = await callGLM({ messages, model: "glm-5", fallbacks: [{ providerKey: "zai", modelName: "glm-4.7" }] });
    expect(result.content).toBe("ok"); expect(models()).toEqual(["glm-5", "glm-4.7"]);
  });
  it("uses the selected fallback for streamed chat", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(denial()).mockResolvedValueOnce(streamReply()));
    const chunks = []; for await (const chunk of callGLMStream({ messages, model: "glm-5", fallbacks: [{ providerKey: "zai", modelName: "glm-4.7" }] })) chunks.push(chunk);
    expect(models()).toEqual(["glm-5", "glm-4.7"]); expect(chunks.at(-1)).toMatchObject({ type: "finish", content: "ok" });
  });
  it.each([false, true])("records secret-free request/failure/fallback/response events (stream=%s)", async (stream) => {
    const events: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "1113", message: "Bearer synthetic-sensitive-body" } }), { status: 400 })).mockResolvedValueOnce(stream ? streamReply() : reply()));
    const options = { messages, model: "glm-5", fallbacks: [{ providerKey: "nuha" as const, modelName: "Nuha-2.1" }], onDiagnostic: (event: unknown) => { events.push(event); } };
    if (stream) { for await (const _ of callGLMStream(options)) { /* drain */ } } else { await callGLM(options); }
    expect(events).toMatchObject([
      { event: "request", provider: "zai", model: "glm-5", attempt: 1 },
      { event: "error", provider: "zai", status: 400, attempt: 1 },
      { event: "fallback", provider: "nuha", model: "Nuha-2.1", attempt: 2 },
      { event: "request", provider: "nuha", model: "Nuha-2.1", attempt: 2 },
      { event: "response", provider: "nuha", status: 200, attempt: 2 },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/synthetic-sensitive-body|synthetic-zai-credential|synthetic-nuha-credential|hello|Bearer/);
  });
  it("forwards explicit routing and diagnostics through text-only calls", async () => {
    const onDiagnostic = vi.fn(); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(denial()).mockResolvedValueOnce(reply()));
    await expect(callGLMText("hello", { model: "glm-5", fallbacks: [{ providerKey: "zai", modelName: "glm-4.7" }], onDiagnostic })).resolves.toBe("ok");
    expect(models()).toEqual(["glm-5", "glm-4.7"]); expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ event: "response", model: "glm-4.7" }));
  });
  it("uses Nuha's default model for text calls with explicit fallbacks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply()));
    await expect(callGLMText("x", { provider: "nuha", fallbacks: [] })).resolves.toBe("ok");
    expect(models()).toEqual([NUHA_MODEL]);
  });
  it("stops an in-flight explicit stream immediately on AbortError cancellation", async () => {
    const controller = new AbortController();
    const abortError = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    const events: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("test signal missing");
      if (signal.aborted) throw abortError;
      await new Promise<never>((_, reject) => {
        signal.addEventListener("abort", () => reject(abortError), { once: true });
        queueMicrotask(() => controller.abort());
      });
      throw abortError;
    });
    vi.stubGlobal("fetch", fetchMock);
    const chunks: unknown[] = [];
    for await (const chunk of callGLMStream({ provider: "zai", model: "glm-5", messages, fallbacks: [], signal: controller.signal, onDiagnostic: (event) => { events.push(event); } })) chunks.push(chunk);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(chunks.at(-1)).toMatchObject({ type: "error" });
    expect(events).toMatchObject([
      { event: "request", provider: "zai", model: "glm-5", attempt: 1 },
      { event: "error", provider: "zai", model: "glm-5", attempt: 1, message: "Request cancelled" },
    ]);
    expect(events).toHaveLength(2);
  });
  it("records one sanitized stream error after headers without falling back after output", async () => {
    const events: unknown[] = [];
    const reader = {
      read: vi.fn()
        .mockResolvedValueOnce({ value: 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', done: false })
        .mockRejectedValueOnce(new Error("provider-secret-reader-failure")),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const streamResponse = { ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => reader }) } } as unknown as Response;
    const fetchMock = vi.fn<typeof fetch>(async () => streamResponse);
    vi.stubGlobal("fetch", fetchMock);
    const chunks: unknown[] = [];
    for await (const chunk of callGLMStream({
      messages,
      model: "glm-5",
      fallbacks: [{ providerKey: "nuha", modelName: NUHA_MODEL }],
      onDiagnostic: (event) => { events.push(event); },
    })) chunks.push(chunk);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(chunks.map((chunk) => (chunk as { type: string }).type)).toEqual(["content_delta", "error"]);
    expect(events).toMatchObject([
      { event: "request", provider: "zai", model: "glm-5", attempt: 1 },
      { event: "response", provider: "zai", model: "glm-5", attempt: 1, status: 200 },
      { event: "error", provider: "zai", model: "glm-5", attempt: 1, message: "Provider stream failed" },
    ]);
    expect(events.filter((event) => (event as { event?: string }).event === "error")).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("provider-secret-reader-failure");
  });
});
