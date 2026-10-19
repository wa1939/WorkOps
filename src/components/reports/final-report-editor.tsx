"use client";

import React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, Send, Sparkles } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { ReportStyleProposals, type ReportStyleProposalMetadata } from "@/components/reports/report-style-proposals";

interface FinalReportEditorProps {
    reportId: string;
    initialFinal: string;
    submittedAt: string | null;
    styleMemo: string | null;
    pendingProposals?: ReportStyleProposalMetadata[];
}

export function FinalReportEditor({ reportId, initialFinal, submittedAt, styleMemo, pendingProposals = [] }: FinalReportEditorProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [value, setValue] = useState(initialFinal);
    const [saving, setSaving] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const save = async () => {
        if (!value.trim()) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/reports/${reportId}/final`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ finalBody: value }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast({ title: "Final saved", description: "Your edited version is stored." });
            router.refresh();
        } catch (err) {
            toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const submit = async () => {
        if (!value.trim()) return;
        setSubmitting(true);
        try {
            const res = await fetch(`/api/reports/${reportId}/final`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ finalBody: value, approved: true, learn: true }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            toast({
                title: "Submitted",
                description: data.learningDisabled
                    ? "Report submitted. Personal learning is disabled."
                    : data.learningProposalId
                        ? `Report submitted. Style proposal ${data.learningProposalId} is pending your approval.`
                        : data.learned
                            ? "Sabah learned from your writing style and selection choices."
                            : "Report submitted, but personal learning was not recorded.",
            });
            router.refresh();
        } catch (err) {
            toast({ title: "Submit failed", description: (err as Error).message, variant: "destructive" });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Card className="mt-6 print:hidden">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Your final version
                    </CardTitle>
                    {submittedAt && (
                        <Badge variant="outline" className="text-xs">
                            Submitted {formatDate(new Date(submittedAt))}
                        </Badge>
                    )}
                </div>
                <p className="text-sm text-muted-foreground">
                    Edit the summary to what you actually send to management. When you submit, Sabah will try to learn
                    your writing style and which work you choose to include, merge, or leave out.
                </p>
            </CardHeader>
            <CardContent className="space-y-3">
                <Textarea
                    dir="auto"
                    rows={12}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="font-normal leading-relaxed"
                    placeholder="Paste or edit the version you send to management…"
                />
                <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={save} disabled={saving || !value.trim() || Boolean(submittedAt)}>
                        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save final
                    </Button>
                    <Button onClick={submit} disabled={submitting || !value.trim() || Boolean(submittedAt)}>
                        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Submit report &amp; try learning
                    </Button>
                </div>

                <details className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium">What Sabah has learned about your style and selection</summary>
                    {styleMemo ? (
                        <p className="mt-2 whitespace-pre-line text-muted-foreground" dir="auto">
                            {styleMemo}
                        </p>
                    ) : (
                        <p className="mt-2 text-muted-foreground">
                            Nothing yet — submit a final version to start teaching it.
                        </p>
                    )}
                </details>
                <ReportStyleProposals proposals={pendingProposals} />
            </CardContent>
        </Card>
    );
}
