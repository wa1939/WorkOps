"use client";

import { useState } from "react";
import type { DrawerDependency, TaskDrawerPayload } from "../types";
import { humanize } from "./shared";

interface DependenciesSectionProps {
    task: TaskDrawerPayload;
    onRefresh: () => Promise<void>;
}

function dependencyTitle(dependency: DrawerDependency, direction: "blockedBy" | "blocks"): string {
    const linked = direction === "blockedBy" ? dependency.dependsOn : dependency.task;
    return linked?.title ?? linked?.taskKey ?? "Unknown task";
}

export function DependenciesSection({ task, onRefresh }: DependenciesSectionProps) {
    const [dependsOnId, setDependsOnId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const addDependency = async () => {
        const id = dependsOnId.trim();
        if (!id || busy) return;
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/dependencies`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ dependsOnId: id }),
            });
            if (!response.ok) throw new Error("Could not add dependency");
            setDependsOnId("");
            await onRefresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not add dependency");
        } finally {
            setBusy(false);
        }
    };

    const removeDependency = async (dependency: DrawerDependency) => {
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/dependencies?dependencyId=${encodeURIComponent(dependency.id)}`, { method: "DELETE" });
            if (!response.ok) throw new Error("Could not remove dependency");
            await onRefresh();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Could not remove dependency");
        } finally {
            setBusy(false);
        }
    };

    const list = (items: DrawerDependency[], direction: "blockedBy" | "blocks") => (
        <div className="space-y-1.5">
            {items.length === 0 && <p className="text-xs text-muted-foreground">None</p>}
            {items.map((dependency) => (
                <div key={dependency.id} className="flex items-center gap-2 rounded-md border border-border/70 px-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate">{dependencyTitle(dependency, direction)}</span>
                    <span className="text-[11px] text-muted-foreground">{humanize((direction === "blockedBy" ? dependency.dependsOn?.status : dependency.task?.status) ?? "unknown")}</span>
                    <button type="button" disabled={busy} onClick={() => void removeDependency(dependency)} className="text-xs text-muted-foreground hover:text-destructive" aria-label={`Remove ${dependencyTitle(dependency, direction)}`}>Remove</button>
                </div>
            ))}
        </div>
    );

    return (
        <div className="space-y-4">
            <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Blocked by</p>
                {list(task.dependencies, "blockedBy")}
            </div>
            <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Blocks</p>
                {list(task.blockers, "blocks")}
            </div>
            <div className="flex gap-2">
                <input value={dependsOnId} disabled={busy} onChange={(event) => setDependsOnId(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addDependency(); } }} placeholder="Blocker task ID" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring" aria-label="Blocker task ID" />
                <button type="button" disabled={!dependsOnId.trim() || busy} onClick={() => void addDependency()} className="h-9 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent disabled:opacity-50">Add blocker</button>
            </div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
