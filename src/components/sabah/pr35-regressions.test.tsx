// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "./test/setup";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { ChatThread } from "./chat/chat-thread";
import { SabahProvider } from "./state/sabah-context";
import { SabahCopilot } from "./sabah-copilot";
import { createSabahClient } from "./client";
import type { SabahChatStreamEvent } from "./client";

vi.mock("./client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./client")>();
    return { ...actual, createSabahClient: vi.fn() };
});

const timestamps = {
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
};

function pendingWorkflow(id: string, approvalId: string): WorkflowSnapshot {
    return {
        id,
        goal: `Prepare ${id}`,
        status: "AWAITING_APPROVAL",
        actorId: "user-1",
        steps: [{
            id: `${id}-step`,
            clientStepId: `${id}-step-client`,
            capability: "projects.create",
            status: "APPROVAL_REQUIRED",
            dependsOn: [],
            confidence: 1,
            previewSummary: `Prepare ${id}`,
            entityLinks: [],
        }],
        approvals: [{
            id: approvalId,
            stepId: `${id}-step`,
            title: `Approve ${id}`,
            risk: "REVERSIBLE_WRITE",
            status: "PENDING",
            expiresAt: "2099-01-01T00:00:00.000Z",
            requestedAt: timestamps.createdAt,
        }],
        ...timestamps,
    } as WorkflowSnapshot;
}

function plannedWorkflow(id: string): WorkflowSnapshot {
    return {
        id,
        goal: `Prepare ${id}`,
        status: "PLANNED",
        actorId: "user-1",
        steps: [],
        approvals: [],
        ...timestamps,
    } as WorkflowSnapshot;
}

function resolvedChatOptions(options?: { onEvent?: (event: SabahChatStreamEvent) => void }) {
    options?.onEvent?.({ type: "conversation", id: "conv-1" });
    options?.onEvent?.({ type: "token", delta: "ok" });
    options?.onEvent?.({ type: "done" });
    return Promise.resolve({ conversationId: "conv-1", reply: "ok" });
}

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
});

describe("PR35 retained workflow cards", () => {
    it("renders two retained cards and binds an older approval to its workflow", async () => {
        const first = pendingWorkflow("wf-first", "approval-first");
        const second = pendingWorkflow("wf-second", "approval-second");
        const onDecision = vi.fn();
        const onSelect = vi.fn();

        render(
            <ChatThread
                messages={[
                    { id: "assistant-first", role: "assistant", content: "First proposal" },
                    { id: "assistant-second", role: "assistant", content: "Second proposal" },
                ]}
                workflows={[first, second]}
                workflowMessageIds={{ "wf-first": "assistant-first", "wf-second": "assistant-second" }}
                selectedWorkflowId="wf-second"
                onWorkflowDecisionForWorkflow={onDecision}
                onWorkflowSelect={onSelect}
            />,
        );

        const cards = screen.getAllByTestId("sabah-action-row");
        expect(cards).toHaveLength(2);
        await userEvent.setup().click(within(cards[0]).getByRole("button", { name: "Approve" }));
        expect(onDecision).toHaveBeenCalledWith("wf-first", "approval-first", "APPROVE");

        await userEvent.setup().click(screen.getByRole("button", { name: "Resume action" }));
        expect(onSelect).toHaveBeenCalledWith("wf-first");
    });
});

describe("PR35 preflight retry", () => {
    it("offers a retry after a transient preparation failure without approving", async () => {
        const workflow = plannedWorkflow("wf-retry");
        const executeWorkflow = vi.fn()
            .mockRejectedValueOnce(new Error("temporary preflight failure"))
            .mockResolvedValueOnce({ ...workflow, status: "AWAITING_APPROVAL" });
        const client = {
            sendMessage: vi.fn().mockImplementation((_conversationId, _content, options) => resolvedChatOptions(options)),
            listWorkflows: vi.fn().mockResolvedValue([workflow]),
            submitDecision: vi.fn(),
            executeWorkflow,
        };
        vi.mocked(createSabahClient).mockReturnValue(client as never);

        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        await userEvent.setup().click(screen.getByRole("button", { name: /Open Sabah/i }));
        const input = screen.getByRole("textbox", { name: /Message Sabah/i });
        await userEvent.setup().type(input, "Prepare this");
        await userEvent.setup().click(screen.getByRole("button", { name: /Send/i }));

        expect(await screen.findByText("Prepare wf-retry")).toBeInTheDocument();
        expect(await screen.findByRole("alert")).toHaveTextContent("temporary preflight failure");
        await userEvent.setup().click(screen.getByRole("button", { name: "Retry preparation" }));

        await waitFor(() => expect(executeWorkflow).toHaveBeenCalledTimes(2));
        expect(client.submitDecision).not.toHaveBeenCalled();
        expect(await screen.findByText("Needs your confirmation")).toBeInTheDocument();
    });
});

describe("PR35 same-conversation approval fence", () => {
    it("ignores an old approval response when a new proposal replaces it", async () => {
        const oldWorkflow = pendingWorkflow("wf-old", "approval-old");
        const newWorkflow = plannedWorkflow("wf-new");
        let resolveDecision!: (snapshot: WorkflowSnapshot) => void;
        let secondOptions: { onEvent?: (event: SabahChatStreamEvent) => void } | undefined;
        const submitDecision = vi.fn().mockImplementation(() => new Promise<WorkflowSnapshot>((resolve) => { resolveDecision = resolve; }));
        const executeWorkflow = vi.fn();
        const sendMessage = vi.fn()
            .mockImplementationOnce((_conversationId, _content, options) => resolvedChatOptions(options))
            .mockImplementationOnce((_conversationId, _content, options) => {
                secondOptions = options;
                options?.onEvent?.({ type: "conversation", id: "conv-1" });
                options?.onEvent?.({ type: "token", delta: "new" });
                options?.onEvent?.({ type: "tool_result", id: "tool-new", name: "proposeWorkflow", params: {}, result: { ok: true, data: newWorkflow } });
                options?.onEvent?.({ type: "done" });
                return Promise.resolve({ conversationId: "conv-1", reply: "new" });
            });
        const client = {
            sendMessage,
            listWorkflows: vi.fn().mockResolvedValueOnce([oldWorkflow]),
            submitDecision,
            executeWorkflow,
        };
        vi.mocked(createSabahClient).mockReturnValue(client as never);

        render(<SabahProvider><SabahCopilot /></SabahProvider>);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: /Open Sabah/i }));
        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Start");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        await user.click(await screen.findByRole("button", { name: "Approve" }));
        expect(submitDecision).toHaveBeenCalledWith("wf-old", { type: "APPROVE", approvalId: "approval-old" }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
        const oldSignal = submitDecision.mock.calls[0]?.[2]?.signal as AbortSignal;

        await user.type(screen.getByRole("textbox", { name: /Message Sabah/i }), "Replace");
        await user.click(screen.getByRole("button", { name: /Send/i }));
        act(() => {
            secondOptions?.onEvent?.({ type: "conversation", id: "conv-1" });
            secondOptions?.onEvent?.({ type: "tool_result", id: "tool-new", name: "proposeWorkflow", params: {}, result: { ok: true, data: newWorkflow } });
            secondOptions?.onEvent?.({ type: "done" });
        });
        await waitFor(() => expect(oldSignal.aborted).toBe(true));

        await act(async () => {
            resolveDecision({ ...oldWorkflow, status: "RUNNING" });
        });
        expect(executeWorkflow).not.toHaveBeenCalledWith("wf-old", expect.anything());
    });
});
