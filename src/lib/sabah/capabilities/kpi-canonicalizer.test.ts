import { describe, expect, it } from "vitest";
import { canonicalizeKpiLogUpdate } from "./kpi-canonicalizer";

describe("KPI log-update canonicalizer", () => {
  it("maps proposal and direct-tool shapes to the same approved capability input", () => {
    const expectedUpdatedAt = "2026-09-06T18:00:00.000Z";
    const proposal = canonicalizeKpiLogUpdate({ id: "k1", value: 90, period: "Q1", note: null }, expectedUpdatedAt);
    const direct = canonicalizeKpiLogUpdate({ kpiId: "k1", value: 90, quarter: "Q1", note: undefined }, expectedUpdatedAt);

    expect(direct).toEqual(proposal);
    expect(direct).toEqual({ id: "k1", value: 90, note: null, period: "Q1", expectedUpdatedAt });
    expect(direct).not.toHaveProperty("quarter");
  });

  it("does not invent a concurrency version during direct-input normalization", () => {
    expect(canonicalizeKpiLogUpdate({ kpiId: "k1", value: 90, quarter: "Q1" })).toEqual({ id: "k1", value: 90, note: null, period: "Q1" });
  });
});
