"use client";

import React from "react";

export type ApprovalFieldDiff = { field: string; current: unknown; proposed: unknown };

export type ApprovalCardData = {
    id: string;
    stepId: string;
    title: string;
    risk: "REVERSIBLE_WRITE" | "BULK_WRITE" | "SENSITIVE_WRITE";
    status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
    expiresAt: string;
    requestedAt: string;
    decidedAt?: string;
    decisionType?: "APPROVE" | "REJECT";
    fieldDiff?: ApprovalFieldDiff[];
};

const RISK_LABEL: Record<ApprovalCardData["risk"], string> = {
    REVERSIBLE_WRITE: "Reversible change",
    BULK_WRITE: "Bulk change",
    SENSITIVE_WRITE: "Sensitive change",
};

function formatValue(value: unknown): string {
    if (value === null || value === undefined || value === "") {
        return "(empty)";
    }
    if (typeof value === "string") {
        return value;
    }
    return "[complex value]";
}

export function ApprovalCard({ approval, onDecide, deciding = false, allowRenewal = false }: { approval: ApprovalCardData; onDecide: (approvalId: string, decision: "APPROVE" | "REJECT" | "RENEW") => void; deciding?: boolean; allowRenewal?: boolean }) {
    const decided = approval.status !== "PENDING";
    const renewable = allowRenewal && approval.status === "APPROVED" && Number.isFinite(Date.parse(approval.expiresAt)) && Date.parse(approval.expiresAt) <= Date.now();
    return (
        <section
            aria-label={`Approval: ${approval.title}`}
            className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3"
        >
            <div className="flex items-start justify-between gap-2">
                <div>
                    <h3 className="text-sm font-semibold">{approval.title}</h3>
                    <p className="text-xs text-muted-foreground">{RISK_LABEL[approval.risk]} · approval required</p>
                </div>
                {decided && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                        {approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Rejected" : "Expired"}
                    </span>
                )}
            </div>

            {approval.fieldDiff && approval.fieldDiff.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead>
                            <tr className="text-muted-foreground">
                                <th className="py-1 text-start font-medium">Field</th>
                                <th className="py-1 text-start font-medium">Current</th>
                                <th className="py-1 text-start font-medium">Proposed</th>
                            </tr>
                        </thead>
                        <tbody>
                            {approval.fieldDiff.map((diff) => (
                                <tr key={diff.field} className="border-t border-border/50">
                                    <td className="py-1 pe-2 font-medium">{diff.field}</td>
                                    <td className="py-1 pe-2">{formatValue(diff.current)}</td>
                                    <td className="py-1 text-primary">{formatValue(diff.proposed)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {renewable && <p className="mt-2 text-xs text-muted-foreground">Approval expired. Renew it, then review and approve the new request before anything runs.</p>}
            <div className="mt-3 flex gap-2">
                {renewable && <button type="button" disabled={deciding} onClick={() => onDecide(approval.id, "RENEW")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary">Renew approval</button>}
                <button
                    type="button"
                    disabled={decided || deciding}
                    onClick={() => onDecide(approval.id, "APPROVE")}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                    Run
                </button>
                <button
                    type="button"
                    disabled={decided || deciding}
                    onClick={() => onDecide(approval.id, "REJECT")}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                    Reject
                </button>
            </div>
        </section>
    );
}
