"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type AnnouncementPriority = "NORMAL" | "IMPORTANT" | "CRITICAL";

type DashboardAnnouncement = {
    id: string;
    title: string;
    body: string;
    variant: string;
    status?: string;
    isActive?: boolean;
    priority: AnnouncementPriority;
    createdAt: string;
    publishAt: string | null;
    expiresAt: string | null;
    ctaUrl: string | null;
    requireAcknowledgement: boolean;
};

type UnknownRecord = Record<string, unknown>;

const PRIORITIES: AnnouncementPriority[] = ["NORMAL", "IMPORTANT", "CRITICAL"];

const priorityStyles: Record<AnnouncementPriority, string> = {
    NORMAL: "border-border/70 bg-card",
    IMPORTANT: "border-amber-500/30 bg-amber-500/[0.04]",
    CRITICAL: "border-destructive/35 bg-destructive/[0.04]",
};

const variantStyles: Record<string, string> = {
    celebrate: "bg-primary/10 text-primary",
    info: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

function parsePriority(value: unknown): AnnouncementPriority {
    if (typeof value !== "string") return "NORMAL";
    const normalized = value.toUpperCase() as AnnouncementPriority;
    return PRIORITIES.includes(normalized) ? normalized : "NORMAL";
}

function parseAnnouncement(value: unknown): DashboardAnnouncement | null {
    if (!isRecord(value)) return null;
    if (
        typeof value.id !== "string" ||
        typeof value.title !== "string" ||
        typeof value.body !== "string" ||
        typeof value.createdAt !== "string"
    ) {
        return null;
    }

    return {
        id: value.id,
        title: value.title,
        body: value.body,
        variant: typeof value.variant === "string" ? value.variant : "info",
        status: typeof value.status === "string" ? value.status : undefined,
        isActive: typeof value.isActive === "boolean" ? value.isActive : undefined,
        priority: parsePriority(value.priority),
        createdAt: value.createdAt,
        publishAt: asNullableString(value.publishAt),
        expiresAt: asNullableString(value.expiresAt),
        ctaUrl: asNullableString(value.ctaUrl),
        requireAcknowledgement: value.requireAcknowledgement === true,
    };
}

function isCurrentlyPublished(announcement: DashboardAnnouncement, now = Date.now()): boolean {
    if (announcement.status !== undefined && announcement.status !== "PUBLISHED") return false;
    if (announcement.isActive === false) return false;

    if (announcement.publishAt !== null) {
        const publishTime = Date.parse(announcement.publishAt);
        if (!Number.isFinite(publishTime) || publishTime > now) return false;
    }

    if (announcement.expiresAt !== null) {
        const expiryTime = Date.parse(announcement.expiresAt);
        if (!Number.isFinite(expiryTime) || expiryTime <= now) return false;
    }

    return true;
}

function parseResponse(data: unknown): DashboardAnnouncement[] {
    if (!isRecord(data)) return [];
    const values = Array.isArray(data.announcements)
        ? data.announcements
        : data.announcement === null || data.announcement === undefined
            ? []
            : [data.announcement];

    return values
        .map(parseAnnouncement)
        .filter((announcement): announcement is DashboardAnnouncement => announcement !== null)
        .filter((announcement) => isCurrentlyPublished(announcement));
}

function isSameOriginRelativeUrl(value: string | null): value is string {
    if (
        value === null ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("\\") ||
        /[\u0000-\u001f]/.test(value)
    ) {
        return false;
    }

    try {
        const parsed = new URL(value, "https://departmenthub.invalid");
        return parsed.origin === "https://departmenthub.invalid";
    } catch {
        return false;
    }
}

function formatPublishDate(announcement: DashboardAnnouncement): string | null {
    const value = announcement.publishAt ?? announcement.createdAt;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function AnnouncementCta({ url }: { url: string | null }) {
    if (!isSameOriginRelativeUrl(url)) return null;

    return (
        <Button
            asChild
            variant="link"
            size="sm"
            className="min-h-[44px] px-0 text-start"
        >
            <Link href={url}>
                Read more
                <ArrowUpRight className="ms-1 h-4 w-4" aria-hidden="true" />
            </Link>
        </Button>
    );
}

function AnnouncementCard({ announcement }: { announcement: DashboardAnnouncement }) {
    const dateLabel = formatPublishDate(announcement);
    const tone = variantStyles[announcement.variant] ?? variantStyles.info;

    return (
        <Card
            role="listitem"
            className={cn("overflow-hidden", priorityStyles[announcement.priority])}
        >
            <CardHeader className="gap-3 p-5 pb-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={cn("rounded-full px-2 py-1 font-medium", tone)}>
                        {announcement.priority.toLowerCase()}
                    </span>
                    {dateLabel && (
                        <time dateTime={announcement.publishAt ?? announcement.createdAt} className="ms-auto">
                            {dateLabel}
                        </time>
                    )}
                </div>
                <CardTitle className="text-base leading-snug">{announcement.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 p-5 pt-0">
                <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">
                    {announcement.body}
                </p>
                <AnnouncementCta url={announcement.ctaUrl} />
            </CardContent>
        </Card>
    );
}

export function DashboardAnnouncements() {
    const [announcements, setAnnouncements] = useState<DashboardAnnouncement[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(() => new Set());
    const [dialogAnnouncementId, setDialogAnnouncementId] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [acknowledging, setAcknowledging] = useState(false);
    const [acknowledgementError, setAcknowledgementError] = useState<string | null>(null);
    const dialogHeadingRef = useRef<HTMLHeadingElement>(null);

    const loadAnnouncements = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/announcements/active");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data: unknown = await response.json();
            setAnnouncements(parseResponse(data));
        } catch {
            setAnnouncements([]);
            setError("Couldn’t load announcements right now.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadAnnouncements();
    }, [loadAnnouncements]);

    const nextCriticalAnnouncement = announcements.find(
        (announcement) =>
            announcement.priority === "CRITICAL" &&
            announcement.requireAcknowledgement &&
            !acknowledgedIds.has(announcement.id),
    );

    useEffect(() => {
        if (!nextCriticalAnnouncement) {
            setDialogOpen(false);
            return;
        }
        if (dialogAnnouncementId !== nextCriticalAnnouncement.id) {
            setDialogAnnouncementId(nextCriticalAnnouncement.id);
            setAcknowledgementError(null);
            setDialogOpen(true);
        }
    }, [dialogAnnouncementId, nextCriticalAnnouncement, acknowledgedIds]);

    const criticalAnnouncement = announcements.find(
        (announcement) =>
            announcement.id === dialogAnnouncementId &&
            announcement.priority === "CRITICAL" &&
            announcement.requireAcknowledgement &&
            !acknowledgedIds.has(announcement.id),
    ) ?? null;

    const acknowledge = async () => {
        if (!criticalAnnouncement || acknowledging) return;

        setAcknowledging(true);
        setAcknowledgementError(null);
        try {
            const response = await fetch(`/api/announcements/${criticalAnnouncement.id}/seen`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ acknowledge: true }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setAcknowledgedIds((current) => new Set(current).add(criticalAnnouncement.id));
            setDialogOpen(false);
        } catch {
            setAcknowledgementError("We couldn’t save your acknowledgement. Please try again.");
        } finally {
            setAcknowledging(false);
        }
    };

    const nonCriticalAnnouncements = announcements.filter(
        (announcement) =>
            !(announcement.priority === "CRITICAL" && announcement.requireAcknowledgement),
    );
    const visibleAnnouncements = nonCriticalAnnouncements.slice(0, 3);
    const hasOverflow = nonCriticalAnnouncements.length > visibleAnnouncements.length;

    return (
        <section aria-labelledby="dashboard-announcements-heading" className="space-y-4">
            <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <h2 id="dashboard-announcements-heading" className="text-base font-semibold tracking-tight">
                    Announcements
                </h2>
                <Link
                    href="/announcements"
                    className="ms-auto min-h-[44px] inline-flex items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                    View all
                </Link>
            </div>

            {loading ? (
                <Card aria-busy="true" className="border-dashed">
                    <CardContent className="flex min-h-24 items-center justify-center p-5">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
                        <span className="sr-only">Loading announcements</span>
                    </CardContent>
                </Card>
            ) : error ? (
                <Card role="alert" className="border-destructive/30 bg-destructive/[0.04]">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                        <p className="text-sm text-destructive">{error}</p>
                        <Button variant="outline" className="min-h-[44px]" onClick={() => void loadAnnouncements()}>
                            Try again
                        </Button>
                    </CardContent>
                </Card>
            ) : visibleAnnouncements.length > 0 ? (
                <>
                    <div role="list" className="grid gap-4">
                        {visibleAnnouncements.map((announcement) => (
                            <AnnouncementCard key={announcement.id} announcement={announcement} />
                        ))}
                    </div>
                    {hasOverflow && (
                        <p className="text-xs text-muted-foreground">
                            Showing the 3 latest announcements. <Link href="/announcements" className="underline underline-offset-4">View all</Link>
                        </p>
                    )}
                </>
            ) : !criticalAnnouncement ? (
                <Card className="border-dashed">
                    <CardContent className="p-5">
                        <CardDescription>No announcements right now.</CardDescription>
                    </CardContent>
                </Card>
            ) : null}

            <Dialog
                open={dialogOpen && criticalAnnouncement !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setDialogOpen(false);
                        setAcknowledgementError(null);
                    }
                }}
            >
                {criticalAnnouncement && (
                    <DialogContent
                        className="max-w-xl max-h-[calc(100vh-2rem)] overflow-y-auto [&>button]:min-h-[44px] [&>button]:min-w-[44px] [&>button]:p-2"
                        onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            dialogHeadingRef.current?.focus();
                        }}
                    >
                        <DialogHeader className="gap-2 text-start">
                            <DialogTitle ref={dialogHeadingRef} tabIndex={-1} className="pe-10 text-xl leading-snug focus:outline-none">
                                {criticalAnnouncement.title}
                            </DialogTitle>
                            <DialogDescription>
                                Critical announcement. Please read it and confirm when you are done.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="whitespace-pre-line text-sm leading-relaxed text-foreground/90">
                            {criticalAnnouncement.body}
                        </div>
                        <AnnouncementCta url={criticalAnnouncement.ctaUrl} />
                        {acknowledgementError && (
                            <p role="alert" className="text-sm text-destructive">
                                {acknowledgementError}
                            </p>
                        )}
                        <Button
                            type="button"
                            className="min-h-[44px] w-full"
                            disabled={acknowledging}
                            onClick={() => void acknowledge()}
                        >
                            {acknowledging ? <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                            I have read
                        </Button>
                    </DialogContent>
                )}
            </Dialog>
        </section>
    );
}
