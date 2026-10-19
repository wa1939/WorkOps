"use client";

import { useEffect, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Info, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

interface Announcement {
    id: string;
    title: string;
    body: string;
    variant: string;
}

const VARIANTS: Record<string, { icon: typeof Sparkles; ring: string; tint: string; cta: string }> = {
    celebrate: { icon: Sparkles, ring: "bg-primary/10 text-primary", tint: "text-primary", cta: "Let's go" },
    info: { icon: Info, ring: "bg-blue-500/10 text-blue-500", tint: "text-blue-500", cta: "Got it" },
    warning: { icon: Megaphone, ring: "bg-amber-500/10 text-amber-500", tint: "text-amber-500", cta: "Got it" },
};

export function AnnouncementPopup() {
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let cancelled = false;
        // Small delay so it doesn't fight the page's own entrance animation.
        const t = setTimeout(async () => {
            try {
                const res = await fetch("/api/announcements/active");
                if (!res.ok) return;
                const data = await res.json();
                if (!cancelled && data.announcement) {
                    setAnnouncement(data.announcement);
                    setOpen(true);
                }
            } catch {
                /* non-critical */
            }
        }, 900);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, []);

    const dismiss = async () => {
        setOpen(false);
        if (!announcement) return;
        try {
            await fetch(`/api/announcements/${announcement.id}/seen`, { method: "POST" });
        } catch {
            /* best effort — if it fails they may see it once more, which is acceptable */
        }
    };

    if (!announcement) return null;

    const cfg = VARIANTS[announcement.variant] ?? VARIANTS.celebrate;
    const Icon = cfg.icon;

    return (
        <Dialog open={open} onOpenChange={(o) => !o && dismiss()}>
            <DialogContent className="max-w-md">
                <DialogHeader className="items-center text-center sm:text-center">
                    <div className={cn("mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full", cfg.ring)}>
                        <Icon className="h-7 w-7" />
                    </div>
                    <DialogTitle className="text-xl">{announcement.title}</DialogTitle>
                    <DialogDescription className="sr-only">Team announcement</DialogDescription>
                </DialogHeader>

                <div className="whitespace-pre-line text-sm leading-relaxed text-foreground/90 max-h-[50vh] overflow-y-auto px-1">
                    {announcement.body}
                </div>

                <Button onClick={dismiss} className="w-full mt-1">
                    {cfg.cta}
                </Button>
            </DialogContent>
        </Dialog>
    );
}
