import React from "react";

"use client";

import { useAppStatus } from "@/lib/pwa/app-status";

const OFFLINE_COPY = "You're offline. Reconnect to load or save work.";

export function AppStatusBanner({
    hasUnsavedWork,
    isStreaming,
    unreadCount,
}: {
    hasUnsavedWork?: () => boolean;
    isStreaming?: () => boolean;
    unreadCount?: number;
}) {
    const { online, update, reloadWhenReady } = useAppStatus({
        hasUnsavedWork,
        isStreaming,
        unreadCount,
    });

    return (
        <>
            {!online ? (
                <div
                    role="status"
                    className="min-h-[44px] bg-warning/10 px-4 py-2 text-sm text-warning"
                    data-testid="offline-banner"
                >
                    {OFFLINE_COPY}
                </div>
            ) : null}
            {update.kind === "update-available" ? (
                <div
                    role="status"
                    className="flex min-h-[44px] items-center gap-3 bg-accent/10 px-4 py-2 text-sm"
                    data-testid="update-banner"
                >
                    <span>Update available</span>
                    <button
                        type="button"
                        onClick={reloadWhenReady}
                        className="min-h-[44px] rounded px-3 font-medium underline"
                    >
                        Reload when ready
                    </button>
                </div>
            ) : null}
        </>
    );
}
