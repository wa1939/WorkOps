"use client";

import React from "react";
import { Maximize2, Minimize2, PanelRightClose, X } from "lucide-react";
import { SabahAvatar, type SabahAvatarStatus } from "./sabah-avatar";
import type { SabahShellMode } from "./state/sabah-reducer";

const ICON_BUTTON_CLASS =
    "rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-safe:transition-colors motion-safe:duration-150";

export function SabahHeader({
    mode,
    status = "idle",
    onExpand,
    onCollapse,
    onClose,
    collapseLabel = "Collapse Sabah",
    collapseTitle = "Collapse to compact view",
}: {
    mode: SabahShellMode;
    status?: SabahAvatarStatus;
    onExpand: () => void;
    onCollapse: () => void;
    onClose: () => void;
    collapseLabel?: string;
    collapseTitle?: string;
}) {
    return (
        <header className="flex items-center gap-2.5 border-b border-border px-3 py-2">
            <SabahAvatar size="sm" status={status} />
            <div className="min-w-0 leading-tight">
                <h2 className="truncate text-sm font-semibold text-foreground">
                    Sabah <span className="font-normal text-muted-foreground">· صباح</span>
                </h2>
                <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Employee Copilot</p>
            </div>
            <div className="ms-auto flex items-center gap-1">
                {mode !== "FULLSCREEN" && mode !== "COMPACT" && (
                    <button type="button" onClick={onCollapse} aria-label={collapseLabel} title={collapseTitle} className={ICON_BUTTON_CLASS}>
                        <PanelRightClose aria-hidden="true" className="h-4 w-4" />
                    </button>
                )}
                {mode !== "FULLSCREEN" && (
                    <button type="button" onClick={onExpand} aria-label="Expand Sabah" title="Expand to full screen" className={ICON_BUTTON_CLASS}>
                        <Maximize2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                )}
                {mode === "FULLSCREEN" && (
                    <button type="button" onClick={onCollapse} aria-label="Collapse Sabah" title="Exit full screen" className={ICON_BUTTON_CLASS}>
                        <Minimize2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                )}
                <button type="button" onClick={onClose} aria-label="Close Sabah" className={ICON_BUTTON_CLASS}>
                    <X aria-hidden="true" className="h-4 w-4" />
                </button>
            </div>
        </header>
    );
}
