"use client";

import React from "react";

export type SabahAvatarSize = "sm" | "md" | "lg";
export type SabahAvatarStatus = "idle" | "working" | "attention";

const SIZE_CLASSES: Record<SabahAvatarSize, string> = {
    sm: "h-6 w-6",
    md: "h-8 w-8",
    lg: "h-12 w-12",
};

const STATUS_DOT_CLASSES: Record<Exclude<SabahAvatarStatus, "idle">, string> = {
    working: "bg-sky-500 dark:bg-sky-400",
    attention: "bg-amber-500 dark:bg-amber-400",
};

export function SabahAvatar({
    size = "md",
    status = "idle",
    className = "",
}: {
    size?: SabahAvatarSize;
    status?: SabahAvatarStatus;
    className?: string;
}) {
    return (
        <span className={`relative inline-flex shrink-0 ${className}`}>
            <img
                src="/sabah/sabah-avatar.svg"
                alt="Sabah employee copilot"
                className={`${SIZE_CLASSES[size]} rounded-full object-cover select-none`}
                draggable={false}
            />
            {status !== "idle" && (
                <span
                    data-testid="sabah-status"
                    data-status={status}
                    aria-hidden="true"
                    className={`absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${STATUS_DOT_CLASSES[status]}`}
                />
            )}
        </span>
    );
}
