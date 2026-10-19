import { describe, expect, it } from "vitest";
import { isDue, nextOccurrence, type RecurrenceRule } from "./recurrence";

const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const baseRule = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({
    freq: "daily",
    interval: 1,
    active: true,
    ...overrides,
});

describe("nextOccurrence", () => {
    it("returns every second day for a daily interval of two", () => {
        const rule = baseRule({ interval: 2 });

        expect(nextOccurrence(rule, date("2026-09-14"))).toEqual(date("2026-09-16"));
        expect(nextOccurrence(rule, date("2026-09-15"))).toEqual(date("2026-09-17"));
    });

    it("normalizes daily occurrences to a Riyadh all-day UTC date", () => {
        const rule = baseRule();

        expect(nextOccurrence(rule, new Date("2026-09-14T21:30:00.000Z"))).toEqual(date("2026-09-15"));
    });

    it("finds Sunday and Thursday occurrences across a Saudi week boundary", () => {
        const rule = baseRule({ freq: "weekly", byDay: [0, 4] });

        expect(nextOccurrence(rule, date("2026-09-16"))).toEqual(date("2026-09-17"));
        expect(nextOccurrence(rule, date("2026-09-17"))).toEqual(date("2026-09-20"));
        expect(nextOccurrence(rule, date("2026-09-18"))).toEqual(date("2026-09-20"));
    });

    it("keeps a two-week weekly interval between recurrence weeks", () => {
        const rule = baseRule({ freq: "weekly", interval: 2, byDay: [0, 4] });

        expect(nextOccurrence(rule, date("2026-09-17"))).toEqual(date("2026-09-27"));
        expect(nextOccurrence(rule, date("2026-09-27"))).toEqual(date("2026-10-01"));
    });

    it("returns the next valid 31st and skips months without that day", () => {
        const rule = baseRule({ freq: "monthly", byMonthDay: 31 });

        expect(nextOccurrence(rule, date("2026-01-30"))).toEqual(date("2026-01-31"));
        expect(nextOccurrence(rule, date("2026-01-31"))).toEqual(date("2026-03-31"));
        expect(nextOccurrence(rule, date("2026-02-28"))).toEqual(date("2026-03-31"));
    });

    it("honors a two-month interval for day-of-month rules", () => {
        const rule = baseRule({ freq: "monthly", interval: 2, byMonthDay: 15 });

        expect(nextOccurrence(rule, date("2026-09-01"))).toEqual(date("2026-09-15"));
        expect(nextOccurrence(rule, date("2026-09-15"))).toEqual(date("2026-11-15"));
    });

    it("finds the second Tuesday of the current or next month", () => {
        const rule = baseRule({ freq: "monthly", nthWeek: 2, weekday: 2 });

        expect(nextOccurrence(rule, date("2026-09-01"))).toEqual(date("2026-09-08"));
        expect(nextOccurrence(rule, date("2026-09-08"))).toEqual(date("2026-10-13"));
    });

    it("skips months that do not contain the requested nth weekday", () => {
        const rule = baseRule({ freq: "monthly", nthWeek: 5, weekday: 1 });

        expect(nextOccurrence(rule, date("2026-02-01"))).toEqual(date("2026-03-30"));
    });

    it("repeats the same month and day yearly", () => {
        const rule = baseRule({ freq: "yearly" });

        expect(nextOccurrence(rule, date("2026-09-14"))).toEqual(date("2027-09-14"));
    });

    it("skips non-leap years for a February 29 yearly recurrence", () => {
        const rule = baseRule({ freq: "yearly", byMonthDay: 29 });

        expect(nextOccurrence(rule, date("2024-02-29"))).toEqual(date("2028-02-29"));
    });

    it("returns null for inactive or malformed rules", () => {
        expect(nextOccurrence(baseRule({ active: false }), date("2026-09-14"))).toBeNull();
        expect(nextOccurrence(baseRule({ interval: 0 }), date("2026-09-14"))).toBeNull();
        expect(nextOccurrence(baseRule({ freq: "weekly", byDay: [] }), date("2026-09-14"))).toBeNull();
        expect(nextOccurrence(baseRule({ freq: "monthly", byMonthDay: 31, nthWeek: 2, weekday: 2 }), date("2026-09-14"))).toBeNull();
        expect(nextOccurrence(baseRule({ freq: "monthly", nthWeek: 2 }), date("2026-09-14"))).toBeNull();
        expect(nextOccurrence(baseRule({ freq: "yearly", byMonthDay: 0 }), date("2026-09-14"))).toBeNull();
        expect(nextOccurrence(baseRule(), new Date("invalid"))).toBeNull();
    });

    it("does not mutate the input date", () => {
        const from = date("2026-09-14");
        const before = from.getTime();

        nextOccurrence(baseRule({ interval: 2 }), from);

        expect(from.getTime()).toBe(before);
    });
});

describe("isDue", () => {
    it("is true only for an active rule whose next run is now or earlier", () => {
        const now = new Date("2026-09-14T12:00:00.000Z");

        expect(isDue(baseRule({ nextRunAt: new Date("2026-09-14T00:00:00.000Z") }), now)).toBe(true);
        expect(isDue(baseRule({ nextRunAt: now }), now)).toBe(true);
        expect(isDue(baseRule({ nextRunAt: new Date("2026-09-15T00:00:00.000Z") }), now)).toBe(false);
        expect(isDue(baseRule({ active: false, nextRunAt: new Date("2026-09-14T00:00:00.000Z") }), now)).toBe(false);
        expect(isDue(baseRule(), now)).toBe(false);
    });

    it("returns false for invalid dates", () => {
        expect(isDue(baseRule({ nextRunAt: new Date("invalid") }), new Date("2026-09-14T00:00:00.000Z"))).toBe(false);
        expect(isDue(baseRule({ nextRunAt: new Date("2026-09-14T00:00:00.000Z") }), new Date("invalid"))).toBe(false);
    });
});
