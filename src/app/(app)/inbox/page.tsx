"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface InboxNotification {
    id: string;
    type: string;
    title: string;
    body: string | null;
    linkUrl: string | null;
    isRead: boolean;
    createdAt: string;
}

function dayKey(createdAt: string) {
    return new Date(createdAt).toISOString().slice(0, 10);
}

function dayLabel(key: string) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date(`${key}T00:00:00`));
}

export default function InboxPage() {
    const [notifications, setNotifications] = useState<InboxNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        fetch("/api/notifications?limit=50")
            .then(async (response) => {
                const payload = await response.json().catch(() => []);
                if (!response.ok) throw new Error(payload.error || "Failed to load inbox");
                return Array.isArray(payload) ? payload : payload.notifications ?? [];
            })
            .then((rows: InboxNotification[]) => {
                if (!active) return;
                setNotifications(rows);
                setError(null);
            })
            .catch((reason: unknown) => {
                if (active) setError(reason instanceof Error ? reason.message : "Failed to load inbox");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const unreadIds = notifications.filter((notification) => !notification.isRead).map((notification) => notification.id);
    const grouped = useMemo(() => {
        const groups = new Map<string, InboxNotification[]>();
        for (const notification of notifications) {
            const key = dayKey(notification.createdAt);
            const group = groups.get(key) ?? [];
            group.push(notification);
            groups.set(key, group);
        }
        return Array.from(groups.entries());
    }, [notifications]);

    const markRead = async (ids: string[]) => {
        if (ids.length === 0) return;
        const previous = notifications;
        setNotifications((current) => current.map((notification) => ids.includes(notification.id) ? { ...notification, isRead: true } : notification));
        setError(null);
        try {
            const response = await fetch("/api/notifications", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || "Failed to mark notifications as read");
        } catch (reason: unknown) {
            setNotifications(previous);
            setError(reason instanceof Error ? reason.message : "Failed to mark notifications as read");
        }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <div className="flex items-center gap-2">
                        <Bell className="h-6 w-6" />
                        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">Inbox</h1>
                    </div>
                    <p className="text-muted-foreground">Your notifications, grouped by day.</p>
                </div>
                <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => void markRead(unreadIds)}
                    disabled={loading || unreadIds.length === 0}
                >
                    <CheckCheck className="h-4 w-4" />
                    Mark all as read
                </Button>
            </div>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {loading && (
                <div className="flex items-center justify-center py-12" aria-label="Loading inbox">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            )}
            {!loading && notifications.length === 0 && (
                <Card>
                    <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                        <Bell className="h-10 w-10 text-muted-foreground" />
                        <CardTitle className="text-lg">Your inbox is empty</CardTitle>
                        <CardDescription>New notifications will appear here.</CardDescription>
                    </CardContent>
                </Card>
            )}
            {!loading && grouped.map(([key, rows]) => (
                <section key={key} aria-labelledby={`inbox-day-${key}`} className="space-y-3">
                    <h2 id={`inbox-day-${key}`} className="text-sm font-semibold text-muted-foreground">{dayLabel(key)}</h2>
                    <div className="space-y-2">
                        {rows.map((notification) => (
                            <Card key={notification.id} className={notification.isRead ? "" : "border-primary/40 bg-primary/5"}>
                                <CardContent className="flex items-start gap-3 p-4">
                                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${notification.isRead ? "bg-muted" : "bg-primary"}`} aria-label={notification.isRead ? "Read" : "Unread"} />
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="font-medium">{notification.title}</h3>
                                            {!notification.isRead && <Badge variant="secondary">Unread</Badge>}
                                        </div>
                                        {notification.body && <p className="text-sm text-muted-foreground">{notification.body}</p>}
                                        <p className="text-xs text-muted-foreground">
                                            {new Date(notification.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {!notification.isRead && (
                                            <Button size="sm" variant="ghost" onClick={() => void markRead([notification.id])}>
                                                Mark read
                                            </Button>
                                        )}
                                        {notification.linkUrl && (
                                            <Button asChild size="sm" variant="outline" className="gap-1.5">
                                                <Link href={notification.linkUrl} onClick={() => void markRead([notification.id])}>
                                                    Open <ExternalLink className="h-3.5 w-3.5" />
                                                </Link>
                                            </Button>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
