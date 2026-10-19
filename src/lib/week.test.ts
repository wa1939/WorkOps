import { describe, it, expect } from "vitest";
import { riyadhWeekWindow, currentRiyadhWeekWindow } from "./week";

describe("week windows on a Thursday afternoon", () => {
    // 2026-08-27T11:00:00Z = Thursday 14:00 Riyadh; current Saudi week began Sun 23 Aug 00:00 Riyadh
    const now = new Date("2026-08-27T11:00:00Z");
    it("currentRiyadhWeekWindow = the in-progress week", () => {
        const { weekStart, weekEnd } = currentRiyadhWeekWindow(now);
        expect(weekStart.toISOString()).toBe("2026-08-22T21:00:00.000Z");
        expect(weekEnd.toISOString()).toBe("2026-08-29T21:00:00.000Z");
    });
    it("riyadhWeekWindow = the completed week (unchanged contract)", () => {
        const { weekStart, weekEnd } = riyadhWeekWindow(now);
        expect(weekStart.toISOString()).toBe("2026-08-15T21:00:00.000Z");
        expect(weekEnd.toISOString()).toBe("2026-08-22T21:00:00.000Z");
    });
});
