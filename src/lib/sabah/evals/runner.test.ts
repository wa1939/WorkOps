import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEvaluationRegistry, registerEvaluation, validateEvaluationRegistry, REQUIRED_EVALUATION_SUITE_NAMES, type EvaluationSuite } from "./registry";
import { runEvaluationSuite, aggregateEvaluationGates } from "./runner";
import { writeEvaluationReport } from "./report";

const suite = (suiteId: string, overrides: Partial<EvaluationSuite> = {}): EvaluationSuite => ({
  suiteId, suiteVersion: "1.0.0", required: true, threshold: { minPassRate: 1 }, cases: [], ...overrides,
});

describe("versioned evaluation registry and gate runner", () => {
  it("enforces the ten required suite names and rejects unknown suites", () => {
    const registry = createEvaluationRegistry();
    expect(REQUIRED_EVALUATION_SUITE_NAMES).toHaveLength(10);
    expect(() => registerEvaluation(registry, suite("custom"))).toThrow(/required|unknown/i);
    registerEvaluation(registry, suite("reliability"));
    expect(registry.suites.map(({ suiteId }) => suiteId)).toEqual(["reliability"]);
  });

  it("rejects duplicate suite and case versions and malformed runtime values", () => {
    const registry = createEvaluationRegistry();
    registerEvaluation(registry, suite("reliability", { cases: [{ caseId: "case", caseVersion: "1.0.0", fixtureHash: "a" }] }));
    expect(() => registerEvaluation(registry, suite("reliability", { cases: [] }))).toThrow(/suite version/i);
    expect(() => registerEvaluation(registry, suite("operational parity", { cases: [{ caseId: "case", caseVersion: "1.0.0", fixtureHash: "b" }] }))).toThrow(/case version/i);
    expect(() => registerEvaluation(registry, suite("multimodal", { threshold: { minPassRate: Number.NaN } }))).toThrow(/threshold/i);
    expect(() => registerEvaluation(registry, suite("UI/a11y", { cases: [{ caseId: "", caseVersion: "1", fixtureHash: "hash" }] }))).toThrow(/case/i);
  });

  it("reports actual counts, threshold failure, failing ids, metrics, and commit", async () => {
    const registry = createEvaluationRegistry();
    registerEvaluation(registry, suite("reliability", { threshold: { minPassRate: 0.8 }, cases: [
      { caseId: "ok", caseVersion: "1.0.0", fixtureHash: "hash-ok", run: async () => ({ passed: true, metrics: { latencyMs: 4 } }) },
      { caseId: "bad", caseVersion: "1.0.0", fixtureHash: "hash-bad", run: async () => ({ passed: false }) },
    ] }));
    for (const name of REQUIRED_EVALUATION_SUITE_NAMES) if (name !== "reliability") registerEvaluation(registry, suite(name));
    const result = await runEvaluationSuite(registry, "reliability", { commitSha: "abc123", executedAt: "2026-08-29T00:00:00.000Z" });
    expect(result).toMatchObject({ suiteId: "reliability", suiteVersion: "1.0.0", totalCount: 2, passedCount: 1, failedCount: 1, passRate: 0.5, passed: false, failingCaseIds: ["bad"], commitSha: "abc123" });
    expect(result.cases.find((item) => item.caseId === "ok")).toMatchObject({ caseId: "ok", caseVersion: "1.0.0", fixtureHash: "hash-ok", metrics: { latencyMs: 4 } });
  });

  it("requires the complete ten-suite registry", () => {
    const registry = createEvaluationRegistry();
    registerEvaluation(registry, suite("reliability"));
    expect(() => validateEvaluationRegistry(registry)).toThrow(/complete|required|missing/i);
  });

  it("rejects unknown, duplicate, missing, version-mismatched, and stale aggregate results", () => {
    const registry = createEvaluationRegistry();
    for (const name of REQUIRED_EVALUATION_SUITE_NAMES) registerEvaluation(registry, suite(name));
    const base = { suiteId: "reliability", suiteVersion: "1.0.0", required: true, threshold: { minPassRate: 1 }, totalCount: 0, passedCount: 0, failedCount: 0, passRate: 0, passed: false, failingCaseIds: [], fixtureHashes: [], executedAt: "2026-08-29T00:00:00.000Z", commitSha: "sha", cases: [] } as const;
    expect(aggregateEvaluationGates(registry, [{ ...base, suiteId: "unknown" }], { commitSha: "sha" }).passed).toBe(false);
    expect(aggregateEvaluationGates(registry, [base, base], { commitSha: "sha" }).failures).toContain("duplicate suite result: reliability");
    expect(aggregateEvaluationGates(registry, [{ ...base, suiteVersion: "9.0.0" }], { commitSha: "sha" }).failures).toContain("suite identity mismatch: reliability");
    expect(aggregateEvaluationGates(registry, [], { commitSha: "sha" }).skippedRequiredSuiteIds).toHaveLength(10);
  });

  it("fails closed for invalid result numbers and identity fields", () => {
    const registry = createEvaluationRegistry();
    registerEvaluation(registry, suite("reliability", { cases: [{ caseId: "safe", caseVersion: "1.0.0", fixtureHash: "f" }] }));
    const valid = { suiteId: "reliability", suiteVersion: "1.0.0", required: true, threshold: { minPassRate: 1 }, totalCount: 1, passedCount: 1, failedCount: 0, passRate: 1, passed: true, failingCaseIds: [], fixtureHashes: ["f"], executedAt: "2026-08-29T00:00:00.000Z", commitSha: "sha", cases: [{ caseId: "safe", caseVersion: "1.0.0", fixtureHash: "f", passed: true, metrics: {} }] } as const;
    expect(aggregateEvaluationGates(registry, [{ ...valid, passRate: Number.NaN }], { commitSha: "sha" }).passed).toBe(false);
    expect(aggregateEvaluationGates(registry, [{ ...valid, commitSha: "other" }], { commitSha: "sha" }).failures).toContain("stale report");
  });

  it("fails closed for malformed registry entries without throwing", () => {
    const malformedRegistry = { suites: [null] } as never;
    const aggregate = aggregateEvaluationGates(malformedRegistry, [], { commitSha: "sha" });
    expect(aggregate.passed).toBe(false);
    expect(aggregate.failures).toContain("invalid evaluation registry");
  });

  it("fails closed for forged case identities, counters, ranges, and malformed structures", () => {
    const registry = createEvaluationRegistry();
    for (const name of REQUIRED_EVALUATION_SUITE_NAMES) registerEvaluation(registry, suite(name, name === "reliability" ? { cases: [{ caseId: "safe", caseVersion: "1.0.0", fixtureHash: "f" }] } : {}));
    const valid = { suiteId: "reliability", suiteVersion: "1.0.0", required: true, threshold: { minPassRate: 1 }, totalCount: 1, passedCount: 1, failedCount: 0, passRate: 1, passed: true, failingCaseIds: [], fixtureHashes: ["f"], executedAt: "2026-08-29T00:00:00.000Z", commitSha: "sha", cases: [{ caseId: "safe", caseVersion: "1.0.0", fixtureHash: "f", passed: true, metrics: {} }] } as const;
    expect(aggregateEvaluationGates(registry, [{ ...valid, cases: [{ ...valid.cases[0], caseId: "forged" }] }], { commitSha: "sha" }).passed).toBe(false);
    expect(aggregateEvaluationGates(registry, [{ ...valid, passedCount: 0 }], { commitSha: "sha" }).failures).toContain("invalid evaluation case result: reliability");
    expect(aggregateEvaluationGates(registry, [{ ...valid, passRate: 2 }], { commitSha: "sha" }).passed).toBe(false);
    expect(() => aggregateEvaluationGates(registry, [{ ...valid, cases: undefined } as never], { commitSha: "sha" })).not.toThrow();
    expect(aggregateEvaluationGates(registry, [{ ...valid, executedAt: "not-a-date" }], { commitSha: "sha" }).passed).toBe(false);
  });

  it("writes canonical aggregate truth with bounded metrics and rejects unsafe paths", async () => {
    const registry = createEvaluationRegistry();
    for (const name of REQUIRED_EVALUATION_SUITE_NAMES) registerEvaluation(registry, suite(name));
    const dir = await mkdtemp(join(tmpdir(), "sabah-eval-"));
    const aggregate = aggregateEvaluationGates(registry, [], { commitSha: "sha" });
    const path = join(dir, "report.json");
    const report = await writeEvaluationReport(path, { aggregate, generatedAt: "2026-08-29T00:00:00.000Z" }, { safeRoot: dir });
    const content = await readFile(path, "utf8");
    expect(report.path).toBe(path);
    expect(JSON.parse(content).summary).toMatchObject({ passed: false, skippedRequiredSuiteIds: REQUIRED_EVALUATION_SUITE_NAMES });
    expect(content).not.toContain("raw fixture");
    await expect(writeEvaluationReport(join(dir, "..", "escape.json"), { aggregate, generatedAt: "2026-08-29T00:00:00.000Z" }, { safeRoot: dir })).rejects.toThrow(/path|root|safe/i);
    await expect(writeEvaluationReport(path, { aggregate, generatedAt: "2026-08-29T00:00:00.000Z" }, { safeRoot: dir })).rejects.toThrow(/overwrite|exist/i);
    await expect(writeEvaluationReport(path, { aggregate, generatedAt: "2026-08-29T00:00:00.000Z" }, { safeRoot: dir, allowOverwrite: true })).rejects.toThrow(/safe overwrite unavailable/i);
    expect(JSON.parse(await readFile(path, "utf8")).schemaVersion).toBe("1.0.0");
  });
});
