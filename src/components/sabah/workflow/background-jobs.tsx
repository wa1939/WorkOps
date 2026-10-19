"use client";

import React, { useEffect, useState } from "react";

export type BackgroundJob = {
    id: string;
    type: string;
    status: string;
    retryCount: number;
    maxAttempts: number;
    checkpoint?: string | null;
    correlationId?: string | null;
    recovery?: string | null;
};

export type JobStatusRef = { id: string; url: string };
export type JobFetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
const defaultFetcher: JobFetcher = async (url, init) => {
    const response = await fetch(url, init);
    return { ok: response.ok, json: async (): Promise<unknown> => response.json() };
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | null {
    return typeof value === "string" && value.length <= max ? value : null;
}

function parseJob(value: unknown): BackgroundJob | null {
    if (!isRecord(value)) return null;
    const id = boundedText(value.id, 160);
    const type = boundedText(value.type, 128);
    const status = boundedText(value.status, 64);
    const retryCount = value.retryCount;
    const maxAttempts = value.maxAttempts;
    if (!id || !type || !status || typeof retryCount !== "number" || !Number.isSafeInteger(retryCount) || retryCount < 0 || typeof maxAttempts !== "number" || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) return null;
    const checkpoint = value.checkpoint === null || value.checkpoint === undefined ? null : boundedText(value.checkpoint, 512);
    const correlationId = value.correlationId === null || value.correlationId === undefined ? null : boundedText(value.correlationId, 160);
    const recovery = value.recovery === null || value.recovery === undefined ? null : boundedText(value.recovery, 512);
    if (value.checkpoint !== null && value.checkpoint !== undefined && checkpoint === null) return null;
    if (value.correlationId !== null && value.correlationId !== undefined && correlationId === null) return null;
    if (value.recovery !== null && value.recovery !== undefined && recovery === null) return null;
    return { id, type, status, retryCount, maxAttempts, checkpoint, correlationId, recovery };
}

function parseJobResponse(value: unknown): BackgroundJob | null {
    if (isRecord(value) && "job" in value) return parseJobResponse(value.job);
    return parseJob(value);
}

const terminalStatuses = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

export function nextPollingDelay(attempt: number, hidden: boolean): number {
    const exponent = Math.min(Math.max(Number.isFinite(attempt) ? Math.floor(attempt) : 0, 0), 5);
    return (hidden ? 30_000 : 2_000) * 2 ** exponent;
}

export function BackgroundJobs({
    initialJobs = [],
    statusUrls = [],
    fetcher = defaultFetcher,
    tick = true,
    showEmpty = false,
}: {
    initialJobs?: BackgroundJob[];
    statusUrls?: JobStatusRef[];
    fetcher?: JobFetcher;
    tick?: boolean;
    showEmpty?: boolean;
}) {
    const [jobs, setJobs] = useState<BackgroundJob[]>(initialJobs);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!fetcher || statusUrls.length === 0) return undefined;
        let disposed = false;
        let attempt = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const load = async () => {
            try {
                const results = await Promise.all(statusUrls.slice(0, 20).map(async (ref) => {
                    try {
                        const response = await fetcher(ref.url);
                        if (!response.ok) return null;
                        return parseJobResponse(await response.json());
                    } catch {
                        return null;
                    }
                }));
                if (disposed) return;
                const validJobs = results.filter((job): job is BackgroundJob => job !== null);
                if (validJobs.length > 0) {
                    setJobs(validJobs);
                    setMessage(null);
                } else {
                    setMessage("Automation status is temporarily unavailable");
                }
                attempt = validJobs.length > 0 ? 0 : attempt + 1;
                if (tick && validJobs.some((job) => !terminalStatuses.has(job.status))) timer = setTimeout(load, nextPollingDelay(attempt, document.hidden));
            } catch {
                if (!disposed) {
                    setMessage("Automation status is temporarily unavailable");
                    if (tick) timer = setTimeout(load, nextPollingDelay(attempt++, document.hidden));
                }
            }
        };
        void load();
        const onVisibility = () => {
            if (!document.hidden) {
                if (timer) clearTimeout(timer);
                void load();
            }
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            disposed = true;
            if (timer) clearTimeout(timer);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [fetcher, statusUrls, tick]);

    const cancel = async (id: string) => {
        if (!fetcher) {
            setMessage("Stop control is unavailable");
            return;
        }
        try {
            const response = await fetcher(`/api/ai/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
            setMessage(response.ok ? "Stop requested" : "Stop control is unavailable");
        } catch {
            setMessage("Stop control is unavailable");
        }
    };

    if (!jobs.length && !message && !showEmpty) return null;
    return (
        <section aria-label="Background automation" className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between"><h2 className="font-semibold">Background automation</h2><span className="text-xs text-muted-foreground">{tick && statusUrls.length > 0 ? "Live status" : "Status"}</span></div>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
            {!jobs.length && !message && <p className="text-sm text-muted-foreground">No active background automation.</p>}
            <ul className="space-y-3">{jobs.map((job) => <li key={job.id} className="rounded-md bg-muted/30 p-3 text-sm"><div className="flex items-center justify-between"><span className="font-medium">{job.type}</span><span>{job.status}</span></div>{job.checkpoint && <p className="text-muted-foreground">Checkpoint: {job.checkpoint}</p>}{job.correlationId && <p className="text-muted-foreground">Correlation: {job.correlationId}</p>}{job.recovery && <p className="text-muted-foreground">Recovery: {job.recovery}</p>}<p className="text-xs text-muted-foreground">Attempt {job.retryCount} of {job.maxAttempts}</p>{!terminalStatuses.has(job.status) && <button type="button" className="mt-2 underline" onClick={() => void cancel(job.id)}>Stop</button>}</li>)}</ul>
        </section>
    );
}
