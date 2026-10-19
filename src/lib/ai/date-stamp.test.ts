import { describe, it, expect } from "vitest";
import { getRiyadhDateParts, stampCurrentDate } from "./date-stamp";

describe("Riyadh date projection", () => {
    it("uses one Riyadh calendar projection at the exact midnight boundary", () => {
        const before = new Date("2026-10-07T20:59:59.999Z");
        const at = new Date("2026-10-07T21:00:00.000Z");

        expect(getRiyadhDateParts(before)).toEqual({
            isoDate: "2026-10-07",
            weekday: "Wednesday",
            displayDate: "October 7, 2026",
        });
        expect(getRiyadhDateParts(at)).toEqual({
            isoDate: "2026-10-08",
            weekday: "Thursday",
            displayDate: "October 8, 2026",
        });
        expect(stampCurrentDate("x", at)).toContain("2026-10-08");
    });
});

describe("stampCurrentDate", () => {
    it("prefixes the Riyadh date + weekday and keeps the message intact", () => {
        // 2026-08-23T10:00:00Z = Sunday 13:00 in Riyadh
        const out = stampCurrentDate("حط علي تاسك", new Date("2026-08-23T10:00:00Z"));
        expect(out).toBe("[التاريخ الآن: 2026-08-23 (Sunday, Riyadh)]\nحط علي تاسك");
    });
    it("rolls to the Riyadh calendar day across midnight UTC", () => {
        // 2026-08-22T22:30:00Z = Sunday 01:30 in Riyadh (already the 23rd)
        const out = stampCurrentDate("x", new Date("2026-08-22T22:30:00Z"));
        expect(out.startsWith("[التاريخ الآن: 2026-08-23 (Sunday, Riyadh)]")).toBe(true);
    });
});
