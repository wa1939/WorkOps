"use client";

import React from "react";

export type WorkflowStepView = {
    id: string;
    clientStepId: string;
    capability: string;
    status: "PENDING" | "APPROVAL_REQUIRED" | "RUNNING" | "VERIFIED" | "FAILED" | "BLOCKED" | "SKIPPED";
    dependsOn?: string[];
};

const STATUS_LABEL: Record<WorkflowStepView["status"], string> = {
    PENDING: "Waiting",
    APPROVAL_REQUIRED: "Needs approval",
    RUNNING: "Running",
    VERIFIED: "Verified",
    FAILED: "Failed",
    BLOCKED: "Blocked",
    SKIPPED: "Skipped",
};

const STATUS_CLASS: Record<WorkflowStepView["status"], string> = {
    PENDING: "text-muted-foreground",
    APPROVAL_REQUIRED: "text-amber-600 dark:text-amber-400",
    RUNNING: "text-sky-600 dark:text-sky-400",
    VERIFIED: "text-emerald-600 dark:text-emerald-400",
    FAILED: "text-red-600 dark:text-red-400",
    BLOCKED: "text-red-600 dark:text-red-400",
    SKIPPED: "text-muted-foreground",
};

export function StatusStack({ steps }: { steps: WorkflowStepView[] }) {
    return (
        <ol aria-label="Workflow steps" className="space-y-1.5">
            {steps.map((step) => (
                <li key={step.id} className="flex items-center gap-2 text-sm">
                    <span aria-hidden="true" className={"inline-block h-2 w-2 shrink-0 rounded-full " + (step.status === "VERIFIED" ? "bg-emerald-500" : step.status === "RUNNING" ? "bg-sky-500" : step.status === "FAILED" || step.status === "BLOCKED" ? "bg-red-500" : step.status === "APPROVAL_REQUIRED" ? "bg-amber-500" : "bg-muted-foreground/40")} />
                    <span className="font-medium">{step.capability}</span>
                    {(step.dependsOn ?? []).length > 0 && (
                        <span className="text-xs text-muted-foreground">
                            after {(step.dependsOn ?? []).join(", ")}
                        </span>
                    )}
                    <span className={"ms-auto text-xs " + STATUS_CLASS[step.status]}>{STATUS_LABEL[step.status]}</span>
                </li>
            ))}
        </ol>
    );
}
