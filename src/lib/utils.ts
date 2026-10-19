import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatDate(date: Date | string | null | undefined): string {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

export function formatDateTime(date: Date | string | null | undefined): string {
    if (!date) return "";
    const d = new Date(date);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}

export function formatRelativeDate(date: Date | string | null | undefined): string {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();

    // Reset time to start of day for accurate day comparison
    const targetDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffMs = targetDate.getTime() - today.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < -1) return `${Math.abs(diffDays)} days ago`;
    if (diffDays === -1) return "Yesterday";
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays < 7) return `In ${diffDays} days`;
    return formatDate(date);
}

export function isOverdue(dueAt: Date | string | null | undefined): boolean {
    if (!dueAt) return false;
    return new Date(dueAt) < new Date();
}

export function isDueSoon(dueAt: Date | string | null | undefined, hours = 48): boolean {
    if (!dueAt) return false;
    const due = new Date(dueAt);
    const now = new Date();
    const diff = due.getTime() - now.getTime();
    return diff > 0 && diff < hours * 60 * 60 * 1000;
}

export function calculateUrgencyScore(task: {
    priority: string;
    status: string;
    dueAt: Date | string | null;
}): number {
    const priorityScores: Record<string, number> = {
        LOW: 1,
        MEDIUM: 2,
        HIGH: 3,
        URGENT: 4,
    };

    let score = priorityScores[task.priority] || 2;

    if (task.dueAt) {
        const now = new Date();
        const due = new Date(task.dueAt);
        const diffMs = due.getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        if (diffMs < 0 && !["DONE", "CANCELED"].includes(task.status)) {
            score += 5; // Overdue
        } else if (diffHours > 0 && diffHours <= 24) {
            score += 3; // Due within 24h
        } else if (diffHours > 0 && diffHours <= 72) {
            score += 2; // Due within 3 days
        }
    }

    if (["BLOCKED", "WAITING"].includes(task.status)) {
        score -= 1;
    }

    return score;
}

export function getInitials(name: string): string {
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);
}

export function generateId(): string {
    return Math.random().toString(36).substring(2, 9);
}
