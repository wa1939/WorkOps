"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Megaphone } from "lucide-react";

interface PublicAnnouncement {
    id: string;
    title: string;
    body: string;
    variant?: string;
    status?: string;
    priority?: string;
    createdAt: string;
    publishAt?: string | null;
    expiresAt?: string | null;
    ctaUrl?: string | null;
}

function isSameOriginRelativeUrl(value: string | null | undefined): value is string {
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) {
        return false;
    }
    try {
        return new URL(value, "https://departmenthub.invalid").origin === "https://departmenthub.invalid";
    } catch {
        return false;
    }
}

function parseResponse(data: unknown): PublicAnnouncement[] {
    if (!data || typeof data !== "object") return [];
    const record = data as { announcements?: unknown; announcement?: unknown };
    const values = Array.isArray(record.announcements)
        ? record.announcements
        : record.announcement ? [record.announcement] : [];
    return values.filter((value): value is PublicAnnouncement => {
        if (!value || typeof value !== "object") return false;
        const item = value as Partial<PublicAnnouncement>;
        return typeof item.id === "string" && typeof item.title === "string" && typeof item.body === "string" && typeof item.createdAt === "string";
    }).filter((item) => !item.status || item.status === "PUBLISHED");
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AnnouncementsPage() {
    const [announcements, setAnnouncements] = useState<PublicAnnouncement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch("/api/announcements/active?all=true", { cache: "no-store" })
            .then(async (response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then((data: unknown) => {
                if (!cancelled) setAnnouncements(parseResponse(data));
            })
            .catch(() => {
                if (!cancelled) setError("Couldn't load announcements right now.");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="mx-auto max-w-3xl space-y-6">
            <div>
                <div className="flex items-center gap-2">
                    <Megaphone className="h-5 w-5 text-primary" aria-hidden="true" />
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">Announcements</h1>
                </div>
                <p className="mt-1 text-muted-foreground">Published updates for your audience.</p>
            </div>

            {loading ? (
                <div className="flex justify-center rounded-lg border border-dashed p-10" aria-busy="true">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading announcements" />
                </div>
            ) : error ? (
                <p role="alert" className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive">{error}</p>
            ) : announcements.length === 0 ? (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No announcements right now.</p>
            ) : (
                <div role="list" className="space-y-4">
                    {announcements.map((announcement) => (
                        <article key={announcement.id} role="listitem" className="rounded-lg border bg-card p-5 shadow-sm">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                        {announcement.priority ?? announcement.variant ?? "Update"}
                                    </p>
                                    <h2 className="mt-1 text-lg font-semibold">{announcement.title}</h2>
                                </div>
                                <time dateTime={announcement.publishAt ?? announcement.createdAt} className="shrink-0 text-xs text-muted-foreground">
                                    {formatDate(announcement.publishAt ?? announcement.createdAt)}
                                </time>
                            </div>
                            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground/85">{announcement.body}</p>
                            {isSameOriginRelativeUrl(announcement.ctaUrl) && (
                                <a href={announcement.ctaUrl} className="mt-3 inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
                                    Read more
                                </a>
                            )}
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}
