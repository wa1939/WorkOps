// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./test/setup";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SabahProvider } from "./state/sabah-context";
import { SabahCopilot } from "./sabah-copilot";
import { createSabahClient, type SabahChatStreamEvent } from "./client";

vi.mock("./client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./client")>();
    return { ...actual, createSabahClient: vi.fn() };
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => { resolve = res; });
    return { promise, resolve };
}

function mockStreamingClient(): { emit: (event: SabahChatStreamEvent) => void; finish: () => void } {
    let emit: (event: SabahChatStreamEvent) => void = () => {};
    let finish: () => void = () => {};
    const pending = deferred<{ conversationId: string; reply: string }>();
    (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
        sendMessage: vi.fn().mockImplementation((_conversationId: string, _content: string, options?: { onEvent?: (event: SabahChatStreamEvent) => void }) => {
            emit = options?.onEvent ?? (() => {});
            return pending.promise;
        }),
    });
    finish = () => pending.resolve({ conversationId: "conv-verified", reply: "" });
    return { emit: (event) => emit(event), finish };
}

beforeEach(() => {
    vi.clearAllMocks();
    try {
        localStorage.removeItem("sabah.shell");
        localStorage.removeItem("sabah:activeConversation");
    } catch {
        // localStorage shim may be unavailable; defaults are fine.
    }
});
afterEach(() => {
    vi.unstubAllGlobals();
    try {
        localStorage.removeItem("sabah.shell");
        localStorage.removeItem("sabah:activeConversation");
    } catch {
        // localStorage shim may be unavailable; defaults are fine.
    }
});

describe("Sabah assistant link grounding (streamed messages)", () => {
    it("presents an internal task link as navigation only when a successful tool result produced that href", async () => {
        const user = userEvent.setup();
        const stream = mockStreamingClient();
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "List my tasks");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        act(() => {
            stream.emit({ type: "conversation", id: "conv-verified" });
            stream.emit({ type: "tool_start", id: "tool-1", name: "listMyTasks" });
            stream.emit({ type: "tool_result", id: "tool-1", name: "listMyTasks", params: {}, result: { ok: true, data: [{ id: "t-ok", title: "Real task", url: "/tasks/t-ok" }] } });
            stream.emit({ type: "token", delta: "[Real](/tasks/t-ok) versus [Invented](/tasks/t-invented)" });
            stream.emit({ type: "done" });
        });
        stream.finish();
        await waitFor(() => expect(screen.getByRole("link", { name: "Real" })).toHaveAttribute("href", "/tasks/t-ok"));

        expect(screen.queryByRole("link", { name: "Invented" })).not.toBeInTheDocument();
        expect(screen.getByText("Invented")).toBeInTheDocument();
    });

    it("does not grant navigation authority to hrefs from failed tool results", async () => {
        const user = userEvent.setup();
        const stream = mockStreamingClient();
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Search tasks");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        act(() => {
            stream.emit({ type: "conversation", id: "conv-verified" });
            stream.emit({ type: "tool_start", id: "tool-2", name: "searchTasks" });
            stream.emit({ type: "tool_result", id: "tool-2", name: "searchTasks", params: {}, result: { ok: false, error: "Tool execution failed" } });
            stream.emit({ type: "token", delta: "[After failure](/tasks/t-failed)" });
            stream.emit({ type: "done" });
        });
        stream.finish();
        await waitFor(() => expect(screen.getByText("After failure")).toBeInTheDocument());

        expect(screen.queryByRole("link", { name: "After failure" })).not.toBeInTheDocument();
    });
});

describe("Sabah assistant link grounding (reloaded messages)", () => {
    it("grounds reloaded assistant links in persisted successful tool results only", async () => {
        localStorage.setItem("sabah:activeConversation", "conv-saved");
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
            id: "conv-saved",
            messages: [{
                id: "m1",
                role: "assistant",
                content: "[Real](/tasks/p-ok) versus [Invented](/tasks/p-invented)",
                toolCalls: [{ name: "listMyTasks", params: {}, result: { ok: true, data: [{ id: "p-ok", url: "/tasks/p-ok" }] } }],
            }],
        }), { status: 200 })));

        render(<React.StrictMode><SabahProvider><SabahCopilot /></SabahProvider></React.StrictMode>);
        await userEvent.setup().click(screen.getByRole("button", { name: /Open Sabah/i }));

        await waitFor(() => expect(screen.getByRole("link", { name: "Real" })).toHaveAttribute("href", "/tasks/p-ok"));
        expect(screen.queryByRole("link", { name: "Invented" })).not.toBeInTheDocument();
        expect(screen.getByText("Invented")).toBeInTheDocument();
    });
});
