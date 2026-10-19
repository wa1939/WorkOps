import { describe, expect, it } from "vitest";
import { buildRuler, monthsSpan, PX_PER_DAY, type TimelineZoom } from "./ruler";

const date = (value: string) => new Date(`${value}T12:00:00`);
const dayKey = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const zooms: TimelineZoom[] = ["day", "week", "month", "quarter", "year"];

describe("timeline ruler", () => {
    it.each(zooms)("builds a one-day %s ruler with the correct width", (zoom) => {
        const result = buildRuler(date("2026-01-05"), date("2026-01-05"), zoom);

        expect(result.columns).toHaveLength(1);
        expect(result.totalWidth).toBe(PX_PER_DAY[zoom]);
        expect(dayKey(result.columns[0].start)).toBe("2026-01-05");
        expect(dayKey(result.columns[0].end)).toBe("2026-01-06");
    });

    it("covers both dates at day zoom and marks Saturday and Sunday", () => {
        const result = buildRuler(date("2026-01-02"), date("2026-01-04"), "day");

        expect(result.columns.map((column) => dayKey(column.start))).toEqual([
            "2026-01-02",
            "2026-01-03",
            "2026-01-04",
        ]);
        expect(result.columns.map((column) => column.label)).toEqual(["2 Jan", "3 Jan", "4 Jan"]);
        expect(result.columns.map((column) => column.isWeekend)).toEqual([false, true, true]);
        expect(result.totalWidth).toBe(3 * PX_PER_DAY.day);
    });

    it("uses ISO week labels while clipping the first and last week to the range", () => {
        const result = buildRuler(date("2026-01-01"), date("2026-01-14"), "week");

        expect(result.columns).toHaveLength(3);
        expect(result.columns.map((column) => column.label)).toEqual([
            "W01 2026",
            "W02 2026",
            "W03 2026",
        ]);
        expect(dayKey(result.columns[0].start)).toBe("2026-01-01");
        expect(dayKey(result.columns[0].end)).toBe("2026-01-05");
        expect(dayKey(result.columns[2].end)).toBe("2026-01-15");
        expect(result.totalWidth).toBe(14 * PX_PER_DAY.week);
    });

    it("labels clipped calendar months and calculates the span across years", () => {
        const result = buildRuler(date("2025-12-20"), date("2026-02-03"), "month");

        expect(result.columns.map((column) => column.label)).toEqual([
            "Dec 2025",
            "Jan 2026",
            "Feb 2026",
        ]);
        expect(monthsSpan(date("2025-12-20"), date("2026-02-03"))).toBe(2);
        expect(result.totalWidth).toBe(46 * PX_PER_DAY.month);
    });

    it("labels every quarter crossed by the range", () => {
        const result = buildRuler(date("2026-02-10"), date("2026-08-02"), "quarter");

        expect(result.columns.map((column) => column.label)).toEqual([
            "Q1 2026",
            "Q2 2026",
            "Q3 2026",
        ]);
        expect(result.totalWidth).toBe(174 * PX_PER_DAY.quarter);
    });

    it("labels every year crossed by the range, including a leap year", () => {
        const result = buildRuler(date("2025-11-15"), date("2027-02-03"), "year");

        expect(result.columns.map((column) => column.label)).toEqual([
            "2025",
            "2026",
            "2027",
        ]);
        expect(result.totalWidth).toBe(446 * PX_PER_DAY.year);
    });

    it("returns a non-negative month span regardless of argument order", () => {
        expect(monthsSpan(date("2026-05-01"), date("2024-02-01"))).toBe(27);
    });
});
