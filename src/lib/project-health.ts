/**
 * Computed project health — derived on read, never stored, so it can't go
 * stale. One place to tune the thresholds the whole app reads.
 */

export type ProjectHealth = "ON_TRACK" | "AT_RISK" | "OFF_TRACK" | "INACTIVE";

export interface HealthInput {
    status: string; // project status string
    dueAt: Date | null;
    progress: number; // 0–100
    overdueOpenTasks: number;
    now: Date;
}

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export function projectHealth(input: HealthInput): ProjectHealth {
    const { status, dueAt, progress, overdueOpenTasks, now } = input;

    // Closed projects don't carry health signal.
    if (status === "Done" || status === "Archived") return "INACTIVE";

    const due = dueAt ? new Date(dueAt) : null;

    // Off track: past due with work remaining, or a pile of overdue tasks.
    if ((due && due < now && progress < 100) || overdueOpenTasks >= 3) {
        return "OFF_TRACK";
    }

    // At risk: any overdue task, or a near deadline with thin progress.
    if (overdueOpenTasks >= 1 || (due && due.getTime() - now.getTime() <= FOURTEEN_DAYS_MS && due >= now && progress < 50)) {
        return "AT_RISK";
    }

    return "ON_TRACK";
}

/** Badge label + tint class per health. The badge always pairs this with an icon. */
export function healthMeta(h: ProjectHealth): { label: string; className: string } {
    switch (h) {
        case "ON_TRACK":
            return { label: "On track", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" };
        case "AT_RISK":
            return { label: "At risk", className: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" };
        case "OFF_TRACK":
            return { label: "Off track", className: "bg-red-500/10 text-red-600 dark:text-red-400" };
        case "INACTIVE":
            return { label: "Closed", className: "bg-gray-500/10 text-gray-600 dark:text-gray-400" };
    }
}
