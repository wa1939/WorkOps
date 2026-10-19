import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import type { EvaluationAggregate, EvaluationCaseResult, EvaluationGateResult } from "./runner";

export type EvaluationReport = { readonly path: string; readonly sha256: string; readonly summary: { readonly passed: boolean; readonly suiteCount: number; readonly failedSuiteCount: number; readonly failingCaseIds: readonly string[]; readonly skippedRequiredSuiteIds: readonly string[]; readonly failures: readonly string[] } };
export type EvaluationReportInput = { readonly aggregate: EvaluationAggregate; readonly generatedAt: string };
export type EvaluationReportOptions = { readonly safeRoot: string; readonly allowOverwrite?: boolean };

const validText = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);
const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);

/** Canonical JSON: bounded, recursively key-sorted, and free of unsupported values. */
export function canonicalEvaluationJson(value: unknown, depth = 0, state = { nodes: 0 }): string {
  if (++state.nodes > 10000 || depth > 16) throw new Error("evaluation report exceeds canonicalization bounds");
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalEvaluationJson(item, depth + 1, state)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalEvaluationJson(record[key], depth + 1, state)}`).join(",")}}`;
  }
  throw new Error("unsupported value in evaluation report");
}

function safeMetrics(metrics: EvaluationCaseResult["metrics"]): EvaluationCaseResult["metrics"] {
  const keys = Object.keys(metrics);
  if (keys.length > 100) throw new Error("evaluation report metrics exceed bound");
  for (const key of keys) { const value = metrics[key]; if (!validText(key) || key.length > 80 || !(typeof value === "string" || typeof value === "boolean" || finite(value)) || (typeof value === "string" && value.length > 256)) throw new Error("invalid evaluation report metric"); }
  return Object.fromEntries(keys.sort().map((key) => [key, metrics[key]]));
}
function stableCase(item: EvaluationCaseResult): EvaluationCaseResult { return { caseId: item.caseId, caseVersion: item.caseVersion, fixtureHash: item.fixtureHash, passed: item.passed, metrics: safeMetrics(item.metrics) }; }
function stableSuite(suite: EvaluationGateResult): Omit<EvaluationGateResult, "cases"> & { cases: EvaluationCaseResult[] } {
  return { suiteId: suite.suiteId, suiteVersion: suite.suiteVersion, required: suite.required, threshold: { ...(suite.threshold.maxFailures === undefined ? { minPassRate: suite.threshold.minPassRate } : { maxFailures: suite.threshold.maxFailures, minPassRate: suite.threshold.minPassRate }) }, totalCount: suite.totalCount, passedCount: suite.passedCount, failedCount: suite.failedCount, passRate: suite.passRate, passed: suite.passed, failingCaseIds: [...suite.failingCaseIds].sort(), fixtureHashes: [...suite.fixtureHashes].sort(), executedAt: suite.executedAt, commitSha: suite.commitSha, cases: [...suite.cases].map(stableCase).sort((a, b) => `${a.caseId}@${a.caseVersion}`.localeCompare(`${b.caseId}@${b.caseVersion}`)) };
}

async function assertSafePath(path: string, safeRoot: string): Promise<string> {
  if (!validText(path) || !validText(safeRoot)) throw new Error("invalid report path or safe root");
  const root = await realpath(resolve(safeRoot));
  const requested = resolve(path);
  await mkdir(dirname(requested), { recursive: true });
  const parent = await realpath(dirname(requested));
  const target = resolve(parent, basename(requested));
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(`..\\`) || rel.startsWith(`../`)) throw new Error("report path escapes safe root");
  try { const info = await lstat(target); if (info.isSymbolicLink()) throw new Error("report path symlink is not allowed"); if (info.isDirectory()) throw new Error("report path is a directory"); throw new Error("report overwrite requires explicit allowOverwrite"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (parent !== root && (relative(root, parent).startsWith("..") || relative(root, parent).startsWith(`..\\`))) throw new Error("report parent escapes safe root");
  return target;
}

export async function writeEvaluationReport(path: string, input: EvaluationReportInput, options: EvaluationReportOptions): Promise<EvaluationReport> {
  if (!input?.aggregate || !validText(input.generatedAt) || Number.isNaN(Date.parse(input.generatedAt))) throw new Error("invalid evaluation report input");
  if (options.allowOverwrite === true) throw new Error("safe overwrite unavailable: no safe no-follow atomic strategy");
  await mkdir(options.safeRoot, { recursive: true });
  const target = await assertSafePath(path, options.safeRoot);
  const aggregate = input.aggregate;
  const suites = [...aggregate.results].sort((a, b) => a.suiteId.localeCompare(b.suiteId)).map(stableSuite);
  const failingCaseIds = suites.flatMap((item) => item.failingCaseIds).sort();
  const summary = { passed: aggregate.passed, suiteCount: aggregate.suiteCount, failedSuiteCount: suites.filter((item) => !item.passed).length, failingCaseIds, skippedRequiredSuiteIds: [...aggregate.skippedRequiredSuiteIds], failures: [...aggregate.failures].sort() };
  const payload = { schemaVersion: "1.0.0", commitSha: aggregate.commitSha, generatedAt: input.generatedAt, summary, suites };
  const content = `${JSON.stringify(JSON.parse(canonicalEvaluationJson(payload)), null, 2)}\n`;
  const handle = await open(target, "wx");
  try { await handle.writeFile(content, "utf8"); } finally { await handle.close(); }
  return { path, sha256: createHash("sha256").update(content, "utf8").digest("hex"), summary };
}
