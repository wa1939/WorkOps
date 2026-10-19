import { describe, expect, it } from "vitest";
import { deriveImplementationDuration } from "./duration";

describe("deriveImplementationDuration", () => {
    it("derives the approved EVP duration from calendar dates", () => {
        expect(deriveImplementationDuration("2026-11-01", "2027-04-30")).toEqual({
            months: 6,
            label: "6 months",
        });
    });

    it("counts a single calendar month inclusively", () => {
        expect(deriveImplementationDuration("2026-11-01", "2026-11-30")).toEqual({
            months: 1,
            label: "1 month",
        });
    });

    it("uses the singular label for exactly one month", () => {
        expect(deriveImplementationDuration("2026-11-01", "2026-11-30").label).toBe("1 month");
    });

    it("spans year boundaries", () => {
        expect(deriveImplementationDuration("2026-11-01", "2028-02-15")).toEqual({
            months: 16,
            label: "16 months",
        });
    });

    it("accepts a same-day range as one month", () => {
        expect(deriveImplementationDuration("2026-11-01", "2026-11-01")).toEqual({
            months: 1,
            label: "1 month",
        });
    });

    it("rejects an inverted date range", () => {
        expect(() => deriveImplementationDuration("2027-04-30", "2026-11-01")).toThrow(/date order/i);
    });

    it("rejects malformed calendar dates", () => {
        expect(() => deriveImplementationDuration("not-a-date", "2027-04-30")).toThrow();
        expect(() => deriveImplementationDuration("2026-13-01", "2027-04-30")).toThrow();
        expect(() => deriveImplementationDuration("2026-02-31", "2027-04-30")).toThrow();
        expect(() => deriveImplementationDuration("", "2027-04-30")).toThrow();
    });
});
