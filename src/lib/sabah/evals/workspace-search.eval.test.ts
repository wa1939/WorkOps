import { describe, expect, it } from "vitest";
import { evaluateWorkspaceSearch, workspaceSearchCases } from "./workspace-search-cases";

describe("workspace intelligence quality gate", () => {
  it("meets independent duplicate/search precision, recall, and safety release gates", async () => {
    const report = await evaluateWorkspaceSearch(workspaceSearchCases);

    expect(report.duplicate.precision).toBeGreaterThanOrEqual(0.95);
    expect(report.duplicate.recall).toBeGreaterThanOrEqual(0.9);
    expect(report.search.precision).toBeGreaterThanOrEqual(0.95);
    expect(report.search.recall).toBeGreaterThanOrEqual(0.9);
    expect(report.inaccessibleResultCount).toBe(0);
    expect(report.exactRetryBlockRate).toBe(1);
    expect(report.failingCaseIds).toEqual([]);
  });

  it("returns bounded case and aggregate metrics without raw fixture text", async () => {
    const report = await evaluateWorkspaceSearch(workspaceSearchCases);

    expect(Object.keys(report).sort()).toEqual([
      "duplicate",
      "exactRetryBlockRate",
      "failingCaseIds",
      "inaccessibleResultCount",
      "metrics",
      "precision",
      "recall",
      "search",
      "totalCases",
    ]);
    expect(Object.keys(report.duplicate).sort()).toEqual(["expectedCount", "precision", "predictedCount", "recall", "truePositiveCount"]);
    expect(Object.keys(report.search).sort()).toEqual(["expectedCount", "precision", "predictedCount", "recall", "truePositiveCount"]);
    expect(report.totalCases).toBe(workspaceSearchCases.length);
    expect(report.metrics.every((metric) => /^workspace-[a-z0-9-]+$/.test(metric.caseId))).toBe(true);
    expect(report.metrics.every((metric) => Object.keys(metric).sort().join(",") === "capacityEvidenceFound,caseId,exactRetryBlocked,expectedCount,inaccessibleIndexedCount,inaccessibleResultCount,predictedCount,truePositiveCount")).toBe(true);
  });

  it("measures the authorized current LEAVE result and observes an inaccessible indexed fixture", async () => {
    const leaveCase = workspaceSearchCases.find((item) => item.caseId === "workspace-leave-capacity-conflict");
    expect(leaveCase?.search?.expectedResultIds).toEqual(["leave-current"]);
    expect(leaveCase?.search?.inaccessibleIds).toEqual(["leave-private"]);

    const report = await evaluateWorkspaceSearch(workspaceSearchCases);
    const metric = report.metrics.find((item) => item.caseId === "workspace-leave-capacity-conflict");
    expect(metric).toMatchObject({ expectedCount: 1, predictedCount: 1, truePositiveCount: 1, inaccessibleIndexedCount: 1, inaccessibleResultCount: 0, capacityEvidenceFound: 2 });
  });

  it("fails the capacity case closed when capacity evidence is missing", async () => {
    const casesWithoutCapacityEvidence = workspaceSearchCases.map((item) => item.caseId === "workspace-leave-capacity-conflict"
      ? { ...item, search: { ...item.search!, capacityRecommendation: { ...item.search!.capacityRecommendation!, evidence: [] } } }
      : item);

    const report = await evaluateWorkspaceSearch(casesWithoutCapacityEvidence);

    expect(report.failingCaseIds).toContain("workspace-leave-capacity-conflict");
  });
});
