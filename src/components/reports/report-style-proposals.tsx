"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

export type ReportStyleProposalMetadata = {
  id: string;
  content: string;
  provenance: string;
  state?: "PROPOSED";
  createdAt?: string;
  updatedAt?: string;
};

export function ReportStyleProposals({ proposals }: { proposals: ReportStyleProposalMetadata[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (proposals.length === 0) return null;

  const decide = async (proposal: ReportStyleProposalMetadata, approved: boolean) => {
    const reason = reasons[proposal.id]?.trim() ?? "";
    if (!reason) return;
    setPendingId(proposal.id);
    try {
      const response = await fetch(`/api/reports/lessons/${proposal.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved, reason }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      toast({
        title: approved ? "Style proposal approved" : "Style proposal rejected",
        description: data.disabled
          ? "Personal learning is disabled; no memory was changed."
          : approved
            ? "The approved style rules will guide future drafts."
            : "The proposal will not guide future drafts.",
      });
      router.refresh();
    } catch (error) {
      toast({ title: "Style decision failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4" aria-label="Pending style proposals">
      <div>
        <h3 className="font-semibold">Pending style proposals</h3>
        <p className="text-sm text-muted-foreground">Review each generated abstract rule set. A proposal is not active until you approve it.</p>
      </div>
      {proposals.map((proposal) => (
        <article key={proposal.id} className="space-y-2 rounded-md border bg-background p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Proposal {proposal.id}</span>
            <span>{proposal.provenance}</span>
          </div>
          <p className="whitespace-pre-line text-sm" dir="auto">{proposal.content}</p>
          <Textarea
            aria-label={`Decision reason ${proposal.id}`}
            value={reasons[proposal.id] ?? ""}
            onChange={(event) => setReasons((current) => ({ ...current, [proposal.id]: event.target.value }))}
            placeholder="Explain your approval or rejection"
            rows={2}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => decide(proposal, true)} disabled={pendingId !== null || !reasons[proposal.id]?.trim()}>
              {pendingId === proposal.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
              Approve {proposal.id}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => decide(proposal, false)} disabled={pendingId !== null || !reasons[proposal.id]?.trim()}>
              <X className="mr-2 h-4 w-4" />
              Reject {proposal.id}
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
