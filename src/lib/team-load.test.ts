import { describe, it, expect } from "vitest";
import {
    estimateEffort,
    estimateEffortWithSource,
    hoursBreakdownForWindow,
    loadPercentForCapacity,
    DEFAULT_EFFORT_HOURS,
    type WeekWindow,
} from "./team-load";

const window0: WeekWindow = {
    weekStart: new Date("2026-08-22T21:00:00Z"),
    weekEnd: new Date("2026-08-29T21:00:00Z"),
    label: "23 Aug – 29 Aug",
};

describe("estimateEffortWithSource precedence", () => {
    it("manual > ai > user median > global median > 2h default", () => {
        expect(estimateEffortWithSource({ effortHours: 5, aiEffortHours: 3 }, 4, 2.5))
            .toEqual({ hours: 5, source: "manual" });
        expect(estimateEffortWithSource({ effortHours: null, aiEffortHours: 3 }, 4, 2.5))
            .toEqual({ hours: 3, source: "ai" });
        expect(estimateEffortWithSource({ effortHours: null, aiEffortHours: null }, 4, 2.5))
            .toEqual({ hours: 4, source: "median" });
        expect(estimateEffortWithSource({ effortHours: null, aiEffortHours: null }, undefined, 2.5))
            .toEqual({ hours: 2.5, source: "median" });
        expect(estimateEffortWithSource({ effortHours: null, aiEffortHours: null }, undefined, null))
            .toEqual({ hours: DEFAULT_EFFORT_HOURS, source: "default" });
    });
    it("estimateEffort wrapper returns just the hours", () => {
        expect(estimateEffort({ effortHours: null, aiEffortHours: 3 })).toBe(3);
    });
});

describe("hoursBreakdownForWindow", () => {
    const tasks = [
        { title: "A".repeat(80), dueAt: new Date("2026-08-24T09:00:00Z"), effortHours: 10, aiEffortHours: null }, // in window
        { title: "no due", dueAt: null, effortHours: null, aiEffortHours: 4 },                                     // window 0 only
        { title: "overdue", dueAt: new Date("2026-08-01T09:00:00Z"), effortHours: null, aiEffortHours: null },     // piles on window 0
        { title: "next week", dueAt: new Date("2026-09-01T09:00:00Z"), effortHours: 99, aiEffortHours: null },     // outside
    ];
    it("buckets, totals, and ranks the top-3 drivers", () => {
        const { total, drivers } = hoursBreakdownForWindow(tasks, 0, window0, window0.weekStart, undefined, null);
        expect(total).toBe(10 + 4 + DEFAULT_EFFORT_HOURS);
        expect(drivers.map((d) => d.source)).toEqual(["manual", "ai", "default"]);
        expect(drivers[0].title.length).toBe(60); // truncated
    });
    it("excludes no-due and overdue from later windows", () => {
        const w1: WeekWindow = {
            weekStart: new Date("2026-08-29T21:00:00Z"),
            weekEnd: new Date("2026-09-05T21:00:00Z"),
            label: "30 Aug – 05 Sep",
        };
        const { total } = hoursBreakdownForWindow(tasks, 1, w1, window0.weekStart, undefined, null);
        expect(total).toBe(99); // only "next week"
    });

    it("overload beyond two hundred percent is shown truly", () => {
        expect(loadPercentForCapacity(70, 30)).toBe(233);
    });
});
