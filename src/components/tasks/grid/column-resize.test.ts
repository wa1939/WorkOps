import { describe, expect, it } from "vitest";
import { clampColumnWidth } from "./column-resize";

describe("clampColumnWidth", () => {
    it("clamps widths below the minimum", () => {
        expect(clampColumnWidth(24)).toBe(80);
    });

    it("clamps widths above the maximum", () => {
        expect(clampColumnWidth(640)).toBe(480);
    });

    it("keeps widths inside the allowed range", () => {
        expect(clampColumnWidth(248)).toBe(248);
    });

    it("falls back to the minimum for non-finite widths", () => {
        expect(clampColumnWidth(Number.NaN)).toBe(80);
        expect(clampColumnWidth(Number.POSITIVE_INFINITY)).toBe(80);
    });
});
