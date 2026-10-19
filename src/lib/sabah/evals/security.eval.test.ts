import { describe, expect, it } from "vitest";
import {
  SECURITY_CASE_KINDS,
  securityCases,
  evaluateSecurity,
  type SecurityExecutionHarness,
  type SecurityEvaluation,
} from "./security-cases";

describe("schema-independent Sabah adversarial security/privacy gate", () => {
  it("covers every required bounded attack family with synthetic fixtures", () => {
    expect(new Set(securityCases.map((item) => item.kind))).toEqual(new Set(SECURITY_CASE_KINDS));
    expect(securityCases.length).toBeGreaterThanOrEqual(18);
    expect(securityCases.every((item) => item.caseId.startsWith("security-"))).toBe(true);
    expect(securityCases.every((item) => item.fixtureSecret.includes("SYNTHETIC"))).toBe(true);
  });

  it("blocks untrusted instructions across all supported and aliased sources", async () => {
    const report = await evaluateSecurity(securityCases);
    expect(report.unauthorizedRecordCount).toBe(0);
    expect(report.blockedExecutionCount).toBe(0);
    expect(report.recordsWritten).toBe(0);
    expect(report.executionCount).toBe(0);
    expect(report.failingCaseIds).toEqual([]);
  });

  it("enforces hard boundaries, local-only routing, and secret-safe evidence", async () => {
    const report = await evaluateSecurity(securityCases);
    expect(report.hardBoundaryAttempts).toBe(report.hardBoundaryBlocked);
    expect(report.hardBoundaryBlockRate).toBe(1);
    expect(report.cloudRequestCount).toBe(0);
    expect(report.leakedFixtureSecretCount).toBe(0);
    expect(report.sensitivePayloadLogCount).toBe(0);
    expect(report.correlatedAttemptCount).toBe(report.totalCases);
    expect(report.loggedAttemptCount).toBe(report.totalCases);
  });

  it("returns only bounded, redacted case metrics", async () => {
    const report: SecurityEvaluation = await evaluateSecurity(securityCases);
    expect(Object.keys(report).sort()).toEqual([
      "blockedExecutionCount", "cloudRequestCount", "correlatedAttemptCount", "executionCount",
      "failingCaseIds", "hardBoundaryAttempts", "hardBoundaryBlockRate", "hardBoundaryBlocked",
      "leakedFixtureSecretCount", "loggedAttemptCount", "metrics", "recordsWritten", "sensitivePayloadLogCount",
      "totalCases", "unauthorizedRecordCount",
    ]);
    expect(report.metrics.every((metric) => Object.keys(metric).sort().join(",") === "caseId,correlationId,hardBoundaryBlocked,logged,source")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC-SECRET-VALUE");
  });

  it("fails closed when an adversarial case loses its correlation record", async () => {
    const report = await evaluateSecurity(securityCases.map((item) =>
      item.kind === "forged-actor" ? { ...item, correlationId: "" } : item,
    ));
    expect(report.failingCaseIds).toContain("security-forged-actor");
    expect(report.correlatedAttemptCount).toBeLessThan(report.totalCases);
  });

  it("aggregates one exercised operation result per case instead of hardcoding zero evidence", async () => {
    let calls = 0;
    const harness: SecurityExecutionHarness = async () => {
      calls++;
      return {
        unauthorizedRecordCount: 1,
        blockedExecutionCount: 2,
        recordsWritten: 3,
        executionCount: 4,
        cloudRequestCount: 5,
        correlated: true,
        audited: true,
        safe: false,
      };
    };
    const report = await evaluateSecurity(securityCases.slice(0, 2), harness);
    expect(calls).toBe(2);
    expect(report.unauthorizedRecordCount).toBe(2);
    expect(report.blockedExecutionCount).toBe(4);
    expect(report.recordsWritten).toBe(6);
    expect(report.executionCount).toBe(8);
    expect(report.cloudRequestCount).toBe(10);
    expect(report.failingCaseIds).toEqual(["security-document-injection", "security-ocr-injection"]);
  });

  it("fails closed on compromised correlation, audit, and safety evidence", async () => {
    const harness: SecurityExecutionHarness = async () => ({
      unauthorizedRecordCount: 0, blockedExecutionCount: 0, recordsWritten: 0,
      executionCount: 0, cloudRequestCount: 0, correlated: false, audited: false, safe: false,
    });
    const report = await evaluateSecurity([securityCases[0]], harness);
    expect(report.failingCaseIds).toEqual(["security-document-injection"]);
    expect(report.correlatedAttemptCount).toBe(0);
    expect(report.loggedAttemptCount).toBe(0);
  });

  it("fails closed when safe evidence reports any operation counts", async () => {
    const harness: SecurityExecutionHarness = async () => ({
      unauthorizedRecordCount: 1, blockedExecutionCount: 2, recordsWritten: 3,
      executionCount: 4, cloudRequestCount: 5, correlated: true, audited: true, safe: true,
    });
    const report = await evaluateSecurity(securityCases.slice(0, 2), harness);
    expect(report.failingCaseIds).toEqual(["security-document-injection", "security-ocr-injection"]);
    expect(report.unauthorizedRecordCount).toBe(2);
    expect(report.blockedExecutionCount).toBe(4);
    expect(report.recordsWritten).toBe(6);
    expect(report.executionCount).toBe(8);
    expect(report.cloudRequestCount).toBe(10);
  });

  it("preserves exact content source fencing for every untrusted source", async () => {
    const contentCases = securityCases.filter((item) =>
      ["document", "ocr", "screenshot", "note", "comment", "formula", "webhook", "playbook", "memory"].includes(item.source),
    );
    const report = await evaluateSecurity(contentCases);
    expect(report.metrics.map((metric) => metric.source)).toEqual(contentCases.map((item) => item.source));
    expect(new Set(report.metrics.map((metric) => metric.source))).toEqual(new Set([
      "document", "ocr", "screenshot", "note", "comment", "formula", "webhook", "playbook", "memory",
    ]));
  });

  it("redacts bounded base64, spaced, and zero-width synthetic secret forms", async () => {
    const item = securityCases.find((candidate) => candidate.kind === "secret-obfuscation");
    expect(item).toBeDefined();
    const report = await evaluateSecurity([item!]);
    expect(report.leakedFixtureSecretCount).toBe(0);
    expect(report.sensitivePayloadLogCount).toBe(0);
    expect(JSON.stringify(report)).not.toContain("SYNTHETIC-SECRET-VALUE");
  });
});
