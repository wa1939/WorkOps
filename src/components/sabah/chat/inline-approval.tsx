"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";

/**
 * Ported donor body: Hermes
 * `apps/desktop/src/components/assistant-ui/tool/approval.tsx` at
 * 245e48008fa814b3251f50755eb656bd9fb86cb1, `ApprovalBar` lines 107–281.
 * The portable pieces retained here are the compact inline strip, guarded
 * response callback, busy state, keyboard Run/Reject shortcuts, and optional
 * expanded preview seam. The donor's gateway/session store, terminal command
 * payload, and permanent "always allow" choice are host-specific and are not
 * imported. Sabah's adapter binds the response to a persisted approval id.
 */
export type InlineApprovalDecision = "APPROVE" | "REJECT" | "RENEW";
type Approval = WorkflowSnapshot["approvals"][number];

type ApprovalBarProps = {
    approval: Approval;
    onDecide: (approvalId: string, decision: InlineApprovalDecision) => void | Promise<void>;
    disabled?: boolean;
};

export function InlineApprovalBar({ approval, onDecide, disabled = false }: ApprovalBarProps) {
    const [submitting, setSubmitting] = useState<InlineApprovalDecision | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const expired = (approval.status === "PENDING" || approval.status === "APPROVED") && Date.parse(approval.expiresAt) <= Date.now();
    const busy = submitting !== null;
    const decided = approval.status !== "PENDING";

    const respond = useCallback(async (decision: InlineApprovalDecision) => {
        // Like the donor's single-source request guard, the persisted snapshot
        // is checked before dispatch so a stale row cannot resolve another action.
        if (disabled || busy || (decision === "RENEW" ? !expired : decided || expired)) return;
        setSubmitting(decision);
        try {
            await onDecide(approval.id, decision);
        } finally {
            setSubmitting(null);
        }
    }, [approval.id, busy, decided, disabled, expired, onDecide]);

    // Preserve Hermes' direct keyboard affordances. Unlike the donor gateway
    // path these invoke only the bound host callback; they never auto-approve.
    useEffect(() => {
        if (decided || disabled || expired) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void respond("APPROVE");
            } else if (event.key === "Escape") {
                event.preventDefault();
                void respond("REJECT");
            }
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [decided, disabled, expired, respond]);

    const statusLabel = approval.status === "APPROVED" ? "Approved" : approval.status === "REJECTED" ? "Rejected" : "Expired";
    const isMac = typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);

    return (
        <div ref={rootRef} className="mt-1" data-slot="tool-approval-inline" aria-busy={busy || undefined}>
            <div className="flex items-center gap-2.5">
                {expired && approval.status === "PENDING" ? (
                    <p role="status" className="text-xs text-muted-foreground">This approval expired. Ask Sabah to prepare the action again.</p>
                ) : expired ? (
                    <Button type="button" variant="outline" disabled={disabled || busy} onClick={() => void respond("RENEW")}>Renew approval</Button>
                ) : decided ? (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{statusLabel}</span>
                ) : (
                    <div className="inline-flex h-6 items-stretch overflow-hidden rounded-md border border-primary/25 bg-primary/10 text-primary">
                        <Button
                            type="button"
                            aria-label="Approve"
                            disabled={disabled || busy}
                            onClick={() => void respond("APPROVE")}
                            className="h-full gap-1 rounded-none px-2 text-xs font-medium text-primary hover:bg-primary/15 hover:text-primary"
                            variant="ghost"
                        >
                            {submitting === "APPROVE" ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : "Approve"}
                            {submitting !== "APPROVE" && <span className="text-[0.625rem] text-primary/60">{isMac ? "⌘⏎" : "Ctrl⏎"}</span>}
                        </Button>
                    </div>
                )}
                {!decided && !expired && (
                    <Button
                        type="button"
                        aria-label="Reject"
                        disabled={disabled || busy}
                        onClick={() => void respond("REJECT")}
                        className="h-6 gap-1.5 rounded-md px-1.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                        variant="ghost"
                    >
                        {submitting === "REJECT" ? <Loader2 aria-hidden="true" className="size-3 animate-spin" /> : "Reject"}
                        {submitting !== "REJECT" && <span className="text-[0.625rem] opacity-55">Esc</span>}
                    </Button>
                )}
            </div>
            {decided && <span className="sr-only">This approval has already been decided.</span>}
        </div>
    );
}

// Kept as a named export for host adapters that want the donor's disclosure
// affordance without exposing raw args/results in the normal Sabah transcript.
export function ApprovalDisclosure({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: React.ReactNode }) {
    return (
        <>
            <Button type="button" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} onClick={onToggle} variant="ghost" className="h-6 gap-1 px-1.5 text-xs text-muted-foreground">
                {open ? "Hide details" : "Show details"} <ChevronDown aria-hidden="true" className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
            {open && <div className="order-last mt-1 basis-full rounded-md border border-border/70 px-2 py-1.5 text-xs text-muted-foreground">{children}</div>}
        </>
    );
}
