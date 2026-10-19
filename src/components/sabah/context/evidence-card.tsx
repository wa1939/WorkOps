"use client";
import React from "react";
import type { SourceRef } from "@/lib/sabah/intelligence/contracts";

const isSafeHref = (href: unknown): href is string => typeof href === "string" && href.startsWith("/") && !href.startsWith("//") && !href.includes("\\") && !/[\u0000-\u001f\u007f]/.test(href);

export function EvidenceCard({ source, sourceLabel, freshness, relation, confidence }: { source: SourceRef; sourceLabel: string; freshness: string; relation: string; confidence: "HIGH" | "MEDIUM" | "LOW" }) {
  return <article className="rounded-lg border border-border p-3" aria-label="Workspace evidence">
    <div className="flex items-baseline justify-between gap-2"><span className="font-medium">{sourceLabel}</span><span className="text-xs text-muted-foreground">{source.entityType} · {freshness}</span></div>
    <p className="text-sm text-muted-foreground">{relation}</p><p className="text-xs">Confidence: {confidence}</p>
    {isSafeHref(source.href) && <a className="text-sm underline" href={source.href}>{source.label}</a>}
  </article>;
}
