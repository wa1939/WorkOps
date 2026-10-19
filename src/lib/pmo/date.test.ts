import { describe, expect, it } from "vitest";
import { fromRiyadhDate, getDueBucket, toDatabaseDate, toRiyadhDate } from "./date";

describe("Riyadh calendar dates", () => {
    it("crosses the UTC day at Riyadh midnight", () => {
        expect(toRiyadhDate(new Date("2026-07-14T20:59:59.000Z"))).toBe("2026-07-14");
        expect(toRiyadhDate(new Date("2026-07-14T21:00:00.000Z"))).toBe("2026-07-15");
    });

    it("round-trips a due date at 09:00 Riyadh", () => {
        expect(fromRiyadhDate("2026-08-12").toISOString()).toBe("2026-08-12T06:00:00.000Z");
    });

    it("represents Prisma DATE values at UTC noon without changing the calendar date", () => {
        expect(toDatabaseDate("2026-08-12").toISOString()).toBe("2026-08-12T12:00:00.000Z");
    });

    it("uses non-overlapping inbox buckets", () => {
        expect(getDueBucket("2026-07-13", "WAITING", "2026-07-14")).toBe("OVERDUE");
        expect(getDueBucket("2026-07-21", "WAITING", "2026-07-14")).toBe("DUE_7");
        expect(getDueBucket("2026-07-22", "WAITING", "2026-07-14")).toBe("DUE_30");
        expect(getDueBucket("2026-07-13", "DONE", "2026-07-14")).toBe("CLOSED");
    });
});
