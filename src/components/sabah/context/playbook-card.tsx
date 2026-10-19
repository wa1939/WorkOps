"use client";
import React, { useState } from "react";
import type { PlaybookState } from "@/lib/sabah/playbooks/contracts";
import type { SourceRef } from "@/lib/sabah/intelligence/contracts";

export type PlaybookCardRecord = {
  id: string;
  playbookId: string;
  version: number;
  name: string;
  description: string;
  state: PlaybookState;
  allowedCapabilities?: readonly string[];
  requiredContext?: readonly string[];
  checksum?: string;
  sources?: Partial<SourceRef>[];
  freshness?: string;
  evaluationStatus?: "PASS" | "FAIL" | "PENDING";
};
export type PlaybookVersion = Pick<PlaybookCardRecord, "id" | "version" | "state" | "checksum">;
export type PlaybookCardProps = {
  playbook: PlaybookCardRecord;
  versions?: readonly PlaybookVersion[];
  canDecide?: boolean;
  onDecision?: (decision: "APPROVED" | "ARCHIVED", reason?: string) => Promise<void>;
  onSubmitReview?: () => Promise<void>;
};

const safeHref = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/^[\/]*(?:[a-z][a-z\d+.-]*:)/i.test(value) && !/[\u0000-\u001f\u007f]/.test(value);

export function PlaybookCard({ playbook, versions = [], canDecide = false, onDecision, onSubmitReview }: PlaybookCardProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const submitReview = async () => {
    setError("");
    setSaving(true);
    try {
      if (onSubmitReview) {
        await onSubmitReview();
      } else {
        const response = await fetch(`/api/ai/playbooks/${encodeURIComponent(playbook.id)}/review`, { method: "POST" });
        if (!response.ok) throw new Error("Unable to submit playbook for review.");
      }
      setStatus("Submitted for review.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.slice(0, 128) : "Unable to submit playbook for review.");
    } finally {
      setSaving(false);
    }
  };

  const decide = async (decision: "APPROVED" | "ARCHIVED") => {
    setError("");
    if (decision === "APPROVED" && !reason.trim()) {
      setError("A reason is required to approve.");
      return;
    }
    setSaving(true);
    try {
      if (onDecision) {
        await onDecision(decision, reason.trim());
      } else {
        const response = await fetch(`/api/ai/playbooks/${encodeURIComponent(playbook.id)}/decision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, reason: reason.trim() || undefined }),
        });
        if (!response.ok) throw new Error("Unable to save decision.");
      }
      setStatus(decision === "APPROVED" ? "Approved." : "Archived.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.slice(0, 128) : "Unable to save decision.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <article aria-label="Sabah playbook" className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{playbook.name.slice(0, 128)}</h3>
        <span className="rounded bg-muted px-2 py-0.5 text-xs">{playbook.state}</span>
      </div>
      <p className="max-h-16 overflow-hidden text-sm text-muted-foreground">{playbook.description.slice(0, 256)}</p>
      <p className="text-xs">Version {playbook.version} · {playbook.freshness ?? "Freshness unavailable"}{playbook.evaluationStatus ? ` · Evaluation ${playbook.evaluationStatus}` : ""}</p>
      <div className="flex flex-wrap gap-1">
        {(playbook.requiredContext ?? []).slice(0, 16).map((item) => <span className="rounded border px-1.5 py-0.5 text-xs" key={item}>{item.slice(0, 64)}</span>)}
        {(playbook.allowedCapabilities ?? []).slice(0, 16).map((item) => <span className="rounded border px-1.5 py-0.5 text-xs" key={item}>{item.slice(0, 80)}</span>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {(playbook.sources ?? []).map((source, index) => safeHref(source.href) ? <a className="text-xs underline" key={`${source.entityId ?? index}`} href={source.href}>{String(source.label ?? "Source").slice(0, 80)}</a> : null)}
      </div>
      <section aria-label="Version history">
        <h4 className="text-xs font-semibold">Immutable version history</h4>
        {[...versions].sort((a, b) => a.version - b.version).map((version) => <p className="text-xs text-muted-foreground" key={`${version.id}-${version.version}`}>Version {version.version} · {version.state}</p>)}
      </section>
      {canDecide && playbook.state === "DRAFT" && <div className="space-y-2">
        <button type="button" disabled={saving} onClick={() => void submitReview()} className="rounded border px-2 py-1 text-xs disabled:opacity-50">Submit for review</button>
      </div>}
      {canDecide && playbook.state === "IN_REVIEW" && <div className="space-y-2">
        <label className="block text-xs" htmlFor={`playbook-reason-${playbook.id}`}>Decision reason</label>
        <input id={`playbook-reason-${playbook.id}`} maxLength={128} value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded border px-2 py-1 text-sm" />
        <div className="flex gap-2">
          <button type="button" disabled={saving} onClick={() => void decide("APPROVED")} className="rounded border px-2 py-1 text-xs disabled:opacity-50">Approve</button>
          <button type="button" disabled={saving} onClick={() => void decide("ARCHIVED")} className="rounded border px-2 py-1 text-xs disabled:opacity-50">Archive</button>
        </div>
      </div>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    </article>
  );
}
