import { differenceInCalendarDays, shiftCalendarDate } from "./date";

export type ScheduledTrigger = "PRE_DUE" | "DUE" | "OVERDUE";
export type ReminderOccurrence = { triggerType: ScheduledTrigger; scheduledDate: string; dedupKey: string };
export type ReminderSelectionInput = {
    actionId: string;
    dueDate: string;
    today: string;
    daysBeforeDue: number[];
    overdueIntervalDays: number | null;
    processedDedupKeys: ReadonlySet<string>;
    hasScheduledHistory: boolean;
};

export function reminderDedupKey(actionId: string, triggerType: ScheduledTrigger, scheduledDate: string): string {
    return `${actionId}:${triggerType}:${scheduledDate}`;
}

export function selectReminderOccurrence(input: ReminderSelectionInput): ReminderOccurrence | null {
    const candidates: ReminderOccurrence[] = [];
    for (const offset of Array.from(new Set(input.daysBeforeDue)).sort((a, b) => b - a)) {
        const scheduledDate = shiftCalendarDate(input.dueDate, -offset);
        if (scheduledDate > input.today) continue;
        const triggerType = offset === 0 ? "DUE" : "PRE_DUE";
        candidates.push({ triggerType, scheduledDate, dedupKey: reminderDedupKey(input.actionId, triggerType, scheduledDate) });
    }

    const overdueDays = differenceInCalendarDays(input.dueDate, input.today);
    if (overdueDays > 0 && !input.hasScheduledHistory) {
        candidates.push({
            triggerType: "OVERDUE",
            scheduledDate: input.today,
            dedupKey: reminderDedupKey(input.actionId, "OVERDUE", input.today),
        });
    } else if (overdueDays > 0 && input.overdueIntervalDays) {
        const intervalCount = Math.floor(overdueDays / input.overdueIntervalDays);
        if (intervalCount >= 1) {
            const scheduledDate = shiftCalendarDate(input.dueDate, intervalCount * input.overdueIntervalDays);
            candidates.push({
                triggerType: "OVERDUE",
                scheduledDate,
                dedupKey: reminderDedupKey(input.actionId, "OVERDUE", scheduledDate),
            });
        }
    }

    const latest = candidates.sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))[0];
    if (!latest || input.processedDedupKeys.has(latest.dedupKey)) return null;
    return latest;
}

export function selectNextReminderOccurrence(input: ReminderSelectionInput): ReminderOccurrence | null {
    const applicable = selectReminderOccurrence(input);
    if (applicable) return applicable;

    const future: ReminderOccurrence[] = Array.from(new Set(input.daysBeforeDue)).map((offset) => {
        const scheduledDate = shiftCalendarDate(input.dueDate, -offset);
        const triggerType = offset === 0 ? "DUE" as const : "PRE_DUE" as const;
        return { triggerType, scheduledDate, dedupKey: reminderDedupKey(input.actionId, triggerType, scheduledDate) };
    }).filter((candidate) => candidate.scheduledDate > input.today && !input.processedDedupKeys.has(candidate.dedupKey));

    if (input.dueDate < input.today && input.overdueIntervalDays) {
        const overdueDays = differenceInCalendarDays(input.dueDate, input.today);
        const scheduledDate = shiftCalendarDate(input.dueDate, (Math.floor(overdueDays / input.overdueIntervalDays) + 1) * input.overdueIntervalDays);
        const dedupKey = reminderDedupKey(input.actionId, "OVERDUE", scheduledDate);
        if (!input.processedDedupKeys.has(dedupKey)) future.push({ triggerType: "OVERDUE", scheduledDate, dedupKey });
    }

    return future.sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate))[0] ?? null;
}
