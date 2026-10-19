// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import "../test/setup";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { InlineApprovalBar } from "./inline-approval";
import { SabahActionCard } from "./action-card";

const pending = { id: "approval-one", stepId: "step-one", title: "Create tasks", risk: "BULK_WRITE" as const, status: "PENDING" as const, requestedAt: new Date(0).toISOString(), expiresAt: new Date("2099-01-01").toISOString() };

describe("chat approval boundaries", () => {
    it("does not offer unsupported renewal for an expired pending approval", () => {
        const decide = vi.fn();
        render(<InlineApprovalBar approval={{ ...pending, expiresAt: new Date(0).toISOString() }} disabled={false} onDecide={decide} />);
        expect(screen.queryByRole("button", { name: /Renew|Approve/ })).not.toBeInTheDocument();
        expect(screen.getByText(/approval expired/i)).toBeInTheDocument();
        expect(decide).not.toHaveBeenCalled();
    });
    it("never labels skipped-only completion as a verified result", () => {
        const workflow = { id: "wf-skipped", goal: "No changes", actorId: "actor", status: "COMPLETED", createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), approvals: [], steps: [{ id: "step", clientStepId: "step", capability: "tasks.createMany", status: "SKIPPED", dependsOn: [], confidence: 1, entityLinks: [] }] } as any;
        render(<SabahActionCard workflow={workflow} onDecide={vi.fn()} />);
        expect(screen.queryByText("Verified result")).not.toBeInTheDocument();
        expect(screen.queryByText("Verified")).not.toBeInTheDocument();
        expect(screen.getByText(/No changes were verified/i)).toBeInTheDocument();
    });
    it("does not approve multiple actions from a global keyboard shortcut", () => {
        const decide = vi.fn();
        render(<><InlineApprovalBar approval={pending} onDecide={decide} /><InlineApprovalBar approval={{ ...pending, id: "approval-two" }} onDecide={decide} /></>);
        fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
        expect(decide).not.toHaveBeenCalled();
    });

    it("shows renewal for expired approval without approving or executing it", async () => {
        const decide = vi.fn();
        const approval = { ...pending, status: "APPROVED" as const, expiresAt: new Date(0).toISOString() };
        const workflow: WorkflowSnapshot = { id: "workflow-one", goal: "Create tasks", status: "RUNNING", actorId: "actor-one", createdAt: pending.requestedAt, updatedAt: pending.requestedAt, approvals: [approval], steps: [{ id: "step-one", clientStepId: "one", capability: "tasks.createMany", status: "PENDING", dependsOn: [], confidence: 1, entityLinks: [] }] };
        render(<SabahActionCard workflow={workflow} onDecide={decide} />);
        expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Renew approval" }));
        expect(decide).toHaveBeenCalledTimes(1);
        expect(decide).toHaveBeenCalledWith("approval-one", "RENEW");
    });
});
