"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Draft = { to: string; subject: string; body: string; scheduledEventId: string | null };
type RewritePreview = Pick<Draft, "subject" | "body">;
type HistoryEvent = { id: string; triggerType: string; scheduledDate: string; sentAt: string | null };

export function FollowUpDraftPanel({ taskId, canManage }: { taskId: string; canManage: boolean }) {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [preview, setPreview] = useState<RewritePreview | null>(null);
    const [history, setHistory] = useState<HistoryEvent[]>([]);
    const [confirmed, setConfirmed] = useState(false);
    const [message, setMessage] = useState("");
    const [loadError, setLoadError] = useState(false);

    const load = useCallback(() => {
        setLoadError(false);
        Promise.all([
            fetch(`/api/pmo/actions/${taskId}/draft`).then((response) => {
                if (!response.ok) throw new Error("Failed to load draft");
                return response.json();
            }),
            fetch(`/api/pmo/actions/${taskId}/follow-ups`).then((response) => {
                if (!response.ok) throw new Error("Failed to load follow-ups");
                return response.json();
            }),
        ])
            .then(([nextDraft, events]) => {
                setDraft(nextDraft);
                setHistory(events);
            })
            .catch(() => setLoadError(true));
    }, [taskId]);

    useEffect(() => {
        load();
    }, [load]);

    async function copy(value: string) {
        try {
            await navigator.clipboard.writeText(value);
            setMessage("Copied. This has not been recorded as sent.");
        } catch {
            setMessage("Copy failed. Select the text and copy it manually.");
        }
    }

    async function rewrite() {
        if (!draft) return;
        const response = await fetch(`/api/pmo/actions/${taskId}/draft/rewrite`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: draft.subject, body: draft.body }),
        });
        if (!response.ok) {
            setMessage(
                response.status === 403
                    ? "You are not authorized to rewrite this draft."
                    : "AI rewrite failed; your current draft is unchanged.",
            );
            return;
        }
        const body = await response.json();
        setPreview(body.preview);
        setMessage("Review the AI preview before accepting it.");
    }

    function acceptPreview() {
        if (!draft || !preview) return;
        setDraft({ ...draft, ...preview });
        setPreview(null);
        setMessage("AI preview accepted. The follow-up is still not marked sent.");
    }

    async function markSent() {
        if (!draft || !confirmed) return;
        const response = await fetch(`/api/pmo/actions/${taskId}/follow-ups`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...(draft.scheduledEventId ? { eventId: draft.scheduledEventId } : {}),
                confirmedSent: true,
                recipient: draft.to,
                subject: draft.subject,
                body: draft.body,
            }),
        });
        if (!response.ok) {
            setMessage("Unable to record follow-up.");
            return;
        }
        const event = await response.json();
        setHistory((items) => [event, ...items.filter((item) => item.id !== event.id)]);
        setDraft({ ...draft, scheduledEventId: null });
        setConfirmed(false);
        setMessage("Follow-up recorded as explicitly confirmed sent.");
    }

    if (loadError) {
        return (
            <Card id="follow-up">
                <CardContent className="space-y-3 p-6" role="alert">
                    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>Couldn&apos;t load the follow-up draft.</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={load}>
                        Retry
                    </Button>
                </CardContent>
            </Card>
        );
    }

    if (!draft) {
        return (
            <Card id="follow-up">
                <CardHeader>
                    <CardTitle>Follow-up draft</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-40 w-full" />
                    <div className="flex flex-wrap gap-2">
                        <Skeleton className="h-9 w-32" />
                        <Skeleton className="h-9 w-24" />
                        <Skeleton className="h-9 w-24" />
                    </div>
                    <span className="sr-only">Loading follow-up draft…</span>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card id="follow-up">
            <CardHeader>
                <CardTitle>Follow-up draft</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <Input
                    value={draft.to}
                    onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                    aria-label="Recipient"
                />
                <Input
                    value={draft.subject}
                    onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                    aria-label="Subject"
                />
                <Textarea
                    rows={10}
                    value={draft.body}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    aria-label="Body"
                    dir="auto"
                />
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => copy(draft.to)}>
                        Copy recipient
                    </Button>
                    <Button variant="outline" onClick={() => copy(draft.subject)}>
                        Copy subject
                    </Button>
                    <Button variant="outline" onClick={() => copy(draft.body)}>
                        Copy body
                    </Button>
                    <Button variant="outline" onClick={() => copy(`${draft.to}\n${draft.subject}\n\n${draft.body}`)}>
                        Copy all
                    </Button>
                    {canManage && (
                        <Button variant="secondary" onClick={rewrite}>
                            Preview AI rewrite
                        </Button>
                    )}
                </div>
                {preview && (
                    <div className="space-y-2 rounded-lg border bg-muted/40 p-3" aria-label="AI rewrite preview">
                        <p className="font-medium">AI preview</p>
                        <p className="text-sm font-medium">{preview.subject}</p>
                        <p className="whitespace-pre-wrap text-sm" dir="auto">
                            {preview.body}
                        </p>
                        <div className="flex gap-2">
                            <Button size="sm" onClick={acceptPreview}>
                                Accept preview
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setPreview(null)}>
                                Discard preview
                            </Button>
                        </div>
                    </div>
                )}
                {canManage && (
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(event) => setConfirmed(event.target.checked)}
                        />
                        I independently confirm I sent this using my email client
                    </label>
                )}
                {canManage && (
                    <Button disabled={!confirmed} onClick={markSent}>
                        {draft.scheduledEventId ? "Mark scheduled follow-up sent" : "Record manual follow-up sent"}
                    </Button>
                )}
                {message && <p className="text-sm text-muted-foreground">{message}</p>}
                <div className="border-t pt-3">
                    <p className="font-medium">History</p>
                    {history.map((event) => (
                        <p key={event.id} className="text-sm text-muted-foreground">
                            {event.triggerType}{" "}
                            {event.sentAt
                                ? `Sent ${new Date(event.sentAt).toLocaleString()}`
                                : `Scheduled ${new Date(event.scheduledDate).toLocaleDateString()}`}
                        </p>
                    ))}
                </div>
            </CardContent>
        </Card>
    );
}
