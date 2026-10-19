"use client";

import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { dueClass, PRIORITY_TOKEN_CLASSES, STATUS_TOKEN_CLASSES } from "@/lib/ui/status-tokens";
import type { TaskGridGroup, TaskGridUser } from "./grid-types";

export interface GroupHeaderProps {
    group: TaskGridGroup;
    collapsed: boolean;
    rowIds: readonly string[];
    selectedIds: ReadonlySet<string>;
    onToggle: () => void;
    onToggleSelectAll: (rowIds: readonly string[]) => void;
}

function groupBandClass(key: string): string {
    return STATUS_TOKEN_CLASSES[key as keyof typeof STATUS_TOKEN_CLASSES]
        ?? PRIORITY_TOKEN_CLASSES[key as keyof typeof PRIORITY_TOKEN_CLASSES]
        ?? "bg-muted/60 text-foreground";
}

function initials(user: TaskGridUser): string {
    const label = user.name ?? user.email ?? "?";
    return label
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "?";
}

export function GroupHeader({
    group,
    collapsed,
    rowIds,
    selectedIds,
    onToggle,
    onToggleSelectAll,
}: GroupHeaderProps) {
    const selectAllRef = useRef<HTMLInputElement>(null);
    const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedIds.has(id));
    const someSelected = rowIds.some((id) => selectedIds.has(id));
    const progress = group.count > 0
        ? Math.min(100, Math.round((group.doneCount / group.count) * 100))
        : 0;
    const overdueToken = dueClass(new Date(0));

    useEffect(() => {
        if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
    }, [allSelected, someSelected]);

    return (
        <div
            role="row"
            className={cn(
                "sticky top-0 z-20 flex h-9 min-w-[1192px] items-center gap-2 border-b border-border/60 border-l-2 border-l-primary/60 px-3",
                groupBandClass(group.key),
            )}
        >
            <input
                ref={selectAllRef}
                type="checkbox"
                aria-label={`Select all tasks in ${group.label}`}
                aria-checked={someSelected && !allSelected ? "mixed" : allSelected}
                checked={allSelected}
                disabled={rowIds.length === 0}
                onChange={() => onToggleSelectAll(rowIds)}
                onClick={(event) => event.stopPropagation()}
                className="h-4 w-4 rounded border-input accent-primary disabled:opacity-40"
            />
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={!collapsed}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
                    <ChevronDown
                    aria-hidden="true"
                    className={cn(
                        "h-4 w-4 shrink-0 text-current/70 transition-transform duration-200",
                        collapsed && "-rotate-90",
                    )}
                />
                <span className="truncate font-medium text-foreground">{group.label}</span>
                <span className="rounded-full bg-background/55 px-2 py-0.5 text-xs tabular-nums text-foreground/80">{group.count}</span>
                <span className="ml-2 h-1.5 w-24 overflow-hidden rounded-full bg-foreground/20" aria-label={`${progress}% complete`}>
                    <span
                        className="block h-full rounded-full bg-foreground/65 transition-[width] duration-200"
                        style={{ width: `${progress}%` }}
                    />
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{progress}%</span>
                {group.overdueCount > 0 && (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", overdueToken)}>
                        {group.overdueCount} overdue
                    </span>
                )}
                {group.estimateMinutesSum > 0 && (
                    <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                        {Math.round(group.estimateMinutesSum / 60)}h estimated
                    </span>
                )}
            </button>
            {group.sampleAvatars.length > 0 && (
                <div className="flex shrink-0 -space-x-1.5" aria-label="Sample assignees">
                    {group.sampleAvatars.slice(0, 5).map((user) => (
                        <span
                            key={user.id}
                            title={user.name ?? user.email ?? "Assignee"}
                            className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-muted text-[9px] font-semibold text-muted-foreground"
                        >
                            {user.image ?? user.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={user.image ?? user.imageUrl ?? ""} alt="" className="h-full w-full object-cover" />
                            ) : initials(user)}
                        </span>
                    ))}
                </div>
            )}
        </div>
    );
}
