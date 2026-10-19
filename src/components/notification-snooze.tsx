"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BellOff, Clock, CalendarDays, Ban } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface NotificationSnoozeProps {
    initialQuietUntil: string | null;
}

function hoursFromNow(hours: number) {
    const d = new Date();
    d.setHours(d.getHours() + hours);
    return d;
}

function endOfTomorrow() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 59, 0);
    return d;
}

function endOfThisWeek() {
    const d = new Date();
    const dayOfWeek = d.getDay(); // 0 Sun ... 6 Sat — Saudi week ends Thursday (day 4)
    const daysUntilEndOfWeek = (4 - dayOfWeek + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilEndOfWeek);
    d.setHours(23, 59, 59, 0);
    return d;
}

function formatRemaining(d: Date | null): string {
    if (!d) return "Off";
    const ms = d.getTime() - Date.now();
    if (ms <= 0) return "Off";
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins} min left`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h left`;
    const days = Math.round(hrs / 24);
    return `${days}d left`;
}

export function NotificationSnooze({ initialQuietUntil }: NotificationSnoozeProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [quietUntil, setQuietUntil] = useState<Date | null>(
        initialQuietUntil ? new Date(initialQuietUntil) : null,
    );
    const [saving, setSaving] = useState(false);
    const [, startTransition] = useTransition();

    const active = quietUntil && quietUntil.getTime() > Date.now();

    const persist = async (next: Date | null) => {
        setSaving(true);
        const prev = quietUntil;
        setQuietUntil(next);
        try {
            const res = await fetch(`/api/users/me`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quietUntil: next ? next.toISOString() : null }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast({
                title: next ? "Notifications muted" : "Notifications resumed",
                description: next
                    ? `Quiet mode until ${next.toLocaleString()}.`
                    : "You'll be pinged again like normal.",
            });
            startTransition(() => router.refresh());
        } catch (err) {
            setQuietUntil(prev);
            toast({ variant: "destructive", title: "Snooze failed", description: (err as Error).message });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className={cn(active && "border-purple-500/40 bg-purple-500/5")}>
            <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                    <BellOff className={cn("h-5 w-5", active ? "text-purple-600" : "text-muted-foreground")} />
                    <CardTitle className="text-base">Snooze notifications</CardTitle>
                </div>
                <CardDescription>
                    Pause task reminders, morning briefings and non-critical nudges. Critical alerts (Sunday digest send, admin alerts) still get through.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="text-sm">
                    <span className="text-muted-foreground">Status: </span>
                    <span className={cn("font-medium", active ? "text-purple-700 dark:text-purple-300" : "")}>
                        {active ? formatRemaining(quietUntil) : "Off"}
                    </span>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => persist(hoursFromNow(1))} disabled={saving} className="gap-1.5">
                        <Clock className="h-3.5 w-3.5" /> 1 hour
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => persist(endOfTomorrow())} disabled={saving} className="gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5" /> Until tomorrow
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => persist(endOfThisWeek())} disabled={saving} className="gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5" /> This week
                    </Button>
                    {active && (
                        <Button size="sm" variant="ghost" onClick={() => persist(null)} disabled={saving} className="gap-1.5 ml-auto">
                            <Ban className="h-3.5 w-3.5" /> Turn off
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}
