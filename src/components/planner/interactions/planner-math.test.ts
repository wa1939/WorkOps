import { describe, expect, it } from "vitest";
import {
    clampEstimateHours,
    resizePlannedDateRange,
    shiftPlannedDateRange,
    type PlannedDateRange,
} from "./planner-math";

describe("shiftPlannedDateRange", () => {
    it("moves both planned edges by the requested calendar-day delta", () => {
        const range: PlannedDateRange = {
            plannedStartAt: "2026-01-05T09:00:00.000Z",
            plannedEndAt: "2026-01-07T17:00:00.000Z",
        };

        expect(shiftPlannedDateRange(range, 2)).toEqual({
            plannedStartAt: "2026-01-07T09:00:00.000Z",
            plannedEndAt: "2026-01-09T17:00:00.000Z",
        });
    });

    it("preserves an open edge when only one planned date is set", () => {
        expect(shiftPlannedDateRange({ plannedStartAt: null, plannedEndAt: "2026-01-07T17:00:00.000Z" }, -1)).toEqual({
            plannedStartAt: null,
            plannedEndAt: "2026-01-06T17:00:00.000Z",
        });
    });
});

describe("resizePlannedDateRange", () => {
    const range: PlannedDateRange = {
        plannedStartAt: "2026-01-05T09:00:00.000Z",
        plannedEndAt: "2026-01-07T17:00:00.000Z",
    };

    it("resizes the start edge without moving the end", () => {
        expect(resizePlannedDateRange(range, "start", 1)).toEqual({
            plannedStartAt: "2026-01-06T09:00:00.000Z",
            plannedEndAt: "2026-01-07T17:00:00.000Z",
        });
    });

    it("does not allow an edge to cross the opposite edge", () => {
        expect(resizePlannedDateRange(range, "end", -5)).toEqual({
            plannedStartAt: "2026-01-05T09:00:00.000Z",
            plannedEndAt: "2026-01-05T17:00:00.000Z",
        });
    });
});

describe("clampEstimateHours", () => {
    it("clamps estimates to the supported half-hour range", () => {
        expect(clampEstimateHours(-2)).toBe(0.5);
        expect(clampEstimateHours(30)).toBe(24);
    });

    it("rounds resize input to half-hour increments", () => {
        expect(clampEstimateHours(3.24)).toBe(3);
        expect(clampEstimateHours(3.26)).toBe(3.5);
    });
});
