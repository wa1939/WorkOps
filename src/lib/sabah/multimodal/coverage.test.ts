import { describe, expect, it } from "vitest";
import { measureExtractionCoverage, COVERAGE_MIN_PRINTABLE_CHARACTERS } from "./coverage";

describe("measureExtractionCoverage", () => {
  it("flags blank/scanned pages below deterministic coverage threshold", () => {
    const result = measureExtractionCoverage([
      { page: 1, text: "Readable page with enough printable content", blocks: 2 },
      { page: 2, text: "", blocks: 0 },
      { page: 3, text: "   ", blocks: 0 },
    ]);
    expect(result.printableCharacters).toBe(38);
    expect(result.blockCount).toBe(2);
    expect(result.blankPageRatio).toBeCloseTo(2 / 3);
    expect(result.requiresOcrPages).toEqual([2, 3]);
    expect(result.confidenceProxy).toBeLessThan(0.5);
  });

  it("supports explicit force-OCR pages", () => {
    const result = measureExtractionCoverage([{ page: 4, text: "visible", blocks: 1 }], { forceOcrPages: [4] });
    expect(result.requiresOcrPages).toEqual([4]);
  });

  it("flags nonblank pages below the explicit threshold but not its boundary", () => {
    const result = measureExtractionCoverage([
      { page: 7, text: "x".repeat(COVERAGE_MIN_PRINTABLE_CHARACTERS - 1), blocks: 1 },
      { page: 8, text: "x".repeat(COVERAGE_MIN_PRINTABLE_CHARACTERS), blocks: 1 },
      { page: 9, text: "x".repeat(COVERAGE_MIN_PRINTABLE_CHARACTERS + 1), blocks: 1 },
    ], { forceOcrPages: [9, 7, 7] });
    expect(result.requiresOcrPages).toEqual([7, 9]);
  });
});
