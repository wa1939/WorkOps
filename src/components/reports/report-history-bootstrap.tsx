"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2, Upload } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ReportStyleProposals, type ReportStyleProposalMetadata } from "@/components/reports/report-style-proposals";

export type ReportHistoryMetadata = {
  id: string;
  date: string;
  sourceId: string;
  checksum: string;
  provenance: string;
};

type DraftEntry = { date: string; content: string };

export function ReportHistoryBootstrap({ history, pendingProposals = [] }: { history: ReportHistoryMetadata[]; pendingProposals?: ReportStyleProposalMetadata[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [entries, setEntries] = useState<DraftEntry[]>([{ date: "", content: "" }]);
  const [approved, setApproved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const updateEntry = (index: number, patch: Partial<DraftEntry>) => {
    setEntries((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry));
  };

  const submit = async () => {
    const complete = entries.filter((entry) => entry.date && entry.content.trim());
    if (!approved || complete.length === 0) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/reports/lessons/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true, entries: complete }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      toast({
        title: "History imported",
        description: data.disabled
          ? "Personal learning is disabled; no history or style proposal was persisted."
          : data.memoryId
            ? `${data.importedCount ?? 0} new example(s); style proposal ${data.memoryId} is pending your approval.`
            : `${data.importedCount ?? 0} new example(s); ${data.replayedCount ?? 0} replayed.`,
      });
      setEntries([{ date: "", content: "" }]);
      setApproved(false);
      router.refresh();
    } catch (error) {
      toast({ title: "History import failed", description: (error as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg"><Upload className="h-4 w-4 text-primary" />Report style history</CardTitle>
        <CardDescription>
          Add dated reports you personally approved. They are stored as actor-owned examples for writing style and selection only;
          they are never treated as current achievements. Repeating the same dates and text is safe and idempotent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ReportStyleProposals proposals={pendingProposals} />
        {history.length > 0 && (
          <div className="rounded-md border bg-muted/20 p-3 text-sm">
            <p className="font-medium">Approved examples already available</p>
            <div className="mt-2 flex flex-wrap gap-2" aria-label="Approved report history">
              {history.map((entry) => <span key={entry.id} className="rounded border px-2 py-1 text-muted-foreground">{entry.date}</span>)}
            </div>
          </div>
        )}
        <div className="space-y-3">
          {entries.map((entry, index) => (
            <div className="grid gap-2 md:grid-cols-[10rem_1fr]" key={index}>
              <label className="space-y-1 text-sm font-medium">
                <span>History date {index + 1}</span>
                <input
                  aria-label={`History date ${index + 1}`}
                  type="date"
                  value={entry.date}
                  onChange={(event) => updateEntry(index, { date: event.target.value })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                <span>History text {index + 1}</span>
                <Textarea
                  aria-label={`History text ${index + 1}`}
                  dir="auto"
                  rows={4}
                  value={entry.content}
                  onChange={(event) => updateEntry(index, { content: event.target.value })}
                  placeholder="Paste the exact submitted report text"
                />
              </label>
            </div>
          ))}
        </div>
        {entries.length < 5 && <Button type="button" variant="outline" size="sm" onClick={() => setEntries((current) => [...current, { date: "", content: "" }])}><Plus className="mr-2 h-4 w-4" />Add another date</Button>}
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} className="mt-1" />
          <span>I approve using these dated reports as personal style and selection examples.</span>
        </label>
        <Button type="button" onClick={submit} disabled={submitting || !approved || !entries.some((entry) => entry.date && entry.content.trim())}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          Import approved history
        </Button>
      </CardContent>
    </Card>
  );
}
