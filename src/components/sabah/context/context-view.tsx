"use client";
import React from "react";
import type { DuplicateCandidate, SourceRef } from "@/lib/sabah/intelligence/contracts";
import { EvidenceCard } from "./evidence-card";
import { DuplicateCard } from "./duplicate-card";
import { MemoryCard, type MemoryCardRecord } from "./memory-card";
import { PlaybookCard, type PlaybookCardRecord, type PlaybookVersion } from "./playbook-card";

export type ContextSource = { id: string; kind: "record" | "document" | "metric" | "person"; title: string; freshness: string; href?: string };
export type ContextEvidence = { source: SourceRef; sourceLabel?: string; freshness?: string; relation?: string; confidence?: "HIGH" | "MEDIUM" | "LOW" };
const isSafeHref = (href: unknown): href is string => typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.includes("\\") && !/^[\/]*(?:[a-z][a-z\d+.-]*:)/i.test(href) && !/[\u0000-\u001f\u007f]/.test(href);
export function ContextView({ sources, evidence = [], duplicates = [], workflowId, stepId, memories = [], playbooks = [], canDecide = false, learningContextUnavailable = false, learningContextDegraded = false }: { sources: ContextSource[]; evidence?: ContextEvidence[]; duplicates?: DuplicateCandidate[]; workflowId?: string; stepId?: string; memories?: MemoryCardRecord[]; playbooks?: Array<{ playbook: PlaybookCardRecord; versions?: PlaybookVersion[] }>; canDecide?: boolean; learningContextUnavailable?: boolean; learningContextDegraded?: boolean }) {
  if (!sources.length && !evidence.length && !duplicates.length && !memories.length && !playbooks.length) {
    const message = learningContextUnavailable ? "Learning context unavailable." : learningContextDegraded ? "Learning context partially unavailable." : "No context attached to this conversation.";
    return <p className="p-4 text-sm text-muted-foreground">{message}</p>;
  }
  return <div className="space-y-3 p-3">{learningContextUnavailable ? <p className="text-sm text-muted-foreground">Learning context unavailable.</p> : learningContextDegraded && <p className="text-sm text-muted-foreground">Learning context partially unavailable.</p>}<ul aria-label="Sabah context sources" className="space-y-1.5">{sources.map((source) => <li key={source.id} className="rounded-lg border border-border px-2.5 py-1.5"><div className="flex items-baseline justify-between gap-2">{source.href && isSafeHref(source.href) ? <a className="text-sm font-medium underline" href={source.href}>{source.title}</a> : <span className="text-sm font-medium">{source.title}</span>}<span className="shrink-0 text-xs text-muted-foreground">{source.kind} · {source.freshness}</span></div></li>)}</ul>{evidence.map((item) => <EvidenceCard key={`${item.source.entityType}:${item.source.entityId}`} {...item} sourceLabel={item.sourceLabel ?? item.source.label} freshness={item.freshness ?? "CURRENT"} relation={item.relation ?? "workspace source"} confidence={item.confidence ?? "MEDIUM"} />)}{memories.slice(0, 8).map((memory) => <MemoryCard key={memory.id} memory={memory} canDecide={canDecide} />)}{playbooks.slice(0, 8).map(({ playbook, versions }) => <PlaybookCard key={playbook.id} playbook={playbook} versions={versions} canDecide={canDecide} />)}{workflowId && stepId && duplicates.map((candidate) => <DuplicateCard key={`${candidate.source.entityType}:${candidate.source.entityId}`} workflowId={workflowId} stepId={stepId} candidate={candidate} />)}</div>;
}
