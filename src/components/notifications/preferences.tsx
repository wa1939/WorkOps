"use client";

import React, { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type ChannelKey = "emailEnabled" | "inAppEnabled" | "pushEnabled";

type NotificationPreference = {
    id?: string;
    userId?: string;
    category: string;
    emailEnabled: boolean;
    inAppEnabled: boolean;
    pushEnabled: boolean;
    quietEnabled: boolean;
    quietStartMinute: number | null;
    quietEndMinute: number | null;
    timezone: string;
};

export type NotificationCategory = {
    category: string;
    label: string;
    description?: string;
};

export type NotificationPreferencesProps = {
    categories?: readonly NotificationCategory[];
};

export const DEFAULT_NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
    { category: "email", label: "Email notifications", description: "Receive email for important updates." },
    { category: "task", label: "Task reminders", description: "Get reminded before tasks are due." },
    { category: "digest", label: "Weekly digest", description: "Receive a weekly summary of your work." },
    { category: "account_security", label: "Account security", description: "Security messages remain available when you need them." },
];

const CHANNELS: readonly { key: ChannelKey; label: string; note?: string }[] = [
    { key: "emailEnabled", label: "email" },
    { key: "inAppEnabled", label: "in-app" },
    { key: "pushEnabled", label: "push", note: "Requires device registration (PWA phase)." },
];

function emptyPreference(category: string): NotificationPreference {
    return {
        category,
        emailEnabled: true,
        inAppEnabled: true,
        pushEnabled: false,
        quietEnabled: false,
        quietStartMinute: null,
        quietEndMinute: null,
        timezone: "Asia/Riyadh",
    };
}

function responsePreferences(payload: unknown): NotificationPreference[] {
    if (Array.isArray(payload)) return payload as NotificationPreference[];
    if (payload && typeof payload === "object" && Array.isArray((payload as { preferences?: unknown }).preferences)) {
        return (payload as { preferences: NotificationPreference[] }).preferences;
    }
    return [];
}

export function NotificationPreferences({ categories = DEFAULT_NOTIFICATION_CATEGORIES }: NotificationPreferencesProps) {
    const categorySignature = categories.map(({ category }) => category).join("|");
    const [preferences, setPreferences] = useState<Record<string, NotificationPreference>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        fetch("/api/notifications/preferences")
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(payload.error || "Failed to load notification preferences");
                return responsePreferences(payload);
            })
            .then((loaded) => {
                if (!active) return;
                const next: Record<string, NotificationPreference> = {};
                for (const category of categories) {
                    const saved = loaded.find((preference) => preference.category === category.category);
                    next[category.category] = { ...emptyPreference(category.category), ...saved };
                }
                setPreferences(next);
                setError(null);
            })
            .catch((reason: unknown) => {
                if (active) setError(reason instanceof Error ? reason.message : "Failed to load notification preferences");
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
        // The signature avoids refetching when callers provide an inline category array.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categorySignature]);

    const persist = async (category: NotificationCategory, patch: Partial<NotificationPreference>) => {
        const previous = preferences[category.category] ?? emptyPreference(category.category);
        const optimistic = { ...previous, ...patch };
        setPreferences((current) => ({ ...current, [category.category]: optimistic }));
        setError(null);
        try {
            const response = await fetch("/api/notifications/preferences", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(optimistic),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || "Unable to save notification preference");
            const saved = payload?.preference ?? payload;
            if (saved && typeof saved === "object" && saved.category) {
                setPreferences((current) => ({ ...current, [category.category]: { ...optimistic, ...saved } }));
            }
        } catch (reason: unknown) {
            setPreferences((current) => ({ ...current, [category.category]: previous }));
            setError(reason instanceof Error ? reason.message : "Unable to save notification preference");
        }
    };

    return (
        <div className="space-y-4" aria-busy={loading}>
            <div>
                <h2 className="text-lg font-semibold">Notification Preferences</h2>
                <p className="text-sm text-muted-foreground">Choose which channels and quiet hours apply to each notification category.</p>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {loading && <p className="text-sm text-muted-foreground">Loading notification preferences…</p>}
            {!loading && categories.map((category) => {
                const preference = preferences[category.category] ?? emptyPreference(category.category);
                return (
                    <Card key={category.category}>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">{category.label}</CardTitle>
                            {category.description && <CardDescription>{category.description}</CardDescription>}
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-3">
                                {CHANNELS.map((channel) => {
                                    const switchId = `${category.category}-${channel.key}`;
                                    return (
                                        <div key={channel.key} className="space-y-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <Label htmlFor={switchId}>{category.label} {channel.label}</Label>
                                                <Switch
                                                    id={switchId}
                                                    aria-label={`${category.label} ${channel.label}`}
                                                    checked={preference[channel.key]}
                                                    onCheckedChange={(checked) => void persist(category, { [channel.key]: checked })}
                                                />
                                            </div>
                                            {channel.note && <p className="text-xs text-muted-foreground">{channel.note}</p>}
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="flex flex-wrap items-center gap-3 border-t pt-3">
                                <div className="flex items-center gap-2">
                                    <Switch
                                        id={`${category.category}-quiet`}
                                        aria-label={`${category.label} quiet mode`}
                                        checked={preference.quietEnabled}
                                        onCheckedChange={(checked) => void persist(category, { quietEnabled: checked })}
                                    />
                                    <Label htmlFor={`${category.category}-quiet`}>Quiet hours</Label>
                                </div>
                                <Label className="sr-only" htmlFor={`${category.category}-quiet-start`}>Quiet hours start minute</Label>
                                <input
                                    id={`${category.category}-quiet-start`}
                                    type="number"
                                    min={0}
                                    max={1439}
                                    value={preference.quietStartMinute ?? ""}
                                    onChange={(event) => void persist(category, { quietStartMinute: event.target.value === "" ? null : Number(event.target.value) })}
                                    className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
                                    aria-label={`${category.label} quiet hours start minute`}
                                />
                                <span className="text-sm text-muted-foreground">to</span>
                                <Label className="sr-only" htmlFor={`${category.category}-quiet-end`}>Quiet hours end minute</Label>
                                <input
                                    id={`${category.category}-quiet-end`}
                                    type="number"
                                    min={0}
                                    max={1439}
                                    value={preference.quietEndMinute ?? ""}
                                    onChange={(event) => void persist(category, { quietEndMinute: event.target.value === "" ? null : Number(event.target.value) })}
                                    className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
                                    aria-label={`${category.label} quiet hours end minute`}
                                />
                                <span className="text-sm text-muted-foreground">Timezone: </span>
                                <span className="text-sm text-muted-foreground">{preference.timezone}</span>
                            </div>
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
