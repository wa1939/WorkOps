import type { EvaluationCase, EvaluationRegistry, EvaluationSuite, EvaluationMetrics } from "./registry";
import { REQUIRED_EVALUATION_SUITE_NAMES, validateEvaluationRegistry } from "./registry";

export type EvaluationCaseResult = { readonly caseId: string; readonly caseVersion: string; readonly fixtureHash: string; readonly passed: boolean; readonly metrics: EvaluationMetrics };
export type EvaluationGateResult = { readonly suiteId: string; readonly suiteVersion: string; readonly required: boolean; readonly threshold: EvaluationSuite["threshold"]; readonly totalCount: number; readonly passedCount: number; readonly failedCount: number; readonly passRate: number; readonly passed: boolean; readonly failingCaseIds: readonly string[]; readonly fixtureHashes: readonly string[]; readonly executedAt: string; readonly commitSha: string; readonly cases: readonly EvaluationCaseResult[] };
export type EvaluationRunOptions = { readonly commitSha: string; readonly executedAt?: string };
export type EvaluationAggregate = { readonly passed: boolean; readonly suiteCount: number; readonly passedSuiteCount: number; readonly skippedRequiredSuiteIds: readonly string[]; readonly failures: readonly string[]; readonly results: readonly EvaluationGateResult[]; readonly commitSha: string };

const validText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);
const boundedMetrics = (metrics: EvaluationMetrics | undefined): EvaluationMetrics => {
  if (metrics === undefined) return {};
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) throw new Error("invalid evaluation metrics");
  const entries = Object.entries(metrics);
  if (entries.length > 100) throw new Error("evaluation metrics exceed bound");
  for (const [key, value] of entries) {
    if (!key || key.length > 80 || !validText(key) || !(typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) || (typeof value === "string" && value.length > 256)) throw new Error("invalid evaluation metric");
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
};
const canonical = (value: unknown): string => { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`; return JSON.stringify(value); };

export async function runEvaluationSuite(registry: EvaluationRegistry, suiteId: string, options: EvaluationRunOptions): Promise<EvaluationGateResult> {
  validateEvaluationRegistry(registry);
  if (!validText(suiteId) || !validText(options.commitSha)) throw new Error("invalid evaluation identity");
  const suite = registry.suites.find((item) => item.suiteId === suiteId);
  if (!suite) throw new Error(`unknown evaluation suite: ${suiteId}`);
  const executedAt = options.executedAt ?? new Date().toISOString();
  if (!validText(executedAt) || Number.isNaN(Date.parse(executedAt))) throw new Error("invalid evaluation timestamp");
  const cases: EvaluationCaseResult[] = [];
  for (const item of suite.cases) {
    const outcome = item.run ? await item.run() : { passed: false };
    if (!outcome || typeof outcome.passed !== "boolean") throw new Error(`invalid evaluation outcome: ${item.caseId}`);
    cases.push({ caseId: item.caseId, caseVersion: item.caseVersion, fixtureHash: item.fixtureHash, passed: outcome.passed, metrics: boundedMetrics(outcome.metrics) });
  }
  const passedCount = cases.filter((item) => item.passed).length;
  const failedCount = cases.length - passedCount;
  const passRate = cases.length === 0 ? 0 : passedCount / cases.length;
  return { suiteId: suite.suiteId, suiteVersion: suite.suiteVersion, required: suite.required, threshold: suite.threshold, totalCount: cases.length, passedCount, failedCount, passRate, passed: passRate >= suite.threshold.minPassRate && (suite.threshold.maxFailures === undefined || failedCount <= suite.threshold.maxFailures), failingCaseIds: cases.filter((item) => !item.passed).map((item) => item.caseId), fixtureHashes: cases.map((item) => item.fixtureHash), executedAt, commitSha: options.commitSha, cases };
}

export function aggregateEvaluationGates(registry: EvaluationRegistry, results: readonly EvaluationGateResult[], options: { readonly commitSha: string; readonly reportGeneratedAt?: string }): EvaluationAggregate {
  const failures: string[] = [];
  try { validateEvaluationRegistry(registry); } catch { failures.push("invalid evaluation registry"); }
  if (!validText(options.commitSha)) failures.push("invalid commit identity");
  const reportTimestampValid = options.reportGeneratedAt === undefined || validText(options.reportGeneratedAt);
  const reportTime = reportTimestampValid && options.reportGeneratedAt !== undefined ? Date.parse(options.reportGeneratedAt) : undefined;
  if (!reportTimestampValid || (options.reportGeneratedAt !== undefined && Number.isNaN(reportTime))) failures.push("invalid report timestamp");
  const suites = Array.isArray(registry?.suites)
    ? registry.suites.filter((item): item is EvaluationSuite => Boolean(item && typeof item === "object"))
    : [];
  const byId = new Map(suites.map((item) => [item.suiteId, item]));
  const seen = new Set<string>();
  const validResults: EvaluationGateResult[] = [];
  for (const result of Array.isArray(results) ? results : []) {
    if (!result || !validText(result.suiteId) || !byId.has(result.suiteId)) { failures.push(`unknown suite result: ${result?.suiteId ?? "invalid"}`); continue; }
    if (seen.has(result.suiteId)) { failures.push(`duplicate suite result: ${result.suiteId}`); continue; }
    seen.add(result.suiteId);
    const expected = byId.get(result.suiteId)!;
    try {
      if (result.suiteVersion !== expected.suiteVersion || result.required !== expected.required || canonical(result.threshold) !== canonical(expected.threshold)) { failures.push(`suite identity mismatch: ${result.suiteId}`); continue; }
      if (!validText(result.commitSha) || result.commitSha !== options.commitSha || !validText(result.executedAt) || Number.isNaN(Date.parse(result.executedAt)) || (reportTime !== undefined && Date.parse(result.executedAt) > reportTime) || !Array.isArray(result.cases)) throw new Error("stale");
      const expectedCases = new Map(expected.cases.map((item) => [`${item.caseId}@${item.caseVersion}`, item]));
      const caseKeys = new Set<string>();
      let passedCount = 0;
      const failingCaseIds: string[] = [];
      const fixtureHashes: string[] = [];
      for (const item of result.cases) {
        if (!item || !validText(item.caseId) || !validText(item.caseVersion) || !validText(item.fixtureHash) || typeof item.passed !== "boolean" || !item.metrics || typeof item.metrics !== "object" || Array.isArray(item.metrics)) throw new Error("case");
        const key = `${item.caseId}@${item.caseVersion}`;
        const registered = expectedCases.get(key);
        if (!registered || registered.fixtureHash !== item.fixtureHash || caseKeys.has(key)) throw new Error("case");
        boundedMetrics(item.metrics);
        caseKeys.add(key); fixtureHashes.push(item.fixtureHash);
        if (item.passed) passedCount++; else failingCaseIds.push(item.caseId);
      }
      if (caseKeys.size !== expected.cases.length || result.totalCount !== result.cases.length || result.totalCount !== expected.cases.length || result.passedCount !== passedCount || result.failedCount !== result.cases.length - passedCount || result.passRate !== (result.cases.length === 0 ? 0 : passedCount / result.cases.length) || result.passRate < 0 || result.passRate > 1 || result.passed !== (passedCount / (result.cases.length || 1) >= expected.threshold.minPassRate && (expected.threshold.maxFailures === undefined || result.cases.length - passedCount <= expected.threshold.maxFailures)) || canonical(result.failingCaseIds) !== canonical(failingCaseIds) || canonical(result.fixtureHashes) !== canonical(fixtureHashes)) throw new Error("case");
      validResults.push(result);
    } catch { failures.push(`invalid evaluation case result: ${result.suiteId}`); }
  }
  const skippedRequiredSuiteIds = REQUIRED_EVALUATION_SUITE_NAMES.filter((suiteId) => !seen.has(suiteId));
  failures.push(...skippedRequiredSuiteIds.map((id) => `required suite skipped: ${id}`));
  failures.push(...validResults.filter((item) => !item.passed).map((item) => `suite failed: ${item.suiteId}`));
  if (validResults.length === 0 && suites.length > 0) failures.push("stale report");
  const uniqueFailures = Array.from(new Set(failures)).sort();
  return { passed: uniqueFailures.length === 0 && suites.length > 0, suiteCount: validResults.length, passedSuiteCount: validResults.filter((item) => item.passed).length, skippedRequiredSuiteIds, failures: uniqueFailures, results: [...validResults].sort((a, b) => a.suiteId.localeCompare(b.suiteId)), commitSha: options.commitSha };
}
