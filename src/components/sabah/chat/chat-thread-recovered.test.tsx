// @vitest-environment jsdom
import React from "react";
import { describe, expect, it } from "vitest";
import "../test/setup";
import { render, screen } from "@testing-library/react";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { ChatThread } from "./chat-thread";

const recoveredWorkflow = {
  id: "workflow-recovered",
  goal: "Create the recovered project",
  status: "AWAITING_APPROVAL",
  steps: [{
    id: "step-recovered",
    clientStepId: "create-project",
    capability: "projects.create",
    status: "APPROVAL_REQUIRED",
    dependsOn: [],
    confidence: 1,
    previewSummary: "Create the recovered project",
    entityLinks: [],
  }],
  approvals: [{
    id: "approval-recovered",
    stepId: "step-recovered",
    title: "Create the recovered project",
    risk: "REVERSIBLE_WRITE",
    status: "PENDING",
    expiresAt: "2999-01-01T00:00:00.000Z",
    requestedAt: "2026-09-01T00:00:00.000Z",
  }],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} as unknown as WorkflowSnapshot;

describe("ChatThread recovered workflow rendering", () => {
  it("keeps a recovered action visible when its assistant turn is absent", () => {
    render(
      <ChatThread
        messages={[]}
        workflow={recoveredWorkflow}
        workflowMessageId="assistant-missing"
        onWorkflowDecision={() => {}}
      />,
    );

    expect(screen.getByTestId("sabah-action-row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});
