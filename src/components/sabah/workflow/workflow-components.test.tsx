// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import "../test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalCard } from "./approval-card";
import { ClarificationCard } from "./clarification-card";
import { ResultCard } from "./result-card";
import { StatusStack } from "./status-stack";
import { PlanView } from "./plan-view";
import { ActivityView } from "../activity/activity-view";

const approvalWithFieldDiff = {
    id: "appr-1",
    stepId: "step-1",
    title: "Create project",
    risk: "REVERSIBLE_WRITE" as const,
    status: "PENDING" as const,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    requestedAt: new Date().toISOString(),
    fieldDiff: [
        { field: "name", current: "My project", proposed: "Sabah proposal" },
    ],
};

const sensitiveApproval = { ...approvalWithFieldDiff, id: "appr-2", risk: "SENSITIVE_WRITE" as const, title: "Delete records" };

describe("ApprovalCard", () => {
    it("shows Current/Proposed diff and enabled Run for a pending approval", () => {
        render(<ApprovalCard approval={approvalWithFieldDiff} onDecide={() => {}} />);
        expect(screen.getByText("Current")).toBeVisible();
        expect(screen.getByText("Proposed")).toBeVisible();
        expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
    });

    it("offers no permanent allow option for sensitive/bulk actions", () => {
        render(<ApprovalCard approval={sensitiveApproval} onDecide={() => {}} />);
        expect(screen.queryByRole("button", { name: /Always allow/i })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Don't ask again/i })).not.toBeInTheDocument();
    });

    it("emits approve/reject decisions", async () => {
        const onDecide = vi.fn();
        const user = userEvent.setup();
        render(<ApprovalCard approval={approvalWithFieldDiff} onDecide={onDecide} />);
        await user.click(screen.getByRole("button", { name: "Run" }));
        expect(onDecide).toHaveBeenCalledWith("appr-1", "APPROVE");
        await user.click(screen.getByRole("button", { name: "Reject" }));
        expect(onDecide).toHaveBeenCalledWith("appr-1", "REJECT");
    });

    it("disables actions once decided", () => {
        render(<ApprovalCard approval={{ ...approvalWithFieldDiff, status: "APPROVED", decisionType: "APPROVE" }} onDecide={() => {}} />);
        expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    });
});

describe("ClarificationCard", () => {
    const single = { id: "clar-1", question: "Which department?", options: [{ id: "o1", label: "PMO" }, { id: "o2", label: "Ops" }], multiSelect: false };

    it("renders single-select question and submits one answer", async () => {
        const onAnswer = vi.fn();
        const user = userEvent.setup();
        render(<ClarificationCard clarification={single} onAnswer={onAnswer} />);
        await user.click(screen.getByRole("radio", { name: "PMO" }));
        await user.click(screen.getByRole("button", { name: /Answer/i }));
        expect(onAnswer).toHaveBeenCalledWith("clar-1", ["o1"]);
    });

    it("supports multi-select with several answers", async () => {
        const onAnswer = vi.fn();
        const user = userEvent.setup();
        const multi = { ...single, multiSelect: true };
        render(<ClarificationCard clarification={multi} onAnswer={onAnswer} />);
        await user.click(screen.getByRole("checkbox", { name: "PMO" }));
        await user.click(screen.getByRole("checkbox", { name: "Ops" }));
        await user.click(screen.getByRole("button", { name: /Answer/i }));
        expect(onAnswer).toHaveBeenCalledWith("clar-1", ["o1", "o2"]);
    });
});

describe("StatusStack", () => {
    it("shows dependency status in order with pending/verified states", () => {
        const steps = [
            { id: "s1", clientStepId: "c1", capability: "projects.create", status: "VERIFIED" as const, dependsOn: [], confidence: 1 },
            { id: "s2", clientStepId: "c2", capability: "tasks.create", status: "PENDING" as const, dependsOn: ["c1"], confidence: 0.9 },
        ];
        render(<StatusStack steps={steps} />);
        const items = screen.getAllByRole("listitem");
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent(/verified/i);
        expect(items[1]).toHaveTextContent(/waiting/i);
    });
});

describe("PlanView", () => {
    it("renders the goal and step capabilities without raw JSON", () => {
        const workflow = {
            id: "wf-1",
            goal: "Onboard new project",
            status: "AWAITING_APPROVAL" as const,
            steps: [
                { id: "s1", clientStepId: "c1", capability: "projects.create", status: "PENDING" as const, dependsOn: [], confidence: 0.9 },
            ],
            approvals: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        render(<PlanView workflow={workflow as never} />);
        expect(screen.getByText("Onboard new project")).toBeVisible();
        expect(screen.getByText(/projects\.create/)).toBeVisible();
        expect(screen.queryByText(/{/)).not.toBeInTheDocument();
    });
});

describe("ResultCard", () => {
    it("summarizes with entity links and warnings, no raw JSON", () => {
        render(
            <ResultCard
                result={{
                    summary: "Created 3 tasks",
                    entityLinks: [{ type: "task", id: "t1", href: "https://app.example.com/tasks/t1", label: "Task 1" }],
                    warnings: ["2 fields left blank"],
                    reversible: true,
                }}
                onUndo={() => {}}
            />
        );
        expect(screen.getByText("Created 3 tasks")).toBeVisible();
        expect(screen.getByRole("link", { name: "Task 1" })).toHaveAttribute("href", "https://app.example.com/tasks/t1");
        expect(screen.getByText(/2 fields left blank/)).toBeVisible();
        expect(screen.getByRole("button", { name: /Undo/i })).toBeEnabled();
    });

    it("hides Undo when the action is not reversible", () => {
        render(
            <ResultCard
                result={{ summary: "Deleted records", entityLinks: [], warnings: [], reversible: false }}
                onUndo={() => {}}
            />
        );
        expect(screen.queryByRole("button", { name: /Undo/i })).not.toBeInTheDocument();
    });

    it("failures show correlation id and a retry action", () => {
        render(
            <ResultCard
                result={{ summary: "Step failed", entityLinks: [], warnings: [], reversible: false, error: "Provider timeout", correlationId: "corr-42" }}
                onRetry={() => {}}
            />
        );
        expect(screen.getByText(/corr-42/)).toBeVisible();
        expect(screen.getByRole("button", { name: /Retry/i })).toBeEnabled();
    });
});

describe("ActivityView", () => {
    it("distinguishes kinds and links by correlation id", () => {
        const items = [
            { id: "a1", kind: "CHECKED" as const, summary: "Checked 4 projects", correlationId: "corr-1", occurredAt: new Date().toISOString() },
            { id: "a2", kind: "FAILED" as const, summary: "Import failed", correlationId: "corr-2", occurredAt: new Date().toISOString() },
        ];
        render(<ActivityView items={items} onOpenCorrelation={() => {}} />);
        expect(screen.getByText("Checked 4 projects")).toBeVisible();
        expect(screen.getByText("Import failed")).toBeVisible();
        expect(screen.getByRole("button", { name: /corr-1/ })).toBeVisible();
    });
});
