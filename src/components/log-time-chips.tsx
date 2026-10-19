"use client";

import { useState } from "react";

const OPTIONS = [0.5, 1, 2, 4];

/**
 * Skippable "how long did it take?" quick-pick shown in the Mark-Done toast.
 * Writes Task.actualHours on tap. Best-effort — silently ignores failure
 * because this is a bonus data-capture, never blocking the done action.
 */
export function LogTimeChips({ taskId }: { taskId: string }) {
    const [logged, setLogged] = useState<number | null>(null);

    const log = async (hours: number) => {
        setLogged(hours);
        try {
            await fetch(`/api/tasks/${taskId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actualHours: hours }),
            });
        } catch {
            /* best effort */
        }
    };

    if (logged !== null) {
        return <span className="text-xs text-muted-foreground">Logged {logged}h ✓</span>;
    }

    return (
        <span className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Log time:</span>
            {OPTIONS.map((h) => (
                <button
                    key={h}
                    type="button"
                    onClick={() => log(h)}
                    className="rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent hover:border-primary/40 transition-colors"
                >
                    {h}h
                </button>
            ))}
        </span>
    );
}
