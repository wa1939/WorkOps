"use client";
import React, { useEffect, useState } from "react";
import { PlaybookCard, type PlaybookCardRecord, type PlaybookVersion } from "@/components/sabah/context/playbook-card";
export type SabahPlaybooksProps = { canDecide?: boolean; initialPlaybooks?: readonly PlaybookCardRecord[] };

function boundedRecords(rows: readonly PlaybookCardRecord[]): PlaybookCardRecord[] {
  const latest = new Map<string, PlaybookCardRecord>();
  for (const row of rows) {
    if (!row || typeof row.playbookId !== "string" || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.description !== "string" || !Number.isInteger(row.version)) continue;
    const prior = latest.get(row.playbookId);
    if (!prior || row.version > prior.version) latest.set(row.playbookId, { ...row, name: row.name.slice(0, 128), description: row.description.slice(0, 256), requiredContext: row.requiredContext?.slice(0, 16), allowedCapabilities: row.allowedCapabilities?.slice(0, 16), sources: row.sources?.slice(0, 5) });
  }
  return Array.from(latest.values()).slice(0, 20);
}

export function SabahPlaybooks({ canDecide = false, initialPlaybooks = [] }: SabahPlaybooksProps) {
  const [items, setItems] = useState<PlaybookCardRecord[]>(() => boundedRecords(initialPlaybooks));
  const [versions, setVersions] = useState<Record<string, PlaybookVersion[]>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const rows = boundedRecords(initialPlaybooks);
    if (!rows.length) { setItems([]); return () => { active = false; }; }
    void Promise.all(rows.map(async (row) => {
      const response = await fetch(`/api/ai/playbooks/${encodeURIComponent(row.playbookId)}/versions`);
      if (!response.ok) throw new Error("Unable to load playbook history.");
      const body: unknown = await response.json();
      const list = body && typeof body === "object" && Array.isArray((body as { versions?: unknown }).versions) ? (body as { versions: unknown[] }).versions : [];
      const valid = list.filter((value): value is PlaybookVersion => !!value && typeof value === "object" && typeof (value as PlaybookVersion).id === "string" && Number.isInteger((value as PlaybookVersion).version) && typeof (value as PlaybookVersion).state === "string").slice(0, 16);
      return [row.playbookId, valid] as const;
    })).then((history) => { if (active) { setItems(rows); setVersions(Object.fromEntries(history)); } }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to load playbooks."); });
    return () => { active = false; };
  }, [initialPlaybooks]);
  const decide = async (id: string, decision: "APPROVED" | "ARCHIVED", reason?: string) => { const response = await fetch(`/api/ai/playbooks/${encodeURIComponent(id)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason }) }); if (!response.ok) throw new Error("Unable to save playbook decision."); setItems((current) => current.map((item) => item.id === id ? { ...item, state: decision } : item)); };
  const submitReview = async (id: string) => { const response = await fetch(`/api/ai/playbooks/${encodeURIComponent(id)}/review`, { method: "POST" }); if (!response.ok) throw new Error("Unable to submit playbook for review."); setItems((current) => current.map((item) => item.id === id ? { ...item, state: "IN_REVIEW" } : item)); };
  return <section aria-label="Sabah playbooks" className="space-y-4"><div><h2 className="text-xl font-semibold">Sabah Playbooks</h2><p className="text-sm text-muted-foreground">Submit immutable drafts for review, then approve or archive reviewed versions.</p></div>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{items.length === 0 && !error && <p className="text-sm text-muted-foreground">No playbooks available.</p>}<div className="grid gap-3 md:grid-cols-2">{items.map((item) => <PlaybookCard key={item.id} playbook={item} versions={versions[item.playbookId] ?? [item]} canDecide={canDecide} onDecision={(decision, reason) => decide(item.id, decision, reason)} onSubmitReview={() => submitReview(item.id)} />)}</div></section>;
}
