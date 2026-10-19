"use client";

import React from "react";
import type { SabahTab } from "./state/sabah-reducer";

const TABS: Array<{ id: Exclude<SabahTab, "PLAN">; label: string; labelAr: string }> = [
    { id: "CHAT", label: "Chat", labelAr: "المحادثة" },
    { id: "CONTEXT", label: "Context", labelAr: "السياق" },
    { id: "ACTIVITY", label: "Activity", labelAr: "النشاط" },
];

function isRtl(): boolean {
    if (typeof document === "undefined") {
        return false;
    }
    return document.documentElement.dir === "rtl" || document.documentElement.getAttribute("dir") === "rtl";
}

export function SabahTabs({ activeTab, unreadActivity, onSelect }: { activeTab: SabahTab; unreadActivity: number; onSelect: (tab: SabahTab) => void }) {
    const [focused, setFocused] = React.useState(0);
    const visibleActiveTab: Exclude<SabahTab, "PLAN"> = activeTab === "PLAN" ? "CHAT" : activeTab;
    const rtl = isRtl();

    const focusTab = (index: number) => {
        setFocused(index);
        document.getElementById(`sabah-tab-${TABS[index].id}`)?.focus();
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "ArrowRight") {
            event.preventDefault();
            focusTab(rtl ? (focused + TABS.length - 1) % TABS.length : (focused + 1) % TABS.length);
        } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            focusTab(rtl ? (focused + 1) % TABS.length : (focused + TABS.length - 1) % TABS.length);
        } else if (event.key === "Home") {
            event.preventDefault();
            focusTab(0);
        } else if (event.key === "End") {
            event.preventDefault();
            focusTab(TABS.length - 1);
        }
    };

    return (
        <div role="tablist" aria-label="Sabah sections" onKeyDown={onKeyDown} className="flex items-center gap-1 border-b border-border px-2">
            {TABS.map((tab, index) => {
                const selected = tab.id === visibleActiveTab;
                return (
                    <button
                        key={tab.id}
                        id={`sabah-tab-${tab.id}`}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        tabIndex={index === focused ? 0 : -1}
                        onFocus={() => setFocused(index)}
                        onClick={() => onSelect(tab.id)}
                        className={
                            "relative flex-1 rounded-t-md px-2 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary motion-safe:transition-colors motion-safe:duration-150 " +
                            (selected ? "text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
                        }
                    >
                        {rtl ? tab.labelAr : tab.label}
                        {tab.id === "ACTIVITY" && unreadActivity > 0 && (
                            <span className="ms-1 inline-block h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
                        )}
                        {selected && <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-primary" />}
                    </button>
                );
            })}
        </div>
    );
}
