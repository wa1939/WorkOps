"use client";

import React from "react";
import { SabahAvatar } from "./sabah-avatar";

// Module-level ref so focus can return to the launcher after the shell closes.
let lastLauncherRef: HTMLButtonElement | null = null;

export function getLastLauncher(): HTMLButtonElement | null {
    return lastLauncherRef;
}

export function SabahLauncher({ open, unreadActivity, onOpen, avoidBottomNavigation = false }: { open: boolean; unreadActivity: number; onOpen: () => void; avoidBottomNavigation?: boolean }) {
    return (
        <button
            type="button"
            ref={(node) => {
                lastLauncherRef = node;
            }}
            onClick={onOpen}
            aria-label={open ? "Sabah copilot open" : "Open Sabah"}
            aria-expanded={open}
            className={`fixed ${avoidBottomNavigation ? "bottom-[calc(6rem+env(safe-area-inset-bottom))] sm:bottom-4" : "bottom-4"} end-4 z-50 flex items-center gap-2 rounded-full border border-border bg-card px-3 py-2 shadow-lg hover:border-primary/40 hover:shadow-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:transition-all motion-safe:duration-200`}
        >
            <SabahAvatar size="md" status={unreadActivity > 0 ? "attention" : "idle"} />
            <span className="hidden text-sm font-medium text-foreground sm:inline">Sabah</span>
            {unreadActivity > 0 && (
                <span
                    data-testid="sabah-unread-badge"
                    aria-label={`${unreadActivity} unread activity items`}
                    className="ms-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
                >
                    {unreadActivity > 9 ? "9+" : unreadActivity}
                </span>
            )}
        </button>
    );
}
