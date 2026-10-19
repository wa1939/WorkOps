import { describe, expect, it } from "vitest";
import { computeStreak, dayKey } from "./streak";

const NOW = new Date("2026-07-26T09:00:00.000Z");
const d = (day: string, time = "12:00:00.000Z") => new Date(`${day}T${time}`);

describe("computeStreak", () => {
    it("reports an empty streak when nothing has been completed", () => {
        expect(computeStreak([], NOW)).toEqual({
            currentStreak: 0,
            bestStreak: 0,
            totalPoints: 0,
            lastActiveAt: null,
            activeDays: [],
        });
    });

    it("counts consecutive days ending today", () => {
        const result = computeStreak(
            [d("2026-07-26"), d("2026-07-25"), d("2026-07-24")],
            NOW,
        );
        expect(result.currentStreak).toBe(3);
        expect(result.bestStreak).toBe(3);
    });

    it("collapses several completions on one day into a single streak day", () => {
        const result = computeStreak(
            [d("2026-07-26", "08:00:00.000Z"), d("2026-07-26", "17:00:00.000Z")],
            NOW,
        );
        expect(result.currentStreak).toBe(1);
        expect(result.totalPoints).toBe(2); // points still count every task
    });

    it("keeps the streak alive when today has no completion yet", () => {
        // Nothing done today, but yesterday and the day before were — still a live streak.
        const result = computeStreak([d("2026-07-25"), d("2026-07-24")], NOW);
        expect(result.currentStreak).toBe(2);
    });

    it("breaks the streak once a full day is missed", () => {
        const result = computeStreak([d("2026-07-24"), d("2026-07-23")], NOW);
        expect(result.currentStreak).toBe(0);
        expect(result.bestStreak).toBe(2); // history is still credited
    });

    it("finds the longest historical run even when the current streak is shorter", () => {
        const result = computeStreak(
            [
                d("2026-07-26"), // current run of 1
                d("2026-07-10"), // older run of 4
                d("2026-07-09"),
                d("2026-07-08"),
                d("2026-07-07"),
            ],
            NOW,
        );
        expect(result.currentStreak).toBe(1);
        expect(result.bestStreak).toBe(4);
    });

    it("returns only trailing-week days for the dots, oldest first", () => {
        const result = computeStreak(
            [d("2026-07-26"), d("2026-07-24"), d("2026-07-01")],
            NOW,
        );
        expect(result.activeDays).toEqual(["2026-07-24", "2026-07-26"]);
    });

    it("reports the most recent completion instant", () => {
        const result = computeStreak(
            [d("2026-07-24", "06:00:00.000Z"), d("2026-07-26", "05:30:00.000Z")],
            NOW,
        );
        expect(result.lastActiveAt).toBe("2026-07-26T05:30:00.000Z");
    });

    it("ignores unparseable dates rather than throwing", () => {
        const result = computeStreak([d("2026-07-26"), "not-a-date"], NOW);
        expect(result.currentStreak).toBe(1);
    });
});

describe("dayKey", () => {
    it("buckets by calendar day", () => {
        expect(dayKey(new Date("2026-07-26T23:59:59.000Z"))).toBe("2026-07-26");
    });
});
