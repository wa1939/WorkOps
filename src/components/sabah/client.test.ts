import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSabahClient, SabahClientError, SabahAbortedError, type SabahChatStreamEvent } from "./client";

const workflowSnapshot = {
    id: "wf-1",
    goal: "Create project",
    status: "RUNNING",
    actorId: "user-1",
    steps: [
        {
            id: "step-1",
            clientStepId: "s1",
            capability: "projects.create",
            status: "VERIFIED",
            dependsOn: [],
            confidence: 0.95,
        },
    ],
    approvals: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sseResponse(events: unknown[]): Response {
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
    });
}

function controlledSseResponse() {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"type":"token","delta":"Hi"}\n\n'));
            await gate;
            controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
            controller.close();
        },
    });
    return { response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }), release };
}

function closedSseResponse(frame: string) {
    let cancelCount = 0;
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(frame));
            controller.close();
        },
        cancel() {
            cancelCount += 1;
        },
    });
    return { response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }), getCancelCount: () => cancelCount };
}

function openSseResponse(frame: string) {
    let cancelCount = 0;
    let resolveCanceled!: () => void;
    const canceled = new Promise<void>((resolve) => { resolveCanceled = resolve; });
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(frame));
        },
        cancel() {
            cancelCount += 1;
            resolveCanceled();
        },
    });
    return { response: new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }), canceled, getCancelCount: () => cancelCount };
}

describe("SabahClient.getWorkflow", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns a parsed workflow snapshot on ok", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(workflowSnapshot));
        const client = createSabahClient();
        const result = await client.getWorkflow("wf-1");
        expect(result.id).toBe("wf-1");
    });

    it("lists parsed workflows for the active conversation", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ workflows: [workflowSnapshot] }));
        const client = createSabahClient();

        const result = await client.listWorkflows("conv-123");

        expect(result).toEqual([{ ...workflowSnapshot, steps: [{ ...workflowSnapshot.steps[0], entityLinks: [] }] }]);
        expect(fetch).toHaveBeenCalledWith(
            "/api/ai/workflows?conversationId=conv-123&limit=20",
            expect.objectContaining({ method: "GET" })
        );
    });

    it("uses the chat SSE contract and assembles the streamed reply", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "conversation", id: "conv-123" },
            { type: "token", delta: "Hello " },
            { type: "token", delta: "from Sabah" },
            { type: "done" },
        ]));
        const client = createSabahClient();
        const result = await client.sendMessage("conv-prior", "Help me", { history: [{ role: "assistant", content: "Earlier context" }] });
        expect(result).toEqual({ conversationId: "conv-123", reply: "Hello from Sabah" });
        const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe("/api/ai/chat");
        expect(JSON.parse(String(init.body))).toEqual({ message: "Help me", history: [{ role: "assistant", content: "Earlier context" }], conversationId: "conv-prior" });
    });

    it.each(["\n\n", "\r\n\r\n", "\r\r"] as const)("assembles chat events with %j delimiters split across reads", async (delimiter) => {
        const wire = [
            `data: ${JSON.stringify({ type: "token", delta: "one" })}${delimiter}`,
            `data: ${JSON.stringify({ type: "token", delta: "two" })}${delimiter}`,
            `data: ${JSON.stringify({ type: "done" })}${delimiter}`,
        ].join("");
        const bytes = new TextEncoder().encode(wire);
        let index = 0;
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (index >= bytes.length) { controller.close(); return; }
                controller.enqueue(bytes.slice(index, index + 1));
                index += 1;
            },
        });
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } }));
        const callbacks: SabahChatStreamEvent[] = [];
        await expect(createSabahClient().sendMessage(null, "Help me", { onEvent: (event) => callbacks.push(event) })).resolves.toEqual({ conversationId: null, reply: "onetwo" });
        expect(callbacks).toEqual([{ type: "token", delta: "one" }, { type: "token", delta: "two" }, { type: "done" }]);
    });

    it("calls typed callbacks before the pending stream completes and preserves tool order", async () => {
        const callbacks: SabahChatStreamEvent[] = [];
        const controlled = controlledSseResponse();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(controlled.response);
        const client = createSabahClient();
        const pending = client.sendMessage(null, "Help me", { onEvent: (event) => callbacks.push(event) });
        await vi.waitFor(() => expect(callbacks).toEqual([{ type: "token", delta: "Hi" }]));
        expect(await Promise.race([pending.then(() => "done"), Promise.resolve("pending")])).toBe("pending");
        controlled.release();
        await expect(pending).resolves.toEqual({ conversationId: null, reply: "Hi" });

        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "tool_start", id: "tool-1", name: "Search" },
            { type: "tool_result", id: "tool-1", name: "Search", params: { secret: "do not retain" }, result: { ok: true, data: "Found it" } },
            { type: "limit", reason: "tool_calls" },
            { type: "compression", status: "pending" },
            { type: "done" },
        ]));
        callbacks.length = 0;
        await client.sendMessage(null, "Search", { onEvent: (event) => callbacks.push(event) });
        expect(callbacks).toEqual([
            { type: "tool_start", id: "tool-1", name: "Search" },
            { type: "tool_result", id: "tool-1", name: "Search", params: { secret: "do not retain" }, result: { ok: true, data: "Found it" } },
            { type: "limit", reason: "tool_calls" },
            { type: "compression", status: "pending" },
            { type: "done" },
        ]);
    });

    it("rejects malformed tool events before invoking the callback", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "tool_result", id: "tool-1", name: "Search", params: {}, result: { ok: true, error: "not strict" } },
        ]));
        const onEvent = vi.fn();
        await expect(createSabahClient().sendMessage(null, "Search", { onEvent })).rejects.toMatchObject({ message: "Malformed response stream" });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it.each(["", "   "])("rejects an exact route-shaped tool_result with an empty error before callback: %j", async (error) => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "tool_result", id: "tool-1", name: "Search", params: {}, result: { ok: false, error } },
        ]));
        const onEvent = vi.fn();
        await expect(createSabahClient().sendMessage(null, "Search", { onEvent })).rejects.toMatchObject({ message: "Malformed response stream" });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("accepts a nonempty tool error while preserving its original text", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "tool_result", id: "tool-1", name: "Search", params: {}, result: { ok: false, error: "  Search failed  " } },
        ]));
        const onEvent = vi.fn();
        await createSabahClient().sendMessage(null, "Search", { onEvent });
        expect(onEvent).toHaveBeenCalledWith({ type: "tool_result", id: "tool-1", name: "Search", params: {}, result: { ok: false, error: "  Search failed  " } });
    });

    it.each([
        { type: "token", delta: "ok", unexpected: true },
        { type: "done", unexpected: true },
        { type: "tool_start", id: "tool-1", name: "Search", unexpected: true },
    ])("rejects stream events with unexpected keys before callback: $type", async (event) => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([event]));
        const onEvent = vi.fn();
        await expect(createSabahClient().sendMessage(null, "Search", { onEvent })).rejects.toMatchObject({ message: "Malformed response stream" });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it.each([
        { type: "tool_start", id: "tool-1", name: "" },
        { type: "tool_start", id: "tool-1", name: " ".repeat(129) },
        { type: "error", message: "" },
        { type: "error", message: "x".repeat(513) },
    ])("rejects empty or oversized names and error messages", async (event) => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([event]));
        const onEvent = vi.fn();
        await expect(createSabahClient().sendMessage(null, "Search", { onEvent })).rejects.toMatchObject({ message: "Malformed response stream" });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("checks abort between frames already present in one decoded chunk", async () => {
        const controller = new AbortController();
        const onEvent = vi.fn((event: SabahChatStreamEvent) => {
            if (event.type === "token") controller.abort();
        });
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "token", delta: "Hi" },
            { type: "done" },
        ]));
        await expect(createSabahClient().sendMessage(null, "Search", { signal: controller.signal, onEvent })).rejects.toBeInstanceOf(SabahAbortedError);
        expect(onEvent).toHaveBeenCalledTimes(1);
        expect(onEvent).toHaveBeenCalledWith({ type: "token", delta: "Hi" });
    });

    it("aborts an active stream after a token without emitting later events", async () => {
        const controller = new AbortController();
        const callbacks: SabahChatStreamEvent[] = [];
        const controlled = controlledSseResponse();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(controlled.response);
        const pending = createSabahClient().sendMessage(null, "Search", { signal: controller.signal, onEvent: (event) => callbacks.push(event) });
        await vi.waitFor(() => expect(callbacks).toEqual([{ type: "token", delta: "Hi" }]));
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(SabahAbortedError);
        controlled.release();
        expect(callbacks).toEqual([{ type: "token", delta: "Hi" }]);
    });

    it("tolerates a missing conversation event and still returns the reply", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "token", delta: "Unpersisted reply" },
            { type: "done" },
        ]));
        const client = createSabahClient();
        const result = await client.sendMessage("conv-prior", "Help me");
        expect(result).toEqual({ conversationId: null, reply: "Unpersisted reply" });
    });

    it("survives a large multi-frame stream whose terminated frames exceed the old accumulated-buffer bound", async () => {
        const bigToolPayload = "x".repeat(4 * 1024);
        const events: unknown[] = [{ type: "conversation", id: "conv-123" }];
        for (let i = 0; i < 30; i += 1) {
            events.push({ type: "tool_result", id: `t${i}`, name: "workspaceSearch", params: {}, result: { ok: true, data: { data: bigToolPayload } } });
        }
        events.push({ type: "token", delta: "All done" });
        events.push({ type: "done" });
        const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
        expect(body.length).toBeGreaterThan(64 * 1024);
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(body, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        }));
        const client = createSabahClient();
        const result = await client.sendMessage(null, "Search everything");
        expect(result).toEqual({ conversationId: "conv-123", reply: "All done" });
    });

    it("rejects a single unterminated frame exceeding the frame bound", async () => {
        const oversized = `data: {"type":"token","delta":"${"x".repeat(300 * 1024)}`;
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(oversized, {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        }));
        const client = createSabahClient();
        await expect(client.sendMessage(null, "Help me")).rejects.toMatchObject({ name: "SabahClientError", message: "Response frame exceeded bounds" });
    });

    it("accepts a reply at the exact UTF-8 byte bound and rejects the next multibyte token before callback", async () => {
        const emoji = "😀";
        const onEvent = vi.fn();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "token", delta: "a".repeat(65532) },
            { type: "token", delta: emoji },
        ]));
        await expect(createSabahClient().sendMessage(null, "Help me", { onEvent })).resolves.toEqual({ conversationId: null, reply: "a".repeat(65532) + emoji });
        expect(onEvent).toHaveBeenCalledTimes(2);

        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(sseResponse([
            { type: "token", delta: "a".repeat(65533) },
            { type: "token", delta: emoji },
        ]));
        onEvent.mockClear();
        await expect(createSabahClient().sendMessage(null, "Help me", { onEvent })).rejects.toMatchObject({ name: "SabahClientError", message: "Response exceeded bounds" });
        expect(onEvent).toHaveBeenCalledTimes(1);
    });

    it("rejects a completed multibyte SSE frame whose exact UTF-8 envelope exceeds 256KiB", async () => {
        const payload = { type: "tool_result", id: "tool-1", name: "Search", params: {}, result: { ok: true, data: "😀".repeat(70 * 1024) } };
        const frame = `data: ${JSON.stringify(payload)}\n\n`;
        expect(new TextEncoder().encode(frame).byteLength).toBeGreaterThan(256 * 1024);
        const onEvent = vi.fn();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } }));
        await expect(createSabahClient().sendMessage(null, "Help me", { onEvent })).rejects.toMatchObject({ name: "SabahClientError", message: "Response frame exceeded bounds" });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("rejects a multibyte unterminated SSE partial buffer by UTF-8 bytes", async () => {
        const partial = `data: {"type":"token","delta":"${"😀".repeat(70 * 1024)}`;
        expect(new TextEncoder().encode(partial).byteLength).toBeGreaterThan(256 * 1024);
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(partial, { status: 200, headers: { "content-type": "text/event-stream" } }));
        await expect(createSabahClient().sendMessage(null, "Help me")).rejects.toMatchObject({ name: "SabahClientError", message: "Response frame exceeded bounds" });
    });

    it("rejects a tool_result whose serialized SSE frame exceeds the exact envelope bound before callback", async () => {
        const event = { type: "tool_result", id: "tool-1", name: "Search", params: { params: "😀".repeat(40 * 1024) }, result: { ok: true, data: { result: "😀".repeat(40 * 1024) } } };
        const frame = `data: ${JSON.stringify(event)}\n\n`;
        expect(new TextEncoder().encode(frame).byteLength).toBeGreaterThan(256 * 1024);
        const onEvent = vi.fn();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } }));
        await expect(createSabahClient().sendMessage(null, "Help me", { onEvent })).rejects.toMatchObject({ name: "SabahClientError", message: "Response frame exceeded bounds" });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it("rejects malformed SSE data frames instead of returning a partial reply", async () => {
        const malformed = new Response('data: {not-json}\n\ndata: {"type":"conversation","id":"conv-123"}\n\ndata: {"type":"done"}\n\n', {
            status: 200,
            headers: { "content-type": "text/event-stream" },
        });
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(malformed);
        const client = createSabahClient();
        await expect(client.sendMessage(null, "Help me")).rejects.toMatchObject({ name: "SabahClientError", message: "Malformed response stream" });
    });

    it("cancels a failed reader before releasing it and does not double-cancel", async () => {
        const tracked = openSseResponse('data: {not-json}\n\n');
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(tracked.response);
        const pending = createSabahClient().sendMessage(null, "Help me");
        await expect(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error("reader did not terminate")), 1000))])).rejects.toMatchObject({ name: "SabahClientError", message: "Malformed response stream" });
        await tracked.canceled;
        expect(tracked.getCancelCount()).toBe(1);
    });

    it("removes the exact abort listener after normal completion", async () => {
        const controller = new AbortController();
        const add = vi.spyOn(controller.signal, "addEventListener");
        const remove = vi.spyOn(controller.signal, "removeEventListener");
        const tracked = closedSseResponse('data: {"type":"done"}\n\n');
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(tracked.response);
        await expect(createSabahClient().sendMessage(null, "Help me", { signal: controller.signal })).resolves.toEqual({ conversationId: null, reply: "" });
        expect(add).toHaveBeenCalledTimes(1);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(remove.mock.calls[0][0]).toBe(add.mock.calls[0][0]);
        controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(tracked.getCancelCount()).toBe(0);
    });

    it("handles an already-aborted signal by canceling the reader and removing its listener", async () => {
        const controller = new AbortController();
        controller.abort();
        const add = vi.spyOn(controller.signal, "addEventListener");
        const remove = vi.spyOn(controller.signal, "removeEventListener");
        const tracked = openSseResponse('data: {"type":"done"}\n\n');
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(tracked.response);
        const pending = createSabahClient().sendMessage(null, "Help me", { signal: controller.signal });
        await expect(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error("reader did not terminate")), 1000))])).rejects.toBeInstanceOf(SabahAbortedError);
        await tracked.canceled;
        expect(add).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
        expect(tracked.getCancelCount()).toBe(1);
    });

    it("releases a normally completed subscription reader without canceling", async () => {
        const onEvent = vi.fn();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ value: 'data: {"type":"token","delta":"ok"}\r\n\r\n', done: false })
                .mockResolvedValueOnce({ value: undefined, done: true }),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn(),
        };
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => reader }) } });
        createSabahClient().subscribeConversation("conv-1", onEvent);
        await vi.waitFor(() => expect(reader.releaseLock).toHaveBeenCalledOnce());
        expect(onEvent).toHaveBeenCalledWith({ type: "token", delta: "ok" });
        expect(reader.cancel).not.toHaveBeenCalled();
    });

    it("cancels and releases a subscription reader when unsubscribed while open", async () => {
        let resolveRead!: (result: { value?: string; done: boolean }) => void;
        const pendingRead = new Promise<{ value?: string; done: boolean }>((resolve) => { resolveRead = resolve; });
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ value: 'data: {"type":"token","delta":"ok"}\n\n', done: false })
                .mockReturnValueOnce(pendingRead),
            cancel: vi.fn(async () => { resolveRead({ value: undefined, done: true }); }),
            releaseLock: vi.fn(),
        };
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => reader }) } } as unknown as Response);
        const unsubscribe = createSabahClient().subscribeConversation("conv-1", vi.fn());
        await vi.waitFor(() => expect(reader.read).toHaveBeenCalledTimes(2));
        unsubscribe();
        await vi.waitFor(() => expect(reader.releaseLock).toHaveBeenCalledOnce());
        expect(reader.cancel).toHaveBeenCalledOnce();
        unsubscribe();
        expect(reader.cancel).toHaveBeenCalledOnce();
    });

    it("cancels and releases a subscription reader after a read failure", async () => {
        const reader = { read: vi.fn().mockRejectedValue(new Error("transport")), cancel: vi.fn(async () => undefined), releaseLock: vi.fn() };
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200, body: { pipeThrough: () => ({ getReader: () => reader }) } } as unknown as Response);
        createSabahClient().subscribeConversation("conv-1", vi.fn());
        await vi.waitFor(() => expect(reader.releaseLock).toHaveBeenCalledOnce());
        expect(reader.cancel).toHaveBeenCalledOnce();
    });

    it("throws SabahClientError with correlation id on non-ok", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
            new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "x-correlation-id": "corr-7" } })
        );
        const client = createSabahClient();
        await expect(client.getWorkflow("wf-1")).rejects.toMatchObject({
            name: "SabahClientError",
            status: 404,
            correlationId: "corr-7",
            message: "not found",
        });
    });

    it("throws SabahAbortedError when the signal aborts", async () => {
        const controller = new AbortController();
        (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            })
        );
        const client = createSabahClient();
        const pending = client.getWorkflow("wf-1", { signal: controller.signal });
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(SabahAbortedError);
    });

    it("preserves abort classification when JSON decoding is aborted", async () => {
        const controller = new AbortController();
        const response = {
            ok: true,
            status: 200,
            headers: new Headers(),
            json: vi.fn(() => new Promise((_resolve, reject) => {
                controller.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
            })),
        } as unknown as Response;
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(response);
        const pending = createSabahClient().getWorkflow("wf-1", { signal: controller.signal });
        await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
        controller.abort();
        await expect(pending).rejects.toBeInstanceOf(SabahAbortedError);
    });

    it("throws on schema-invalid payloads", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ id: "wf-1" }));
        const client = createSabahClient();
        await expect(client.getWorkflow("wf-1")).rejects.toMatchObject({ name: "SabahClientError" });
    });

    it("forwards decisions to the decision endpoint", async () => {
        (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(workflowSnapshot));
        const client = createSabahClient();
        await client.submitDecision("wf-1", { type: "APPROVED" } as never);
        const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toContain("/workflows/wf-1/decision");
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toEqual({ type: "APPROVED" });
    });
});
