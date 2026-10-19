import { describe, expect, it } from "vitest";
import { reminderDedupKey, selectNextReminderOccurrence, selectReminderOccurrence } from "./reminders";

describe("selectReminderOccurrence", () => {
    it("selects the latest applicable default stage", () => {
        expect(selectReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-08-13",
            today: "2026-07-14",
            daysBeforeDue: [30, 7, 0],
            overdueIntervalDays: 7,
            processedDedupKeys: new Set(),
            hasScheduledHistory: false,
        })).toEqual({ triggerType: "PRE_DUE", scheduledDate: "2026-07-14", dedupKey: "a1:PRE_DUE:2026-07-14" });
    });

    it("returns no duplicate when the latest stage was processed", () => {
        const key = reminderDedupKey("a1", "DUE", "2026-08-13");
        expect(selectReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-08-13",
            today: "2026-08-13",
            daysBeforeDue: [30, 7, 0],
            overdueIntervalDays: 7,
            processedDedupKeys: new Set([key]),
            hasScheduledHistory: true,
        })).toBeNull();
    });

    it("creates one immediate overdue event for a newly recorded overdue action", () => {
        expect(selectReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-07-01",
            today: "2026-07-14",
            daysBeforeDue: [30, 7, 0],
            overdueIntervalDays: 7,
            processedDedupKeys: new Set(),
            hasScheduledHistory: false,
        })?.triggerType).toBe("OVERDUE");
    });

    it("selects only the latest weekly overdue occurrence", () => {
        expect(selectReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-07-01",
            today: "2026-07-16",
            daysBeforeDue: [30, 7, 0],
            overdueIntervalDays: 7,
            processedDedupKeys: new Set(["a1:DUE:2026-07-01", "a1:OVERDUE:2026-07-08"]),
            hasScheduledHistory: true,
        })).toEqual({ triggerType: "OVERDUE", scheduledDate: "2026-07-15", dedupKey: "a1:OVERDUE:2026-07-15" });
    });
});

describe("selectNextReminderOccurrence", () => {
    it("returns the next future reminder from policy without a future event row", () => {
        expect(selectNextReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-08-13",
            today: "2026-07-14",
            daysBeforeDue: [30, 7, 0],
            overdueIntervalDays: 7,
            processedDedupKeys: new Set(),
            hasScheduledHistory: false,
        })).toEqual({ triggerType: "PRE_DUE", scheduledDate: "2026-07-14", dedupKey: "a1:PRE_DUE:2026-07-14" });
    });

    it("advances past processed stages and respects disabled overdue recurrence", () => {
        const dueKey = reminderDedupKey("a1", "DUE", "2026-07-01");
        expect(selectNextReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-07-01",
            today: "2026-07-14",
            daysBeforeDue: [0],
            overdueIntervalDays: null,
            processedDedupKeys: new Set([dueKey]),
            hasScheduledHistory: true,
        })).toBeNull();
        expect(selectNextReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-07-01",
            today: "2026-07-14",
            daysBeforeDue: [0],
            overdueIntervalDays: 7,
            processedDedupKeys: new Set([dueKey, reminderDedupKey("a1", "OVERDUE", "2026-07-08")]),
            hasScheduledHistory: true,
        })).toEqual({ triggerType: "OVERDUE", scheduledDate: "2026-07-15", dedupKey: "a1:OVERDUE:2026-07-15" });
    });

    it("selects the earliest future custom reminder stage", () => {
        expect(selectNextReminderOccurrence({
            actionId: "a1",
            dueDate: "2026-08-13",
            today: "2026-07-14",
            daysBeforeDue: [14, 2, 0],
            overdueIntervalDays: 10,
            processedDedupKeys: new Set(),
            hasScheduledHistory: false,
        })).toEqual({ triggerType: "PRE_DUE", scheduledDate: "2026-07-30", dedupKey: "a1:PRE_DUE:2026-07-30" });
    });
});
