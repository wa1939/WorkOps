import { describe, it, expect, vi } from "vitest";
import { sabahReducer, createInitialSabahState, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from "./sabah-reducer";
import type { FieldSuggestion, SabahFormSnapshot } from "../forms/contracts";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";

const suggestion: FieldSuggestion = {
    fieldName: "name",
    base: "My value",
    proposed: "Sabah value",
    sourceRefs: ["task-1"],
    confidence: 0.9,
    status: "DRAFT",
};

const formContext: SabahFormSnapshot = {
    formId: "project-new",
    entityType: "project",
    entityId: null,
    recordVersion: null,
    fields: { name: { value: "My value" }, objective: { value: "" } },
};

const workflow: WorkflowSnapshot = {
    id: "wf-1",
    goal: "Create project",
    status: "RUNNING",
    actorId: "user-1",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
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
} as unknown as WorkflowSnapshot;

const stateWithWorkflow = {
    ...createInitialSabahState(),
    workflow,
    formContext,
};

describe("sabahReducer", () => {
    it("preserves active workflow and form context while resizing", () => {
        const next = sabahReducer(stateWithWorkflow, { type: "SHELL_RESIZED", width: 640 });
        expect(next.workflow?.id).toBe("wf-1");
        expect(next.formContext?.formId).toBe("project-new");
        expect(next.shell.width).toBe(640);
    });

    it("clamps resize to the 360-760 panel range", () => {
        expect(sabahReducer(createInitialSabahState(), { type: "SHELL_RESIZED", width: 100 }).shell.width).toBe(MIN_PANEL_WIDTH);
        expect(sabahReducer(createInitialSabahState(), { type: "SHELL_RESIZED", width: 9999 }).shell.width).toBe(MAX_PANEL_WIDTH);
    });

    it("never mutates a field from a suggestion event", () => {
        const next = sabahReducer(stateWithWorkflow, { type: "FIELD_SUGGESTED", suggestion });
        expect(next.formContext?.fields.name.value).toBe("My value");
        expect(next.fieldSuggestions.name.proposed).toBe("Sabah value");
        expect(next.fieldSuggestions.name.status).toBe("DRAFT");
    });

    it("marks a suggestion CONFLICT when current value drifted from base", () => {
        const drifted: FieldSuggestion = { ...suggestion, base: "Old value" };
        const next = sabahReducer(stateWithWorkflow, { type: "FIELD_SUGGESTED", suggestion: drifted });
        expect(next.fieldSuggestions.name.status).toBe("CONFLICT");
    });

    it("moves through compact/panel/fullscreen shell modes", () => {
        let state = createInitialSabahState();
        state = sabahReducer(state, { type: "SHELL_MODE_CHANGED", mode: "COMPACT" });
        expect(state.shell.mode).toBe("COMPACT");
        state = sabahReducer(state, { type: "SHELL_MODE_CHANGED", mode: "FULLSCREEN" });
        expect(state.shell.mode).toBe("FULLSCREEN");
        state = sabahReducer(state, { type: "SHELL_MODE_CHANGED", mode: "PANEL", width: 500 });
        expect(state.shell.mode).toBe("PANEL");
        expect(state.shell.width).toBe(500);
    });

    it("closes without destroying workflow/form context", () => {
        const next = sabahReducer(stateWithWorkflow, { type: "SHELL_MODE_CHANGED", mode: "CLOSED" });
        expect(next.shell.mode).toBe("CLOSED");
        expect(next.workflow?.id).toBe("wf-1");
        expect(next.formContext?.formId).toBe("project-new");
    });

    it("changes tabs and keeps the change", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "TAB_CHANGED", tab: "PLAN" });
        expect(state.shell.activeTab).toBe("CHAT"); // Legacy Plan navigation remains in chat.
        state = sabahReducer(state, { type: "TAB_CHANGED", tab: "ACTIVITY" });
        expect(state.shell.activeTab).toBe("ACTIVITY");
    });

    it("clears unread activity when the activity tab is opened", () => {
        let state = { ...createInitialSabahState(), unreadActivity: 2 };
        state = sabahReducer(state, { type: "TAB_CHANGED", tab: "ACTIVITY" });
        expect(state.unreadActivity).toBe(0);
    });

    it("increments unread activity for appended items when activity tab not active", () => {
        let state = createInitialSabahState();
        state = sabahReducer(state, { type: "ACTIVITY_APPENDED", item: { id: "a1", kind: "CHECKED", summary: "s", correlationId: "c1", occurredAt: new Date(0).toISOString() } });
        expect(state.activity).toHaveLength(1);
        expect(state.unreadActivity).toBe(1);
    });

    it("returns identical state for a byte-identical workflow snapshot", () => {
        const state = sabahReducer(stateWithWorkflow, { type: "WORKFLOW_SNAPSHOT", workflow });
        const again = sabahReducer(state, { type: "WORKFLOW_SNAPSHOT", workflow });
        expect(again).toBe(state);
    });

    it("switches conversation and clears per-conversation state", () => {
        const next = sabahReducer(stateWithWorkflow, { type: "CONVERSATION_SWITCHED", conversationId: "conv-9" });
        expect(next.conversationId).toBe("conv-9");
        expect(next.workflow).toBeNull();
    });

    it("loads a conversation atomically by replacing its messages", () => {
        const state = { ...stateWithWorkflow, conversationId: "conv-old", messages: [{ id: "old", role: "user" as const, content: "old" }] };
        const next = sabahReducer(state, { type: "CONVERSATION_LOADED", conversationId: "conv-new", messages: [{ id: "new", role: "assistant", content: "new" }] });
        expect(next.conversationId).toBe("conv-new");
        expect(next.messages).toEqual([{ id: "new", role: "assistant", content: "new" }]);
        expect(next.workflow).toBeNull();
    });

    it("resolves suggestions (APPLIED/REJECTED) and removes them from the pending map", () => {
        let state = sabahReducer(stateWithWorkflow, { type: "FIELD_SUGGESTED", suggestion });
        state = sabahReducer(state, { type: "FIELD_SUGGESTION_RESOLVED", fieldName: "name", status: "APPLIED" });
        expect(state.fieldSuggestions.name).toBeUndefined();
    });

    it("registers and unregisters form context", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "FORM_CONTEXT_REGISTERED", formContext });
        expect(state.formContext?.formId).toBe("project-new");
        state = sabahReducer(state, { type: "FORM_CONTEXT_UNREGISTERED", formId: "project-new" });
        expect(state.formContext).toBeNull();
    });

    it("returns the same state object for unknown actions", () => {
        const state = createInitialSabahState();
        expect(sabahReducer(state, { type: "UNKNOWN" } as never)).toBe(state);
    });

    it("matches reused provider tool IDs by assistant turn and ignores late results", () => {
        let state = createInitialSabahState();
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: "Search" } as never);
        state = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-1", toolId: "tool-1", status: "SUCCEEDED" } as never);
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_FINISHED", messageId: "assistant-1" });

        state = sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-2" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-2", toolId: "tool-1", name: "Search" } as never);
        state = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-2", toolId: "tool-1", status: "FAILED" } as never);

        expect(state.liveToolActivity).toEqual([
            { id: "tool-1", assistantMessageId: "assistant-1", name: "Search", summary: "No details", status: "SUCCEEDED" },
            { id: "tool-1", assistantMessageId: "assistant-2", name: "Search", summary: "No details", status: "FAILED" },
        ]);

        const afterLateResult = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-1", toolId: "tool-1", status: "FAILED", summary: "late" } as never);
        expect(afterLateResult).toBe(state);
        expect(afterLateResult.liveToolActivity[0].status).toBe("SUCCEEDED");
        expect(afterLateResult.liveToolActivity[1].status).toBe("FAILED");
    });

    it("streams one stable assistant row through start, tokens, and finish", () => {
        let state = createInitialSabahState();
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "ignored" });
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-1", token: "Hello" });
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-1", token: " world" });
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_FINISHED", messageId: "assistant-1" });
        expect(state.messages).toHaveLength(1);
        expect(state.messages[0]).toMatchObject({ id: "assistant-1", role: "assistant", content: "Hello world", streamingStatus: "FINISHED" });
    });

    it("upserts bounded tool activity and transitions the same row on result", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: "Search", summary: "Looking up records" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: "Search", summary: "duplicate" });
        state = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-1", toolId: "tool-1", status: "SUCCEEDED", summary: "Found records" });
        expect(state.liveToolActivity).toEqual([{ id: "tool-1", assistantMessageId: "assistant-1", name: "Search", summary: "Found records", status: "SUCCEEDED" }]);
        expect(JSON.stringify(state)).not.toContain("secret");
    });

    it("ignores malformed tool result statuses without poisoning retained state", () => {
        const state = sabahReducer(sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" }), { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: "Search" });
        const unchanged = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-1", toolId: "tool-1", status: "PWNED", summary: "compromised" } as never);
        expect(unchanged).toBe(state);
        expect(unchanged.liveToolActivity[0]).toEqual({ id: "tool-1", assistantMessageId: "assistant-1", name: "Search", summary: "No details", status: "RUNNING" });
    });

    it("rejects malformed stream IDs without retaining them", () => {
        const state = createInitialSabahState();
        expect(sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "bad id" } as never)).toBe(state);
        expect(sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "x".repeat(129), name: "Search" } as never)).toBe(state);
    });

    it("uses safe bounded fallbacks for malformed tool strings", () => {
        const state = sabahReducer(sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" }), { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: 42, summary: { bad: true } } as never);
        expect(state.liveToolActivity).toEqual([{ id: "tool-1", assistantMessageId: "assistant-1", name: "Unnamed tool", summary: "No details", status: "RUNNING" }]);
        const updated = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-1", toolId: "tool-1", status: "SUCCEEDED", summary: "x".repeat(513) });
        expect(updated.liveToolActivity[0].summary).toHaveLength(512);
        expect(updated.liveToolActivity[0].name).toHaveLength(12);
    });

    it("ignores non-string tokens and caps assistant content at 64KiB", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-1", token: 42 } as never);
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-1", token: "x".repeat(70 * 1024) });
        expect(state.messages[0].content).toHaveLength(64 * 1024);
    });

    it("caps assistant content at 64KiB UTF-8 without splitting the final Unicode token", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-utf8" });
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-utf8", token: "a".repeat(65532) });
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-utf8", token: "😀مرحبا" });
        const content = state.messages[0].content;
        expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(65536);
        expect(content).toBe("a".repeat(65532) + "😀");
        expect(() => encodeURIComponent(content)).not.toThrow();
    });

    it("retains an ordered surrogate-safe UTF-8 prefix when an Arabic token crosses the limit", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-arabic" });
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-arabic", token: "a".repeat(65534) });
        state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-arabic", token: "ابج" });
        const content = state.messages[0].content;
        expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(65536);
        expect(content).toBe("a".repeat(65534) + "ا");
        expect(() => encodeURIComponent(content)).not.toThrow();
    });

    it("encodes incoming tokens linearly while preserving ordered UTF-8 content", () => {
        const encode = vi.spyOn(TextEncoder.prototype, "encode");
        let state = createInitialSabahState();
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-perf" });
        const tokens = Array.from({ length: 2000 }, (_, index) => String.fromCharCode(0x61 + (index % 26)));
        for (const token of tokens) state = sabahReducer(state, { type: "ASSISTANT_TOKEN_APPENDED", messageId: "assistant-perf", token });
        expect(state.messages[0].content).toBe(tokens.join(""));
        expect(new TextEncoder().encode(state.messages[0].content).byteLength).toBe(tokens.length);
        expect(encode.mock.calls.length).toBeLessThan(5000);
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_FINISHED", messageId: "assistant-perf" });
        expect(state.streamingAssistantId).toBeNull();
        expect(state.streamingAssistantBytes).toBe(0);
    });

    it("bounds runtime tool names to 128 characters while retaining summaries to 512", () => {
        const name = "n".repeat(129);
        const summary = "s".repeat(513);
        const state = sabahReducer(sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" }), { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-name", name, summary });
        expect(state.liveToolActivity[0].name).toHaveLength(128);
        expect(state.liveToolActivity[0].summary).toHaveLength(512);
    });

    it("keeps only the newest 20 tool activities", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        for (let i = 0; i < 25; i += 1) state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: `tool-${i}`, name: "Search" });
        expect(state.liveToolActivity).toHaveLength(20);
        expect(state.liveToolActivity[0].id).toBe("tool-5");
    });

    it("associates tools with the active assistant turn and ignores terminal-turn events", () => {
        let state = createInitialSabahState();
        expect(sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "orphan", name: "Search" })).toBe(state);
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: "Search" });
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_FINISHED", messageId: "assistant-1" });
        const retained = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-1", toolId: "tool-1", status: "FAILED" });
        expect(retained).toBe(state);
        expect(retained.liveToolActivity[0]).toMatchObject({ id: "tool-1", assistantMessageId: "assistant-1", status: "RUNNING" });
        expect(sabahReducer(retained, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "late", name: "Search" })).toBe(retained);
    });

    it("marks running tool outcomes unknown when the owning stream fails", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: "Search" });
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_FAILED", messageId: "assistant-1" });
        expect(state.liveToolActivity[0]).toMatchObject({ id: "tool-1", status: "INTERRUPTED" });
    });

    it("retains capped tool activity and notices across sequential assistant turns", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-1", toolId: "tool-1", name: "Search" });
        state = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-1", toolId: "tool-1", status: "SUCCEEDED" });
        state = sabahReducer(state, { type: "STREAM_NOTICE_ADDED", assistantMessageId: "assistant-1", kind: "LIMIT_ITERATIONS" });
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_FINISHED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-2" });
        state = sabahReducer(state, { type: "TOOL_STARTED", assistantMessageId: "assistant-2", toolId: "tool-2", name: "Search" });
        state = sabahReducer(state, { type: "TOOL_RESULT", assistantMessageId: "assistant-2", toolId: "tool-2", status: "FAILED" });
        state = sabahReducer(state, { type: "STREAM_NOTICE_ADDED", assistantMessageId: "assistant-2", kind: "LIMIT_TOOL_CALLS" });
        state = sabahReducer(state, { type: "ASSISTANT_STREAM_FINISHED", messageId: "assistant-2" });

        expect(state.liveToolActivity).toEqual([
            { id: "tool-1", assistantMessageId: "assistant-1", name: "Search", summary: "No details", status: "SUCCEEDED" },
            { id: "tool-2", assistantMessageId: "assistant-2", name: "Search", summary: "No details", status: "FAILED" },
        ]);
        expect(state.streamNotices).toEqual([
            { id: "assistant-1-LIMIT_ITERATIONS", assistantMessageId: "assistant-1", kind: "LIMIT_ITERATIONS" },
            { id: "assistant-2-LIMIT_TOOL_CALLS", assistantMessageId: "assistant-2", kind: "LIMIT_TOOL_CALLS" },
        ]);
        expect(state.liveToolActivity).toHaveLength(2);
        expect(state.streamNotices).toHaveLength(2);
    });

    it("deduplicates and bounds turn-scoped stream notices", () => {
        let state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        state = sabahReducer(state, { type: "STREAM_NOTICE_ADDED", assistantMessageId: "assistant-1", kind: "COMPRESSION_PENDING" });
        const duplicate = sabahReducer(state, { type: "STREAM_NOTICE_ADDED", assistantMessageId: "assistant-1", kind: "COMPRESSION_PENDING" });
        expect(duplicate).toBe(state);
        const bounded = { ...state, streamNotices: Array.from({ length: 20 }, (_, index) => ({ id: `notice-${index}`, assistantMessageId: "assistant-1", kind: "LIMIT_ITERATIONS" as const })) };
        const capped = sabahReducer(bounded, { type: "STREAM_NOTICE_ADDED", assistantMessageId: "assistant-1", kind: "COMPRESSION_UNAVAILABLE" });
        expect(capped.streamNotices).toHaveLength(20);
    });

    it("ignores malformed stream notice kinds", () => {
        const state = sabahReducer(createInitialSabahState(), { type: "ASSISTANT_STREAM_STARTED", messageId: "assistant-1" });
        const unchanged = sabahReducer(state, { type: "STREAM_NOTICE_ADDED", assistantMessageId: "assistant-1", kind: "SECRET_PAYLOAD" } as never);
        expect(unchanged).toBe(state);
    });
});
