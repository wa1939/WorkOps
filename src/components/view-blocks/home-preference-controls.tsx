"use client";

import React, { useEffect, useState } from "react";
import { Home, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HomePreferenceControls({ viewId }: { viewId: string }) {
    const [homeViewId, setHomeViewId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void fetch("/api/home-preference")
            .then(async (response) => response.ok ? await response.json() as { viewId?: unknown } : null)
            .then((body) => {
                if (!active) return;
                setHomeViewId(typeof body?.viewId === "string" ? body.viewId : null);
            })
            .catch(() => {
                if (active) setHomeViewId(null);
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    const updatePreference = async (method: "PUT" | "DELETE") => {
        setSaving(true);
        setMessage(null);
        try {
            const response = await fetch("/api/home-preference", {
                method,
                headers: method === "PUT" ? { "Content-Type": "application/json" } : undefined,
                body: method === "PUT" ? JSON.stringify({ viewId }) : undefined,
            });
            const body = await response.json().catch(() => null) as { viewId?: unknown; error?: string } | null;
            if (!response.ok) throw new Error(body?.error || "Unable to update home view.");
            setHomeViewId(method === "PUT" ? viewId : null);
            setMessage(method === "PUT" ? "Home view saved" : "Default home restored");
        } catch (error) {
            setMessage(error instanceof Error ? error.message : "Unable to update home view.");
        } finally {
            setSaving(false);
        }
    };

    const isCurrentHome = homeViewId === viewId;

    return (
        <div className="flex flex-wrap items-center justify-end gap-2" data-testid="home-preference-controls">
            <Button
                type="button"
                variant={isCurrentHome ? "secondary" : "outline"}
                size="sm"
                disabled={loading || saving}
                onClick={() => void updatePreference("PUT")}
            >
                {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {!saving && <Home className="mr-1.5 h-3.5 w-3.5" />}
                {isCurrentHome ? "My home" : "Make my home"}
            </Button>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={loading || saving || homeViewId === null}
                onClick={() => void updatePreference("DELETE")}
            >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Restore default
            </Button>
            {message && <span role="status" className="text-xs text-muted-foreground">{message}</span>}
        </div>
    );
}
