"use client";

import React from "react";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { StatusStack } from "./status-stack";
import { ApprovalCard } from "./approval-card";

export function PlanView({ workflow, onDecide, onExecute, decidingApprovalId, executing = false }: { workflow: WorkflowSnapshot; onDecide?: (approvalId: string, decision: "APPROVE" | "REJECT" | "RENEW") => void; onExecute?: () => void; decidingApprovalId?: string | null; executing?: boolean }) {
    return (
        <div className="space-y-3 p-3">
            <div>
                <h3 className="text-sm font-semibold">{workflow.goal}</h3>
                <p className="text-xs text-muted-foreground">Status: {workflow.status.toLowerCase().replace("_", " ")}</p>
            </div>
            {(workflow.status === "PLANNED" || workflow.status === "RUNNING") && onExecute && (
                <button type="button" disabled={executing} onClick={onExecute} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                    {workflow.status === "PLANNED" ? "Start plan" : "Continue plan"}
                </button>
            )}
            <StatusStack steps={workflow.steps} />
            {workflow.approvals.length > 0 && onDecide && (
                <div className="space-y-3" aria-label="Workflow approvals">
                    {workflow.approvals.map((approval) => (
                        <ApprovalCard key={approval.id} approval={approval} onDecide={onDecide} deciding={executing || decidingApprovalId === approval.id}
                            allowRenewal={["PLANNED", "RUNNING", "AWAITING_APPROVAL"].includes(workflow.status) && workflow.steps.some(step => step.id === approval.stepId && step.status === "PENDING")} />
                    ))}
                </div>
            )}
        </div>
    );
}
