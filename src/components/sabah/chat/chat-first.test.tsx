// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import "../test/setup";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { ChatThread } from "./chat-thread";
import { SabahActionCard } from "./action-card";
import { SabahTabs } from "../sabah-tabs";
import { SabahToolActivity, friendlyToolLabel, splitToolActivityRuns } from "./tool-activity";
import { SabahCopilot, executeWorkflowUntilSettled } from "../sabah-copilot";
import { SabahProvider, useSabah } from "../state/sabah-context";
import { createSabahClient } from "../client";

vi.mock("../client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../client")>();
    return { ...actual, createSabahClient: vi.fn() };
});

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("sabah:activeConversation");
    window.localStorage.removeItem("sabah.shell");
});
const timestamps = {
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
};

const pendingWorkflow = {
    id: "workflow-1",
    goal: "Create the onboarding project",
    status: "AWAITING_APPROVAL",
    steps: [
        {
            id: "step-1",
            clientStepId: "create-project",
            capability: "projects.create",
            status: "APPROVAL_REQUIRED",
            dependsOn: [],
            confidence: 0.98,
            previewSummary: "Create one project with the reviewed onboarding brief",
            entityLinks: [],
        },
    ],
    approvals: [
        {
            id: "approval-1",
            stepId: "step-1",
            title: "Create onboarding project",
            risk: "REVERSIBLE_WRITE",
            status: "PENDING",
            expiresAt: "2099-09-02T00:00:00.000Z",
            requestedAt: "2026-09-01T00:00:00.000Z",
        },
    ],
    ...timestamps,
} as unknown as WorkflowSnapshot;

const completedWorkflow = {
    ...pendingWorkflow,
    status: "COMPLETED",
    approvals: [{ ...pendingWorkflow.approvals[0], status: "APPROVED", decisionType: "APPROVE", decidedAt: timestamps.updatedAt }],
    steps: [{ ...pendingWorkflow.steps[0], status: "VERIFIED", resultSummary: "Project created and read back successfully", entityLinks: [{ type: "PROJECT", id: "project-1", href: "https://example.test/projects/project-1", label: "Onboarding project" }, { type: "TASK", id: "task-1", href: "/tasks/task-1", label: "Onboarding task" }] }],
} as unknown as WorkflowSnapshot;

const plannedWorkflow = { ...pendingWorkflow, status: "PLANNED" } as unknown as WorkflowSnapshot;

function SeedWorkflow({ workflow }: { workflow: WorkflowSnapshot }) {
    const { dispatch } = useSabah();
    React.useEffect(() => {
        dispatch({ type: "WORKFLOW_SNAPSHOT", workflow, assistantMessageId: "assistant-1" });
    }, [dispatch, workflow]);
    return null;
}

describe("Sabah chat-first action surface", () => {
    it("does not expose a separate Plan tab", () => {
        render(<SabahTabs activeTab="CHAT" unreadActivity={0} onSelect={() => {}} />);
        const tablist = screen.getByRole("tablist", { name: /Sabah sections/i });
        expect(within(tablist).getAllByRole("tab")).toHaveLength(3);
        expect(within(tablist).queryByRole("tab", { name: /Plan/i })).not.toBeInTheDocument();
    });

    it("preserves the donor run split so settled activity collapses but action rows stay in order", () => {
        expect(splitToolActivityRuns([
            { id: "read-1", assistantMessageId: "assistant-1", name: "listMyTasks", summary: "", status: "SUCCEEDED" },
            { id: "search-1", assistantMessageId: "assistant-1", name: "searchTasks", summary: "", status: "SUCCEEDED" },
            { id: "action-1", assistantMessageId: "assistant-1", name: "proposeWorkflow", summary: "", status: "SUCCEEDED" },
            { id: "read-2", assistantMessageId: "assistant-1", name: "getTask", summary: "", status: "RUNNING" },
        ])).toEqual([
            { kind: "run", start: 0, end: 1 },
            { kind: "card", index: 2 },
            { kind: "run", start: 3, end: 3 },
        ]);
    });

    it("renders a settled tool run as one expandable row without hiding live activity", async () => {
        render(<SabahToolActivity items={[
            { id: "read-1", assistantMessageId: "assistant-1", name: "listMyTasks", summary: "", status: "SUCCEEDED" },
            { id: "search-1", assistantMessageId: "assistant-1", name: "searchTasks", summary: "", status: "SUCCEEDED" },
        ]} />);
        const summary = screen.getByTestId("sabah-tool-summary");
        expect(summary).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByText(/Listing your tasks/i)).not.toBeInTheDocument();
        await userEvent.setup().click(summary);
        expect(summary).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText(/Listing your tasks/i)).toBeInTheDocument();
    });

    it("shows a human action row with an expandable preview and binds confirmation to the approval id", async () => {
        const user = userEvent.setup();
        const onDecide = vi.fn();
        render(<SabahActionCard workflow={pendingWorkflow} onDecide={onDecide} />);

        const row = screen.getByTestId("sabah-action-row");
        expect(within(row).getByText("Create one project with the reviewed onboarding brief")).toBeInTheDocument();
        expect(within(row).getByTestId("sabah-confirmation-strip")).toBeInTheDocument();
        expect(within(row).queryByText("projects.create")).not.toBeInTheDocument();
        expect(within(row).queryByText(/Action preview|Progress|reversible write|tasks\.createMany/i)).not.toBeInTheDocument();

        await user.click(within(row).getByRole("button", { name: /show details/i }));
        expect(within(row).getByTestId("sabah-action-preview")).toHaveTextContent("Create one project with the reviewed onboarding brief");
        await user.click(within(row).getByRole("button", { name: "Approve" }));
        expect(onDecide).toHaveBeenCalledWith("approval-1", "APPROVE");
    });

    it("keeps progress and verified result in the conversation after execution", () => {
        render(<SabahActionCard workflow={completedWorkflow} onDecide={() => {}} />);

        expect(screen.getByTestId("sabah-action-progress")).toHaveTextContent(/Verified/i);
        const result = screen.getByTestId("sabah-verified-result");
        expect(result).toHaveTextContent("Verified result");
        expect(result).toHaveTextContent("Project created and read back successfully");
        expect(within(result).getByRole("link", { name: "Onboarding project" })).toHaveAttribute("href", "https://example.test/projects/project-1");
        expect(within(result).getByRole("link", { name: "Onboarding task" })).toHaveAttribute("href", "/tasks/task-1");
    });

    it("renders assistant Markdown while copying the original response string", async () => {
        const user = userEvent.setup();
        const original = "Summary text# Heading";
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

        render(<ChatThread messages={[{ id: "assistant-markdown", role: "assistant", content: original }]} />);

        expect(screen.getByRole("heading", { name: "Heading" })).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Copy message" }));
        expect(writeText).toHaveBeenCalledWith(original);
    });

    it("attaches the action card to the assistant turn rather than rendering a second panel", () => {
        render(
            <ChatThread
                messages={[{ id: "assistant-1", role: "assistant", content: "I prepared this change." }]}
                workflow={pendingWorkflow}
                workflowMessageId="assistant-1"
                onWorkflowDecision={() => {}}
            />,
        );

        const turn = screen.getByTestId("sabah-turn-assistant-1");
        expect(within(turn).getByTestId("sabah-action-row")).toBeInTheDocument();
        expect(screen.queryByText("Start plan")).not.toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: /Plan/i })).not.toBeInTheDocument();
    });

    it("continues approved work through a bounded execute loop until terminal verification", async () => {
        const runningVerified = { ...completedWorkflow, status: "RUNNING" } as unknown as WorkflowSnapshot;
        const executeWorkflow = vi.fn()
            .mockResolvedValueOnce(runningVerified)
            .mockResolvedValueOnce(completedWorkflow);
        const result = await executeWorkflowUntilSettled({ executeWorkflow } as never, pendingWorkflow, new AbortController().signal);

        expect(executeWorkflow).toHaveBeenCalledTimes(2);
        expect(result).toBe(completedWorkflow);
    });
});
