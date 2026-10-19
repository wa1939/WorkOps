import { describe, expect, it } from "vitest";
import { continuityCases, evaluateContinuity, protectedContinuityKinds } from "./continuity-cases";

describe("learning and continuity quality gate", () => {
  it("covers every protected continuity kind with persisted-style records", () => {
    expect(continuityCases).toHaveLength(8);
    expect(new Set(continuityCases.map((item) => item.kind))).toEqual(new Set(protectedContinuityKinds));
    expect(continuityCases.every((item) => item.messages.length > 20)).toBe(true);
    expect(continuityCases.every((item) => item.records.feedback.length + item.records.workflows.length > 0)).toBe(true);
    expect(continuityCases.find((item) => item.kind === "source-links")?.records.feedback[0]?.contextJson).toContain("https://");
    const safetyCase = continuityCases.find((item) => item.kind === "blocked-safety-boundary");
    expect(safetyCase?.expectedProtected.safetyBoundaries).toEqual(["Do not disclose synthetic restricted details"]);
    expect(safetyCase?.records.feedback.some((record) => record.contextJson.includes('"safetyBoundary"'))).toBe(true);
    const originalMessageCase = continuityCases.find((item) => item.kind === "original-message-ids")!;
    expect(originalMessageCase.records.messagesWithOriginalIds.map((record) => record.originalMessageId)).toEqual(originalMessageCase.messages.slice(0, 5).map((message) => message.id));
  });

  it("preserves protected structured fields and source message IDs through compression", async () => {
    const report = await evaluateContinuity(continuityCases);

    expect(report.totalCases).toBe(continuityCases.length);
    expect(report.protectedFieldPreservationRate).toBe(1);
    expect(report.sourceIdPreservationRate).toBe(1);
    expect(report.unresolvedWorkflowPreservationRate).toBe(1);
    expect(report.failingCaseIds).toEqual([]);
  });

  it("returns bounded redacted metrics rather than fixture prose", async () => {
    const report = await evaluateContinuity(continuityCases);

    expect(Object.keys(report).sort()).toEqual([
      "failingCaseIds",
      "metrics",
      "protectedFieldPreservationRate",
      "sourceIdPreservationRate",
      "totalCases",
      "unresolvedWorkflowPreservationRate",
    ]);
    expect(report.metrics.every((metric) => Object.keys(metric).sort().join(",") === "caseId,originalMessageCount,preservedFieldCount,protectedFieldCount,sourceIdCount,sourceIdsPreserved,workflowIdsPreserved")).toBe(true);
    expect(report.metrics.every((metric) => metric.caseId.startsWith("continuity-"))).toBe(true);
  });

  it("fails closed when a provider omits a protected field", async () => {
    const cases = continuityCases.map((item) => item.kind === "rejected-suggestion"
      ? { ...item, providerProtected: { ...item.providerProtected, decisions: [] } }
      : item);

    const report = await evaluateContinuity(cases);

    expect(report.failingCaseIds).toContain("continuity-rejected-suggestion");
  });

  it("derives original message ID preservation from the declared persisted message records", async () => {
    const cases = continuityCases.map((item) => item.kind === "original-message-ids"
      ? { ...item, records: { ...item.records, messagesWithOriginalIds: [...item.records.messagesWithOriginalIds].reverse() } }
      : item);

    const report = await evaluateContinuity(cases);

    expect(report.failingCaseIds).toContain("continuity-original-message-ids");
  });
});
