"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const FALLBACK_CATEGORIES = [
    "account_security",
    "task",
    "digest",
    "suggestion",
    "weekly_recording_gap",
    "weekly_completion_checkin",
    "stale_task_update",
];

const CHANNELS = ["email", "in_app", "push"] as const;
const STATES = ["PENDING", "SENDING", "ACCEPTED", "DELIVERED", "FAILED", "BOUNCED", "SUPPRESSED", "EXPIRED"] as const;
type Tab = "rules" | "log" | "test";
type Channel = (typeof CHANNELS)[number];
type DeliveryState = (typeof STATES)[number];

type RulesPayload = {
    categories: string[];
    config: Array<{ key: string; value: string; configured: boolean; updatedAt: string }>;
    policy: { categories: string[]; internalDomains: string[] };
};

type RecipientPreview = {
    category: string;
    configKey: string;
    recipients: string[];
    validation: {
        valid: string[];
        invalid: string[];
        duplicatesRemoved: string[];
        externalBlocked: string[];
    };
    previewOnly: boolean;
    updatedAt: string | null;
};

type DeliveryRow = {
    id: string;
    event: { category: string; sourceType: string };
    channel: string;
    destinationKey: string;
    state: string;
    attempts: number;
    providerId: string | null;
    lastError: string | null;
    createdAt: string;
    updatedAt: string;
};

type LogPayload = {
    rows: DeliveryRow[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
};

type RequestError = Error & { status?: number };

const EMPTY_RULES: RulesPayload = {
    categories: FALLBACK_CATEGORIES,
    config: [],
    policy: { categories: FALLBACK_CATEGORIES, internalDomains: [] },
};

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
        response = await fetch(input, { cache: "no-store", ...init });
    } catch (cause) {
        throw new Error(cause instanceof Error ? cause.message : "Network request failed");
    }

    let body: unknown = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    if (!response.ok) {
        const error = new Error(
            body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
                ? (body as { error: string }).error
                : `Request failed (${response.status})`,
        ) as RequestError;
        error.status = response.status;
        throw error;
    }
    return body as T;
}

function formatDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function displayDestination(value: string): string {
    if (value.startsWith("***@")) return value;
    const at = value.lastIndexOf("@");
    return at > 0 ? `***@${value.slice(at + 1).toLowerCase()}` : "***";
}

function stateBadgeClass(state: string): string {
    if (state === "DELIVERED") return "border-transparent bg-primary text-primary-foreground";
    if (state === "ACCEPTED") return "border-transparent bg-secondary text-secondary-foreground";
    if (["FAILED", "BOUNCED"].includes(state)) return "border-transparent bg-destructive text-destructive-foreground";
    return "text-foreground";
}

export function CommunicationsManager() {
    const [tab, setTab] = useState<Tab>("rules");
    const [rules, setRules] = useState<RulesPayload>(EMPTY_RULES);
    const [recipientPreviews, setRecipientPreviews] = useState<Record<string, RecipientPreview>>({});
    const [log, setLog] = useState<LogPayload | null>(null);
    const [logCategory, setLogCategory] = useState("");
    const [logChannel, setLogChannel] = useState("");
    const [logState, setLogState] = useState("");
    const [testCategory, setTestCategory] = useState("task");
    const [loading, setLoading] = useState(true);
    const [logLoading, setLogLoading] = useState(false);
    const [testSending, setTestSending] = useState(false);
    const [queuedId, setQueuedId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [logError, setLogError] = useState<string | null>(null);

    const categories = useMemo(
        () => (rules.categories.length > 0 ? rules.categories : FALLBACK_CATEGORIES),
        [rules.categories],
    );

    useEffect(() => {
        let cancelled = false;
        const loadRules = async () => {
            setLoading(true);
            setError(null);
            try {
                const loaded = await requestJson<RulesPayload>("/api/admin/communications?view=rules");
                if (cancelled) return;
                setRules(loaded);
                if (loaded.categories.length > 0) {
                    setTestCategory((current) => loaded.categories.includes(current) ? current : loaded.categories[0]);
                }

                const previews = await Promise.all(loaded.categories.map(async (category) => {
                    const preview = await requestJson<RecipientPreview>(
                        `/api/admin/communications?view=recipients&category=${encodeURIComponent(category)}`,
                    );
                    return [category, preview] as const;
                }));
                if (!cancelled) setRecipientPreviews(Object.fromEntries(previews));
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "Unable to load communications rules");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        void loadRules();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (tab !== "log") return;
        let cancelled = false;
        const loadLog = async () => {
            setLogLoading(true);
            setLogError(null);
            const params = new URLSearchParams({ view: "log", page: "1", pageSize: "25" });
            if (logCategory) params.set("category", logCategory);
            if (logChannel) params.set("channel", logChannel);
            if (logState) params.set("state", logState);
            try {
                const loaded = await requestJson<LogPayload>(`/api/admin/communications?${params.toString()}`);
                if (!cancelled) setLog(loaded);
            } catch (cause) {
                if (!cancelled) {
                    setLog(null);
                    setLogError(cause instanceof Error ? cause.message : "Unable to load delivery log");
                }
            } finally {
                if (!cancelled) setLogLoading(false);
            }
        };
        void loadLog();
        return () => {
            cancelled = true;
        };
    }, [tab, logCategory, logChannel, logState]);

    const queueTestSend = async () => {
        setTestSending(true);
        setQueuedId(null);
        setError(null);
        try {
            const result = await requestJson<{ id: string }>("/api/admin/communications", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "test-send", channel: "email", category: testCategory }),
            });
            setQueuedId(result.id);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Unable to queue test notification");
        } finally {
            setTestSending(false);
        }
    };

    return (
        <section className="space-y-4" aria-labelledby="communications-heading">
            <div>
                <h1 id="communications-heading" className="text-3xl font-bold tracking-tight">Communications</h1>
                <p className="text-muted-foreground">Review notification rules, delivery outcomes, and a safe admin-only test queue.</p>
            </div>

            <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="space-y-4">
                <TabsList aria-label="Communications views">
                    <TabsTrigger value="rules">Rules</TabsTrigger>
                    <TabsTrigger value="log">Delivery log</TabsTrigger>
                    <TabsTrigger value="test">Test send</TabsTrigger>
                </TabsList>

                {error && (
                    <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <TabsContent value="rules" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Digest and reminder rules</CardTitle>
                            <CardDescription>Read-only configuration projection. Secret and credential values are never displayed.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <p role="status" className="text-sm text-muted-foreground">Loading communication rules…</p>
                            ) : rules.config.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No digest or reminder configuration is currently set.</p>
                            ) : (
                                <dl className="divide-y rounded-md border">
                                    {rules.config.map((item) => (
                                        <div key={item.key} className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-4">
                                            <dt className="font-medium">{item.key}</dt>
                                            <dd className="text-sm text-muted-foreground">{item.configured ? item.value || "Configured" : "Not configured"}</dd>
                                        </div>
                                    ))}
                                </dl>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Eligible recipients preview</CardTitle>
                            <CardDescription>Preview only. This view never sends a notification.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid gap-3 md:grid-cols-2">
                                {categories.map((category) => {
                                    const preview = recipientPreviews[category];
                                    return (
                                        <div key={category} className="rounded-md border p-3">
                                            <p className="font-medium">{category}</p>
                                            {!preview ? (
                                                <p className="mt-1 text-sm text-muted-foreground">Loading recipients…</p>
                                            ) : preview.recipients.length === 0 ? (
                                                <p className="mt-1 text-sm text-muted-foreground">No eligible recipients.</p>
                                            ) : (
                                                <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">
                                                    {preview.recipients.map((recipient) => <li key={recipient}>{recipient}</li>)}
                                                </ul>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="log" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Delivery log</CardTitle>
                            <CardDescription>Destinations and errors are server-redacted; delivery state remains truthful.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-3">
                                <label className="grid gap-1 text-sm">
                                    Category
                                    <select aria-label="Delivery log category" className="rounded-md border bg-background px-2 py-2" value={logCategory} onChange={(event) => setLogCategory(event.target.value)}>
                                        <option value="">All categories</option>
                                        {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                                    </select>
                                </label>
                                <label className="grid gap-1 text-sm">
                                    Channel
                                    <select aria-label="Delivery log channel" className="rounded-md border bg-background px-2 py-2" value={logChannel} onChange={(event) => setLogChannel(event.target.value)}>
                                        <option value="">All channels</option>
                                        {CHANNELS.map((channel) => <option key={channel} value={channel}>{channel}</option>)}
                                    </select>
                                </label>
                                <label className="grid gap-1 text-sm">
                                    State
                                    <select aria-label="Delivery log state" className="rounded-md border bg-background px-2 py-2" value={logState} onChange={(event) => setLogState(event.target.value)}>
                                        <option value="">All states</option>
                                        {STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                                    </select>
                                </label>
                            </div>

                            {logError && <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{logError}</div>}
                            {logLoading && <p role="status" className="text-sm text-muted-foreground">Loading delivery log…</p>}
                            {!logLoading && !logError && log && log.rows.length === 0 && <p className="text-sm text-muted-foreground">No deliveries matched the selected filters.</p>}
                            {!logLoading && !logError && log && log.rows.length > 0 && (
                                <div className="overflow-x-auto rounded-md border">
                                    <table className="w-full text-left text-sm">
                                        <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
                                            <tr>
                                                <th className="p-3">Event</th>
                                                <th className="p-3">Channel</th>
                                                <th className="p-3">Destination</th>
                                                <th className="p-3">State</th>
                                                <th className="p-3">Attempts</th>
                                                <th className="p-3">Provider</th>
                                                <th className="p-3">Last error</th>
                                                <th className="p-3">Created</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y">
                                            {log.rows.map((row) => (
                                                <tr key={row.id}>
                                                    <td className="p-3"><div className="font-medium">{row.event.category}</div><div className="text-xs text-muted-foreground">{row.event.sourceType}</div></td>
                                                    <td className="p-3">{row.channel}</td>
                                                    <td className="p-3 font-mono text-xs">{displayDestination(row.destinationKey)}</td>
                                                    <td className="p-3"><span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${stateBadgeClass(row.state)}`}>{row.state}</span></td>
                                                    <td className="p-3">{row.attempts}</td>
                                                    <td className="p-3">{row.providerId || "—"}</td>
                                                    <td className="max-w-xs p-3 text-xs text-muted-foreground">{row.lastError || "—"}</td>
                                                    <td className="whitespace-nowrap p-3 text-xs text-muted-foreground">{formatDate(row.createdAt)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    <p className="border-t p-3 text-xs text-muted-foreground">Showing {log.rows.length} of {log.total} deliveries.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="test">
                    <Card>
                        <CardHeader>
                            <CardTitle>Test send</CardTitle>
                            <CardDescription>Queues one email to your signed-in admin address. The API ignores broadcast destinations.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <label className="grid max-w-sm gap-1 text-sm">
                                Category
                                <select aria-label="Test send category" className="rounded-md border bg-background px-2 py-2" value={testCategory} onChange={(event) => setTestCategory(event.target.value)}>
                                    {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                                </select>
                            </label>
                            <Button onClick={() => void queueTestSend()} disabled={testSending}>
                                {testSending ? "Queueing…" : "Queue test notification"}
                            </Button>
                            {queuedId && <p role="status" className="text-sm text-muted-foreground">Queued delivery <code>{queuedId}</code>.</p>}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </section>
    );
}
