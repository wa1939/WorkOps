"use client";

import React from "react";
import { createPortal } from "react-dom";
import { ChatWidget } from "@/components/ai-chat/chat-widget";
import { SabahCopilot } from "./sabah-copilot";
import { useSabah } from "./state/sabah-context";

function DisabledSabahHost() {
    const { activeHost } = useSabah();
    if (!activeHost || !activeHost.visible) return null;
    return createPortal(
        <div data-testid="sabah-disabled-host" className="flex h-full min-h-[28rem] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card p-6 text-center">
            <h2 className="text-sm font-semibold">Sabah is unavailable</h2>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">This workspace needs the Sabah platform flag enabled. Your saved view is unchanged.</p>
        </div>,
        activeHost.element,
    );
}

/**
 * Server/client boundary for the assistant surface. The server layout reads the
 * platform flag (never process.env in client code) and passes it down; exactly
 * one assistant mounts — legacy widget when off, Adaptive Copilot when on.
 */
export function SabahEntry({ platformEnabled }: { platformEnabled: boolean }) {
    if (!platformEnabled) {
        return <><ChatWidget /><DisabledSabahHost /></>;
    }
    return <SabahCopilot />;
}
