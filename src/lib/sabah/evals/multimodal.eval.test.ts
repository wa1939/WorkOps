import { describe, expect, it } from "vitest";
import { SYNTHETIC_MULTIMODAL_CORPUS } from "./multimodal-corpus-manifest";
import {
  assessOcrQuality,
  exactTableCellAccuracy,
  presentationNormalizedCer,
} from "./ocr-metrics";
import { assessAsrQuality, terminologyAccuracy, wordErrorRate } from "./asr-metrics";

describe("schema-independent multimodal evaluation contracts", () => {
  it("exposes only synthetic, traceable corpus metadata", () => {
    expect(SYNTHETIC_MULTIMODAL_CORPUS.length).toBeGreaterThan(0);
    for (const fixture of SYNTHETIC_MULTIMODAL_CORPUS) {
      expect(fixture.fixtureId).toMatch(/^synthetic-[a-z0-9-]+$/);
      expect(fixture.creationMethod).toBe("hand-authored synthetic fixture");
      expect(fixture.license).toBe("CC0-1.0");
      expect(fixture.source).toBe("Plan 7 Task 10 synthetic corpus");
      expect(fixture.checksum).toMatch(/^not-recorded:/);
      expect(fixture).not.toHaveProperty("content");
    }
  });

  it("calculates presentation-normalized Arabic CER and rejects invalid input", () => {
    expect(presentationNormalizedCer("السَّلَامُ عَلَيْكُمْ", "السلام عليكم")).toBe(0);
    expect(presentationNormalizedCer("abc", "axc")).toBeCloseTo(1 / 3);
    expect(() => presentationNormalizedCer("", "x")).toThrow(/non-empty/);
    expect(() => presentationNormalizedCer("a", "")).toThrow(/non-empty/);
  });

  it("calculates exact table-cell accuracy with strict shape validation", () => {
    expect(exactTableCellAccuracy(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"], ["A", "B", "C", "D", "E", "F", "G", "H", "I", "X"])).toBe(0.9);
    expect(exactTableCellAccuracy([], [])).toBe(1);
    expect(() => exactTableCellAccuracy(["A"], ["A", "B"])).toThrow(/same length/);
  });

  it("calculates WER and terminology accuracy with explicit empty behavior", () => {
    expect(wordErrorRate("alpha beta gamma", "alpha beta gamma")).toBe(0);
    expect(wordErrorRate("alpha beta gamma", "alpha delta gamma")).toBeCloseTo(1 / 3);
    expect(wordErrorRate("a", "a b c")).toBe(2);
    expect(wordErrorRate("", "")).toBe(0);
    expect(() => wordErrorRate("alpha", "")).toThrow(/non-empty/);
    expect(terminologyAccuracy(["KPI", "workflow", "approval", "review", "Arabic"], ["KPI", "workflow", "approval", "review", "other"])).toBe(0.8);
    expect(terminologyAccuracy([], [])).toBe(1);
  });

  it("gates Plan 7 thresholds and routes low confidence to review without records", () => {
    expect(assessOcrQuality({ cer: 0.08, tableCellAccuracy: 0.9, confidence: 0.9 })).toEqual({
      status: "pass",
      route: "accept",
      operationalRecordCount: 0,
    });
    expect(assessAsrQuality({ quietWer: 0.15, noisyWer: 0.25, terminology: 0.9, confidence: 0.9 })).toEqual({
      status: "pass",
      route: "accept",
      operationalRecordCount: 0,
    });
    expect(assessOcrQuality({ cer: 0.01, tableCellAccuracy: 1, confidence: 0.49 })).toEqual({
      status: "review",
      route: "review",
      operationalRecordCount: 0,
    });
    expect(assessAsrQuality({ quietWer: 0.01, noisyWer: 0.01, terminology: 1, confidence: 0.49 })).toEqual({
      status: "review",
      route: "review",
      operationalRecordCount: 0,
    });
    expect(assessOcrQuality({ cer: 0.081, tableCellAccuracy: 1, confidence: 0.9 }).status).toBe("fail");
    expect(assessAsrQuality({ quietWer: 0.151, noisyWer: 0.25, terminology: 1, confidence: 0.9 }).status).toBe("fail");
  });
});
