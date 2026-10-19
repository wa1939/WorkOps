// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../test/setup";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatThread } from "./chat-thread";
import { Composer } from "./composer";
import { SabahThinkingIndicator } from "./thinking-indicator";
import { SabahToolActivity, friendlyToolLabel } from "./tool-activity";
import { SabahProvider } from "../state/sabah-context";
import { SabahCopilot } from "../sabah-copilot";
import { createSabahClient, SabahAbortedError } from "../client";
import type { SabahChatStreamEvent } from "../client";

vi.mock("../client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../client")>();
    return { ...actual, createSabahClient: vi.fn() };
});

describe("ChatThread welcome empty state", () => {
    it("introduces Sabah with her identity, avatar, and role", () => {
        render(<ChatThread messages={[]} />);
        expect(screen.getByRole("img", { name: /Sabah employee copilot/i })).toBeInTheDocument();
        expect(screen.getByText(/صباح/)).toBeInTheDocument();
        expect(screen.getByText("Employee Copilot")).toBeInTheDocument();
        expect(screen.getByText(/Say hello to Sabah/)).toBeInTheDocument();
    });

    it("offers suggestion chips that prefill the composer draft", async () => {
        const user = userEvent.setup();
        const onSuggestion = vi.fn();
        render(<ChatThread messages={[]} onSuggestion={onSuggestion} />);
        const chip = screen.getByRole("button", { name: /Review my priorities for today/i });
        await user.click(chip);
        expect(onSuggestion).toHaveBeenCalledWith(expect.stringMatching(/priorities/i));
    });

    it("hides suggestion chips when no handler is provided", () => {
        render(<ChatThread messages={[]} />);
        expect(screen.queryByRole("button", { name: /Review my priorities for today/i })).not.toBeInTheDocument();
    });

    it("hides the welcome block once messages exist", () => {
        render(<ChatThread messages={[{ id: "m1", role: "user", content: "hi" }]} />);
        expect(screen.queryByText("Employee Copilot")).not.toBeInTheDocument();
    });
});

describe("ChatThread thinking state", () => {
    it("shows a polite live thinking indicator while pending", () => {
        render(<ChatThread messages={[{ id: "m1", role: "user", content: "hi" }]} pending />);
        const status = screen.getByRole("status");
        expect(status).toHaveTextContent(/Sabah is working/i);
    });

    it("renders no thinking indicator when not pending", () => {
        render(<ChatThread messages={[]} />);
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("only uses motion-safe gated animation classes in the indicator", () => {
        const { container } = render(<SabahThinkingIndicator />);
        const animated = Array.from(container.querySelectorAll("[class*='animate']"));
        expect(animated.length).toBeGreaterThan(0);
        for (const node of animated) {
            expect(node.className).toContain("motion-safe:animate");
            expect(node.className).not.toMatch(/(?<!motion-safe:)animate-/);
        }
    });
});

describe("ChatThread message bubbles", () => {
    it("differentiates user and assistant messages", () => {
        render(
            <ChatThread
                messages={[
                    { id: "u1", role: "user", content: "My question" },
                    { id: "a1", role: "assistant", content: "My answer" },
                ]}
            />
        );
        expect(screen.getByTestId("sabah-bubble-u1")).toHaveAttribute("data-role", "user");
        expect(screen.getByTestId("sabah-bubble-a1")).toHaveAttribute("data-role", "assistant");
        // Assistant messages carry the Sabah avatar, user messages do not.
        expect(within(screen.getByTestId("sabah-bubble-a1")).getByRole("img", { name: /Sabah/i })).toBeInTheDocument();
        expect(within(screen.getByTestId("sabah-bubble-u1")).queryByRole("img")).not.toBeInTheDocument();
    });

    it("renders a timestamp only when the message provides one", () => {
        render(
            <ChatThread
                messages={[
                    { id: "t1", role: "assistant", content: "Timed", createdAt: "2026-08-31T09:30:00.000Z" },
                    { id: "t2", role: "assistant", content: "Untimed" },
                ]}
            />
        );
        expect(screen.getByTestId("sabah-bubble-t1").querySelector("time")).toHaveAttribute("datetime", "2026-08-31T09:30:00.000Z");
        expect(screen.getByTestId("sabah-bubble-t2").querySelector("time")).toBeNull();
    });

    it("ignores an invalid timestamp instead of rendering garbage", () => {
        render(<ChatThread messages={[{ id: "bad", role: "assistant", content: "x", createdAt: "not-a-date" }]} />);
        expect(screen.getByTestId("sabah-bubble-bad").querySelector("time")).toBeNull();
    });

    it("renders a terminal interruption status even when a failed reply is empty", () => {
        render(<ChatThread messages={[{ id: "failed-empty", role: "assistant", content: "", streamingStatus: "FAILED" }]} />);
        expect(screen.getByRole("status", { name: "Response interrupted" })).toBeInTheDocument();
        expect(screen.getByTestId("sabah-response-interrupted")).toHaveTextContent("Response interrupted");
    });
});

describe("Sabah tool activity labels", () => {
    it.each(["__proto__", "constructor", "toString"])("renders a bounded safe label for prototype key %s", (name) => {
        const label = friendlyToolLabel(name);
        expect(typeof label).toBe("string");
        expect(label.length).toBeLessThanOrEqual(128);
        expect(label).not.toContain("SECRET_MARKER");
        expect(() => render(<SabahToolActivity items={[{ id: "tool-1", assistantMessageId: "assistant-1", name, summary: "No details", status: "RUNNING" }]} />)).not.toThrow();
        expect(screen.getByTestId("sabah-tool-activity")).toHaveTextContent(label);
    });
});

describe("Composer states", () => {
    it("reuses the primary action as Stop while Sabah is working", async () => {
        const user = userEvent.setup();
        const onStop = vi.fn();
        render(<Composer value="" onChange={() => {}} onSubmit={() => {}} onStop={onStop} pending />);
        expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toBeDisabled();
        expect(screen.queryByRole("button", { name: /Send/i })).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /Stop/i }));
        expect(onStop).toHaveBeenCalledTimes(1);
        expect(screen.getByText(/Sabah is working/i)).toBeInTheDocument();
    });

    it("disables send when the draft is empty and enables it with content", () => {
        const { rerender } = render(<Composer value="" onChange={() => {}} onSubmit={() => {}} />);
        expect(screen.getByRole("button", { name: /Send/i })).toBeDisabled();
        rerender(<Composer value="hello" onChange={() => {}} onSubmit={() => {}} />);
        expect(screen.getByRole("button", { name: /Send/i })).toBeEnabled();
    });

    it("shows the keyboard hint when idle", () => {
        render(<Composer value="" onChange={() => {}} onSubmit={() => {}} />);
        expect(screen.getByText(/Enter to send/i)).toBeInTheDocument();
    });

    it("uploads a supported file through the composer adapter", async () => {
        const user = userEvent.setup();
        const onUpload = vi.fn(async () => undefined);
        const { container } = render(<Composer value="" onChange={() => {}} onSubmit={() => {}} onUpload={onUpload} />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;

        expect(screen.getByRole("button", { name: "Upload a file" })).toBeEnabled();
        expect(input).not.toBeNull();
        const file = new File(["title,owner\nPrepare report,Ali"], "tasks.csv", { type: "text/csv" });
        await user.upload(input!, file);

        expect(onUpload).toHaveBeenCalledWith(file);
        expect(input).toHaveValue("");
    });
});

describe("SabahCopilot working state integration", () => {
    const deferred = () => {
        let resolve!: (value: { conversationId: string; reply: string }) => void;
        const promise = new Promise<{ conversationId: string; reply: string }>((r) => {
            resolve = r;
        });
        return { promise, resolve };
    };

    beforeEach(() => {
        vi.clearAllMocks();
        try {
            window.localStorage.removeItem("sabah.shell");
            window.localStorage.removeItem("sabah:activeConversation");
        } catch {
            // localStorage shim may be unavailable; defaults are fine.
        }
    });

    it("shows the thinking indicator and working avatar while awaiting the reply, then clears them", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(
            <SabahProvider>
                <SabahCopilot />
            </SabahProvider>
        );
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Hello");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        expect(await screen.findByRole("status")).toHaveTextContent(/Sabah is working/i);
        expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toBeDisabled();
        const workingDots = screen.getAllByTestId("sabah-status");
        expect(workingDots.length).toBeGreaterThan(0);
        for (const dot of workingDots) {
            expect(dot).toHaveAttribute("data-status", "working");
        }

        act(() => {
            emit({ type: "token", delta: "Done!" });
            emit({ type: "done" });
        });
        pendingReply.resolve({ conversationId: "c9", reply: "Done!" });
        await waitFor(() => expect(screen.getByText("Done!")).toBeInTheDocument());
        expect(screen.queryByRole("status")).not.toBeInTheDocument();
        expect(screen.queryByText("Response interrupted")).not.toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toBeEnabled();
    });

    it("renders partial tokens in one stable assistant row before resolution and completes without duplication", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const input = screen.getByRole("textbox", { name: /Message Sabah/i });
        await user.type(input, "Stream this");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        act(() => emit({ type: "token", delta: "Partial" }));
        expect(screen.getByText("Partial")).toBeInTheDocument();
        expect(screen.queryByTestId("sabah-thinking")).not.toBeInTheDocument();
        expect(input).toBeDisabled();
        expect(document.querySelectorAll('[data-role="assistant"]')).toHaveLength(1);

        act(() => {
            emit({ type: "token", delta: " reply" });
            emit({ type: "done" });
        });
        pendingReply.resolve({ conversationId: "c9", reply: "Partial reply" });
        await waitFor(() => expect(screen.getByText("Partial reply")).toBeInTheDocument());
        expect(document.querySelectorAll('[data-role="assistant"]')).toHaveLength(1);
        expect(document.querySelector('[data-role="assistant"]')).toHaveAttribute("data-streaming-status", "FINISHED");
    });

    it("stops the active stream, preserves partial text, and fences late events", async () => {
        const user = userEvent.setup();
        let emit!: (event: SabahChatStreamEvent) => void;
        let signal!: AbortSignal;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                signal = options.signal;
                return new Promise((_resolve, reject) => {
                    signal.addEventListener("abort", () => reject(new SabahAbortedError()), { once: true });
                });
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Stop this");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        act(() => {
            emit({ type: "token", delta: "Partial answer" });
            emit({ type: "tool_start", id: "tool-active", name: "createTask" });
        });
        await user.click(screen.getByRole("button", { name: /Stop/i }));

        expect(signal.aborted).toBe(true);
        await waitFor(() => expect(document.querySelector('[data-role="assistant"]')).toHaveAttribute("data-streaming-status", "STOPPED"));
        expect(screen.getByText("Partial answer")).toBeInTheDocument();
        expect(screen.getByRole("status", { name: "Response stopped" })).toBeInTheDocument();
        expect(screen.getByTestId("sabah-tool-activity")).toHaveAttribute("data-status", "INTERRUPTED");
        expect(screen.getByText("Outcome unknown")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: /Message Sabah/i })).toBeEnabled();

        act(() => {
            emit({ type: "token", delta: " late" });
            emit({ type: "tool_result", id: "tool-active", name: "createTask", params: {}, result: { ok: true, data: {} } });
        });
        expect(screen.queryByText("Partial answer late")).not.toBeInTheDocument();
        expect(screen.getByTestId("sabah-tool-activity")).toHaveAttribute("data-status", "INTERRUPTED");
        expect(screen.queryByText("Completed")).not.toBeInTheDocument();
        expect(document.querySelectorAll('[data-role="assistant"]')).toHaveLength(1);
    });

    it("shows bounded friendly tool activity before resolution and never renders tool payloads", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Create it");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        act(() => emit({ type: "tool_start", id: "tool-1", name: "createTask" }));
        expect(screen.getByText("Creating task…")).toBeInTheDocument();
        expect(screen.getByText("Working")).toBeInTheDocument();
        expect(screen.queryByTestId("sabah-thinking")).not.toBeInTheDocument();
        act(() => emit({ type: "tool_result", id: "tool-1", name: "createTask", params: { title: "SECRET_MARKER", internalId: "INTERNAL_ID" }, result: { ok: true, data: { secret: "SECRET_MARKER", id: "INTERNAL_ID" } } }));
        expect(screen.getByText("Completed")).toBeInTheDocument();
        expect(screen.queryByText("SECRET_MARKER")).not.toBeInTheDocument();
        expect(screen.queryByText("INTERNAL_ID")).not.toBeInTheDocument();

        act(() => emit({ type: "tool_start", id: "tool-2", name: "updateTaskStatus" }));
        act(() => emit({ type: "tool_result", id: "tool-2", name: "updateTaskStatus", params: { token: "SECRET_MARKER" }, result: { ok: false, error: "SECRET_MARKER" } }));
        expect(screen.getByText("Couldn’t complete")).toBeInTheDocument();
        expect(screen.queryByText(/raw|json/i)).not.toBeInTheDocument();
    });

    it("renders limit and compression notices separately from the assistant message", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Continue");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        act(() => {
            emit({ type: "limit", reason: "iterations" });
            emit({ type: "compression", status: "pending" });
            emit({ type: "compression", status: "compressionSchedulerUnavailable" });
        });
        expect(screen.getByText(/reasoning step limit reached/i)).toBeInTheDocument();
        expect(screen.getByText(/compression pending/i)).toBeInTheDocument();
        expect(screen.getByText(/could not be scheduled/i)).toBeInTheDocument();
        expect(screen.queryByText(/SECRET_MARKER|\{.*type.*compression/i)).not.toBeInTheDocument();
    });

    it("marks an incomplete stream failed while preserving partial content", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Incomplete");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        act(() => emit({ type: "token", delta: "Partial only" }));
        pendingReply.resolve({ conversationId: "c9", reply: "Partial only" });
        await waitFor(() => expect(document.querySelector('[data-role="assistant"]')).toHaveAttribute("data-streaming-status", "FAILED"));
        expect(screen.getByText("Partial only")).toBeInTheDocument();
        expect(screen.getByText("Response interrupted")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(document.querySelectorAll('[data-role="assistant"]')).toHaveLength(1);
    });

    it("marks a mismatched final reply failed without replacing streamed content", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Mismatch");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        act(() => {
            emit({ type: "token", delta: "Partial" });
            emit({ type: "done" });
        });
        pendingReply.resolve({ conversationId: "c9", reply: "Different" });
        await waitFor(() => expect(document.querySelector('[data-role="assistant"]')).toHaveAttribute("data-streaming-status", "FAILED"));
        expect(screen.getByText("Partial")).toBeInTheDocument();
        expect(screen.getByText("Response interrupted")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(screen.queryByText("Different")).not.toBeInTheDocument();
    });

    it("fences every stream callback after done and fails post-done reply data", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Fence this");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        act(() => {
            emit({ type: "token", delta: "Before" });
            emit({ type: "tool_start", id: "tool-before", name: "createTask" });
            emit({ type: "limit", reason: "iterations" });
            emit({ type: "done" });
            emit({ type: "conversation", id: "stale-conversation" });
            emit({ type: "token", delta: "After" });
            emit({ type: "tool_start", id: "tool-after", name: "workspaceSearch" });
            emit({ type: "tool_result", id: "tool-after", name: "workspaceSearch", params: {}, result: { ok: true, data: "after" } });
            emit({ type: "limit", reason: "context" });
            emit({ type: "compression", status: "pending" });
            emit({ type: "done" });
        });
        pendingReply.resolve({ conversationId: "stale-conversation", reply: "BeforeAfter" });

        await waitFor(() => expect(document.querySelector('[data-role="assistant"]')).toHaveAttribute("data-streaming-status", "FAILED"));
        expect(screen.getByText("Before")).toBeInTheDocument();
        expect(screen.queryByText("After")).not.toBeInTheDocument();
        expect(screen.getByText("Creating task…")).toBeInTheDocument();
        expect(screen.queryByText("Searching the workspace…")).not.toBeInTheDocument();
        expect(screen.getByText(/reasoning step limit reached/i)).toBeInTheDocument();
        expect(screen.queryByText(/conversation context limit reached/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/compression pending/i)).not.toBeInTheDocument();
        expect(screen.queryByText("Exchange with Sabah")).not.toBeInTheDocument();
    });

    it("keeps the accepted pre-done conversation when the resolved response reports stale metadata", async () => {
        const user = userEvent.setup();
        const firstReply = deferred();
        const secondReply = deferred();
        let firstEmit!: (event: SabahChatStreamEvent) => void;
        let secondEmit!: (event: SabahChatStreamEvent) => void;
        const sendMessage = vi.fn()
            .mockImplementationOnce((_conversationId, _content, options) => {
                firstEmit = options?.onEvent ?? (() => {});
                return firstReply.promise;
            })
            .mockImplementationOnce((_conversationId, _content, options) => {
                secondEmit = options?.onEvent ?? (() => {});
                return secondReply.promise;
            });
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ sendMessage });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        const input = screen.getByRole("textbox", { name: /Message Sabah/i });
        await user.type(input, "First request");
        await user.click(screen.getByRole("button", { name: /Send/i }));

        act(() => {
            firstEmit({ type: "conversation", id: "conv-good" });
            firstEmit({ type: "token", delta: "First reply" });
            firstEmit({ type: "done" });
            firstEmit({ type: "conversation", id: "conv-stale" });
        });
        firstReply.resolve({ conversationId: "conv-stale", reply: "First reply" });
        await waitFor(() => expect(screen.getByText("First reply")).toBeInTheDocument());

        await user.type(input, "Second request");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        await waitFor(() => expect(sendMessage).toHaveBeenNthCalledWith(2, "conv-good", "Second request", expect.objectContaining({ onEvent: expect.any(Function) })));

        act(() => {
            secondEmit({ type: "token", delta: "Second reply" });
            secondEmit({ type: "done" });
        });
        secondReply.resolve({ conversationId: "conv-good", reply: "Second reply" });
        await waitFor(() => expect(screen.getByText("Second reply")).toBeInTheDocument());
    });

    it.each(["", "   "])("fails a done response with no visible reply and records no exchange: %j", async (reply) => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Empty completion");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        act(() => emit({ type: "done" }));
        pendingReply.resolve({ conversationId: "c9", reply });

        await waitFor(() => expect(document.querySelector('[data-role="assistant"]')).toHaveAttribute("data-streaming-status", "FAILED"));
        expect(screen.getByText("Response interrupted")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        await user.click(screen.getByRole("tab", { name: /Activity/i }));
        expect(screen.getByText("No activity yet.")).toBeInTheDocument();
        expect(screen.queryByText("Exchange with Sabah")).not.toBeInTheDocument();
    });

    it("completes a clean notice-only stream without an interrupted response", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Notice only");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        act(() => {
            emit({ type: "limit", reason: "tool_calls" });
            emit({ type: "done" });
        });
        pendingReply.resolve({ conversationId: "c9", reply: "" });

        await waitFor(() => expect(document.querySelector('[data-role="assistant"]')).toHaveAttribute("data-streaming-status", "FINISHED"));
        expect(screen.getByText(/Tool-call limit reached/i)).toBeInTheDocument();
        expect(screen.queryByText("Response interrupted")).not.toBeInTheDocument();
    });

    it("clears a history focus before streaming a new turn so token updates scroll", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.startsWith("/api/ai/conversations/search")) {
                return Promise.resolve(new Response(JSON.stringify({ items: [{ conversationId: "history-conversation", messageId: "history-message", title: "History jump", excerpt: "Prior answer" }] }), { status: 200, headers: { "content-type": "application/json" } }));
            }
            if (url.startsWith("/api/ai/conversations/history-conversation")) {
                return Promise.resolve(new Response(JSON.stringify({ messages: [{ id: "history-user", role: "user", content: "Prior question" }, { id: "history-message", role: "assistant", content: "Prior answer" }] }), { status: 200, headers: { "content-type": "application/json" } }));
            }
            return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        });
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        const scrollTo = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
        try {
            render(<SabahProvider><SabahCopilot /></SabahProvider>);
            await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
            await user.type(screen.getByRole("searchbox", { name: /Search conversation history/i }), "history");
            await user.click(screen.getByRole("button", { name: "Search" }));
            await user.click(await screen.findByRole("button", { name: "History jump" }));
            await waitFor(() => expect(screen.getByLabelText("Jumped-to message")).toBeInTheDocument());

            scrollTo.mockClear();
            const input = screen.getByRole("textbox", { name: /Message Sabah/i });
            await user.type(input, "New live request");
            await user.click(screen.getByRole("button", { name: /Send/i }));
            act(() => {
                emit({ type: "token", delta: "Current live reply" });
                emit({ type: "done" });
            });
            pendingReply.resolve({ conversationId: "live-conversation", reply: "Current live reply" });
            await waitFor(() => expect(screen.getByText("Current live reply")).toBeInTheDocument());
            expect(screen.getByText("New live request")).toBeInTheDocument();
            expect(scrollTo).toHaveBeenCalled();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it("ignores history that resolves after a live submit", async () => {
        const user = userEvent.setup();
        const pendingReply = deferred();
        let emit!: (event: SabahChatStreamEvent) => void;
        let resolveHistory!: (response: Response) => void;
        const delayedHistory = new Promise<Response>((resolve) => {
            resolveHistory = resolve;
        });
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.startsWith("/api/ai/conversations/search")) {
                return Promise.resolve(new Response(JSON.stringify({ items: [{ conversationId: "history-conversation", messageId: "history-message", title: "Old history", excerpt: "Stale history" }] }), { status: 200, headers: { "content-type": "application/json" } }));
            }
            if (url.startsWith("/api/ai/conversations/history-conversation")) {
                return delayedHistory;
            }
            return Promise.reject(new Error(`Unexpected fetch: ${url}`));
        });
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                emit = options?.onEvent ?? (() => {});
                return pendingReply.promise;
            }),
        });
        try {
            render(<SabahProvider><SabahCopilot /></SabahProvider>);
            await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
            const search = screen.getByRole("searchbox", { name: /Search conversation history/i });
            await user.type(search, "stale");
            await user.click(screen.getByRole("button", { name: "Search" }));
            await user.click(await screen.findByRole("button", { name: "Old history" }));

            const input = screen.getByRole("textbox", { name: /Message Sabah/i });
            await user.type(input, "Live request");
            await user.click(screen.getByRole("button", { name: /Send/i }));
            act(() => {
                emit({ type: "token", delta: "Live answer" });
                emit({ type: "done" });
            });
            pendingReply.resolve({ conversationId: "live-conversation", reply: "Live answer" });
            await waitFor(() => expect(screen.getByText("Live answer")).toBeInTheDocument());

            resolveHistory(new Response(JSON.stringify({ messages: [{ id: "history-message", role: "assistant", content: "Old history" }] }), { status: 200, headers: { "content-type": "application/json" } }));
            await waitFor(() => expect(screen.getByText("Live request")).toBeInTheDocument());
            expect(screen.getByText("Live answer")).toBeInTheDocument();
            expect(screen.queryByText("Old history")).not.toBeInTheDocument();
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it("shows a visible interrupted status after a transport rejection following partial content", async () => {
        const user = userEvent.setup();
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => {
                options?.onEvent?.({ type: "token", delta: "Partial before failure" });
                return Promise.reject(new Error("connection lost"));
            }),
        });
        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Transport failure");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        await waitFor(() => expect(screen.getByText("Response interrupted")).toBeInTheDocument());
        expect(screen.getByText("Partial before failure")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent(/unexpected error/i);
    });

    it("lets the user dismiss a chat error", async () => {
        const user = userEvent.setup();
        (createSabahClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
            sendMessage: vi.fn().mockRejectedValue(new Error("boom")),
        });
        render(
            <SabahProvider>
                <SabahCopilot />
            </SabahProvider>
        );
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Hello");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        expect(await screen.findByRole("alert")).toHaveTextContent(/unexpected error/i);
        await user.click(screen.getByRole("button", { name: /Dismiss error/i }));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
});

describe("ChatThread transcript live-region semantics", () => {
    it("keeps token updates quiet while preserving dedicated status announcements", () => {
        const { rerender } = render(
            <ChatThread
                messages={[
                    { id: "user-1", role: "user", content: "Question" },
                    { id: "failed-1", role: "assistant", content: "Previous reply", streamingStatus: "FAILED" },
                ]}
                pending
            />
        );
        const transcript = screen.getByRole("log", { name: "Sabah conversation" });
        expect(transcript).toHaveAttribute("aria-live", "off");
        expect(screen.getByTestId("sabah-thinking")).toHaveAttribute("role", "status");
        expect(screen.getByTestId("sabah-thinking")).toHaveAttribute("aria-live", "polite");

        rerender(
            <ChatThread
                messages={[
                    { id: "user-1", role: "user", content: "Question" },
                    { id: "failed-1", role: "assistant", content: "Previous reply", streamingStatus: "FAILED" },
                    { id: "streaming-1", role: "assistant", content: "First token", streamingStatus: "STREAMING" },
                ]}
                pending
                streamNotices={[{ id: "notice-1", assistantMessageId: "streaming-1", kind: "LIMIT_ITERATIONS" }]}
            />
        );
        expect(screen.queryByTestId("sabah-thinking")).not.toBeInTheDocument();
        expect(screen.getByTestId("sabah-stream-notice")).toHaveAttribute("role", "status");
        expect(screen.getByTestId("sabah-response-interrupted")).toHaveAttribute("role", "status");

        const statusNodesBefore = Array.from(transcript.querySelectorAll('[role="status"]'));
        const liveRegionNodesBefore = Array.from(transcript.querySelectorAll("[aria-live]"));
        rerender(
            <ChatThread
                messages={[
                    { id: "user-1", role: "user", content: "Question" },
                    { id: "failed-1", role: "assistant", content: "Previous reply", streamingStatus: "FAILED" },
                    { id: "streaming-1", role: "assistant", content: "Second token", streamingStatus: "STREAMING" },
                ]}
                pending
                streamNotices={[{ id: "notice-1", assistantMessageId: "streaming-1", kind: "LIMIT_ITERATIONS" }]}
            />
        );
        expect(screen.getByText("Second token")).toBeInTheDocument();
        expect(Array.from(transcript.querySelectorAll('[role="status"]'))).toEqual(statusNodesBefore);
        expect(Array.from(transcript.querySelectorAll("[aria-live]"))).toEqual(liveRegionNodesBefore);
    });
});

describe("ChatThread streaming scroll", () => {
    it("scrolls when assistant content or turn activity changes while message count stays stable", () => {
        const scrollTo = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
        const { rerender } = render(<ChatThread messages={[{ id: "a1", role: "assistant", content: "a", streamingStatus: "STREAMING" }]} pending />);
        scrollTo.mockClear();
        rerender(<ChatThread messages={[{ id: "a1", role: "assistant", content: "ab", streamingStatus: "STREAMING" }]} pending />);
        expect(scrollTo).toHaveBeenCalled();
        scrollTo.mockClear();
        rerender(<ChatThread messages={[{ id: "a1", role: "assistant", content: "ab", streamingStatus: "STREAMING" }]} pending liveToolActivity={[{ id: "tool-1", assistantMessageId: "a1", name: "createTask", summary: "No details", status: "RUNNING" }]} />);
        expect(scrollTo).toHaveBeenCalled();
    });

    it("keeps thinking visible when activity belongs to another assistant turn", () => {
        render(
            <ChatThread
                messages={[{ id: "a1", role: "assistant", content: "", streamingStatus: "STREAMING" }]}
                pending
                liveToolActivity={[{ id: "tool-old", assistantMessageId: "a-old", name: "createTask", summary: "No details", status: "RUNNING" }]}
            />
        );
        expect(screen.getByTestId("sabah-thinking")).toBeInTheDocument();
    });

    it("renders retained activity beneath the assistant turn that owns it", () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
            render(
                <ChatThread
                    messages={[
                        { id: "assistant-1", role: "assistant", content: "First", streamingStatus: "FINISHED" },
                        { id: "assistant-2", role: "assistant", content: "Second", streamingStatus: "FINISHED" },
                    ]}
                    liveToolActivity={[
                        { id: "tool-1", assistantMessageId: "assistant-1", name: "createTask", summary: "No details", status: "SUCCEEDED" },
                        { id: "tool-1", assistantMessageId: "assistant-2", name: "workspaceSearch", summary: "No details", status: "FAILED" },
                    ]}
                    streamNotices={[
                        { id: "assistant-1-LIMIT_ITERATIONS", assistantMessageId: "assistant-1", kind: "LIMIT_ITERATIONS" },
                        { id: "assistant-2-LIMIT_TOOL_CALLS", assistantMessageId: "assistant-2", kind: "LIMIT_TOOL_CALLS" },
                    ]}
                />
            );
            const first = document.getElementById("message-assistant-1");
            const second = document.getElementById("message-assistant-2");
            expect(first).not.toBeNull();
            expect(second).not.toBeNull();
            expect(within(first as HTMLElement).getByText("Creating task…")).toBeInTheDocument();
            expect(within(first as HTMLElement).getByText(/reasoning step limit reached/i)).toBeInTheDocument();
            expect(within(second as HTMLElement).getByText("Searching the workspace…")).toBeInTheDocument();
            expect(within(second as HTMLElement).getByText(/tool-call limit reached/i)).toBeInTheDocument();
            expect(consoleError.mock.calls.some(([message]) => String(message).includes("same key"))).toBe(false);
        } finally {
            consoleError.mockRestore();
        }
    });
});
