"use client";

import React, { useState } from "react";
import { isSafeWorkflowHref, type WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { ResultCard, type ResultCardData } from "../workflow/result-card";
import { ApprovalDisclosure, InlineApprovalBar, type InlineApprovalDecision } from "./inline-approval";

const TERMINAL_WORKFLOW_STATUSES = new Set<WorkflowSnapshot["status"]>(["COMPLETED", "FAILED", "CANCELED"]);

const STATUS_COPY: Record<WorkflowSnapshot["status"], string> = {
    PLANNED: "Ready",
    AWAITING_APPROVAL: "Needs your confirmation",
    RUNNING: "Working",
    COMPLETED: "Completed",
    FAILED: "Could not complete",
    CANCELED: "Canceled",
};

const STEP_STATUS_COPY: Record<WorkflowSnapshot["steps"][number]["status"], string> = {
    PENDING: "Waiting",
    APPROVAL_REQUIRED: "Needs confirmation",
    RUNNING: "Working",
    VERIFIED: "Verified",
    FAILED: "Failed",
    BLOCKED: "Blocked",
    SKIPPED: "Skipped",
};

function safeHref(value: string): boolean {
    return isSafeWorkflowHref(value);
}

function actionTitle(workflow: WorkflowSnapshot): string {
    const firstPreview = workflow.steps.find((step) => step.previewSummary?.trim())?.previewSummary?.trim();
    return firstPreview || workflow.goal;
}

function resultData(workflow: WorkflowSnapshot): ResultCardData {
    const verified = workflow.steps.filter((step) => step.status === "VERIFIED");
    const failed = workflow.steps.filter((step) => step.status === "FAILED" || step.status === "BLOCKED");
    const summaries = verified.map((step) => step.resultSummary?.trim()).filter((value): value is string => Boolean(value));
    const entityLinks = verified.flatMap((step) => step.entityLinks.filter((link) => safeHref(link.href)));
    const warnings = failed.map((step) => step.error?.trim()).filter((value): value is string => Boolean(value));

    return {
        summary: summaries.join(" · ") || (verified.length > 0 ? "Execution was verified; no detailed result summary was returned." : "No changes were verified."),
        entityLinks,
        warnings,
        reversible: false,
        error: workflow.status === "FAILED" ? warnings[0] ?? "The action failed before verification." : undefined,
    };
}

/**
 * A small transcript row, not a second operator panel. This maps the donor's
 * ToolEntry/ToolRun contract from
 * `apps/desktop/src/components/assistant-ui/tool/fallback.tsx` (revision
 * 245e48008fa814b3251f50755eb656bd9fb86cb1): collapsed human-readable row,
 * explicit disclosure for details, and settled output kept at the point where
 * the action happened. The host supplies only its validated workflow snapshot
 * and its authenticated approval callback.
 */
export function SabahActionCard({
    workflow,
    workflowMessageId,
    onDecide,
    onRetry,
    actionBusy = false,
}: {
    workflow: WorkflowSnapshot;
    workflowMessageId?: string | null;
    onDecide: (approvalId: string, decision: InlineApprovalDecision) => void | Promise<void>;
    onRetry?: () => void | Promise<void>;
    actionBusy?: boolean;
}) {
    const [detailsOpen, setDetailsOpen] = useState(false);
    const title = actionTitle(workflow);
    const verifiedOutcome = workflow.status === "COMPLETED" && workflow.steps.length > 0 && workflow.steps.every((step) => step.status === "VERIFIED");
    // A settled workflow can no longer run: any APPROVED gate on it is spent
    // history, so an expired one must surface as "expired", never as a Renew
    // button whose Approve-again path can only end in a server 409 (or a
    // duplicate re-proposal of the same change).
    const workflowSettled = TERMINAL_WORKFLOW_STATUSES.has(workflow.status);
    const pendingApprovals = workflowSettled ? [] : workflow.approvals.filter((approval) => approval.status === "PENDING" || (approval.status === "APPROVED" && Date.parse(approval.expiresAt) <= Date.now() && !workflow.approvals.some((other) => other.id !== approval.id && other.stepId === approval.stepId && (other.status === "PENDING" || (other.status === "APPROVED" && Date.parse(other.expiresAt) > Date.now())))));

    return (
        <section
            aria-label="Sabah action"
            data-assistant-message-id={workflowMessageId ?? undefined}
            data-testid="sabah-action-row"
            className="mt-2 min-w-0 rounded-lg border border-border/80 bg-muted/20 px-2.5 py-2"
        >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                    aria-hidden="true"
                    className={
                        "size-2 shrink-0 rounded-full " +
                        (workflow.status === "COMPLETED" ? "bg-emerald-500" : workflow.status === "FAILED" || workflow.status === "CANCELED" ? "bg-destructive" : workflow.status === "RUNNING" ? "bg-sky-500" : "bg-amber-500")
                    }
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={title}>
                    {title}
                </span>
                <ApprovalDisclosure
                    open={detailsOpen}
                    onToggle={() => setDetailsOpen((open) => !open)}
                >
                    <div role="region" aria-label="Sabah action preview" data-slot="sabah-action-preview" data-testid="sabah-action-preview" className="space-y-2">
                        {workflow.steps.length > 1 && (
                            <ul aria-label="Action details" className="space-y-1">
                                {workflow.steps.map((step) => (
                                    <li key={step.id} className="flex min-w-0 items-start gap-2">
                                        <span className="shrink-0 text-muted-foreground">{STEP_STATUS_COPY[step.status]}</span>
                                        <span className="min-w-0 text-foreground">{step.previewSummary?.trim() || title}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {workflow.steps.length === 1 && workflow.steps[0]?.previewSummary && (
                            <p className="leading-relaxed">{workflow.steps[0].previewSummary}</p>
                        )}
                    </div>
                </ApprovalDisclosure>
                <span data-testid="sabah-action-progress" className="shrink-0 text-[10px] text-muted-foreground">
                    {verifiedOutcome ? "Verified" : STATUS_COPY[workflow.status]}
                </span>
            </div>

            {onRetry && workflow.status === "PLANNED" && (
                <button type="button" disabled={actionBusy} onClick={() => void onRetry()} className="mt-2 text-xs underline disabled:opacity-50">Retry preparation</button>
            )}
            {pendingApprovals.length > 0 && (
                <div aria-label="Confirmation required" data-testid="sabah-confirmation-strip" className="mt-2 flex flex-wrap items-center gap-2 border-t border-amber-500/30 pt-2">
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Confirm this change</span>
                    {pendingApprovals.map((approval) => (
                        <InlineApprovalBar key={approval.id} approval={approval} disabled={actionBusy} onDecide={onDecide} />
                    ))}
                </div>
            )}

            {/* Settled workflow with a spent approval: teach instead of offering
                dead controls. The server rejects renew/re-execute with 409. */}
            {workflowSettled && workflow.approvals.some((approval) => approval.status === "APPROVED" && Date.parse(approval.expiresAt) <= Date.now()) && (
                <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                    This action already ran and its confirmation window has closed. Ask Sabah for the change again if you want a fresh copy.
                </p>
            )}

            {workflow.status === "COMPLETED" && (
                <section aria-label={verifiedOutcome ? "Verified result" : "Action result"} data-testid={verifiedOutcome ? "sabah-verified-result" : "sabah-action-result"} className="mt-2 border-t border-border pt-2">
                    <p className="mb-1 text-xs font-semibold">{verifiedOutcome ? "Verified result" : "Action result"}</p>
                    <ResultCard result={resultData(workflow)} />
                </section>
            )}

            {workflow.status === "FAILED" && (
                <section aria-label="Action result" data-testid="sabah-action-failure" className="mt-2 border-t border-destructive/30 pt-2">
                    <ResultCard result={resultData(workflow)} />
                </section>
            )}
        </section>
    );
}
