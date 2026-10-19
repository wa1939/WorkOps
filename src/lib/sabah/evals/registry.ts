export const REQUIRED_EVALUATION_SUITE_NAMES = [
  "capability/authorization", "duplicate/search", "project/task/KPI", "operational parity",
  "memory/playbooks/continuity", "multimodal", "specialist routing", "prompt injection/secrets", "UI/a11y", "reliability",
] as const;

export type EvaluationMetricValue = string | number | boolean;
export type EvaluationMetrics = Readonly<Record<string, EvaluationMetricValue>>;
export type EvaluationOutcome = { readonly passed: boolean; readonly metrics?: EvaluationMetrics };
export type EvaluationCase = { readonly caseId: string; readonly caseVersion: string; readonly fixtureHash: string; readonly run?: () => Promise<EvaluationOutcome> };
export type EvaluationThreshold = { readonly minPassRate: number; readonly maxFailures?: number };
export type EvaluationSuite = { readonly suiteId: string; readonly suiteVersion: string; readonly required: boolean; readonly threshold: EvaluationThreshold; readonly cases: readonly EvaluationCase[] };
export type EvaluationRegistry = { readonly suites: EvaluationSuite[] };

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRequiredName = (value: string): boolean => (REQUIRED_EVALUATION_SUITE_NAMES as readonly string[]).includes(value);

function validateSuite(suite: EvaluationSuite): void {
  if (!suite || !isText(suite.suiteId) || !isRequiredName(suite.suiteId) || !isText(suite.suiteVersion) || typeof suite.required !== "boolean") throw new Error("invalid or unknown required evaluation suite");
  if (!suite.required) throw new Error("required evaluation suite cannot be optional");
  if (!suite.threshold || !isFiniteNumber(suite.threshold.minPassRate) || suite.threshold.minPassRate < 0 || suite.threshold.minPassRate > 1 || (suite.threshold.maxFailures !== undefined && (!Number.isInteger(suite.threshold.maxFailures) || suite.threshold.maxFailures < 0))) throw new Error("invalid evaluation threshold");
  if (!Array.isArray(suite.cases)) throw new Error("invalid evaluation cases");
  const seen = new Set<string>();
  for (const item of suite.cases) {
    if (!item || !isText(item.caseId) || !isText(item.caseVersion) || !isText(item.fixtureHash)) throw new Error("invalid evaluation case");
    const key = `${item.caseId}@${item.caseVersion}`;
    if (seen.has(key)) throw new Error(`duplicate case version: ${key}`);
    seen.add(key);
  }
}

export function createEvaluationRegistry(): EvaluationRegistry { return { suites: [] }; }
export function registerEvaluation(registry: EvaluationRegistry, suite: EvaluationSuite): EvaluationRegistry;
export function registerEvaluation(suite: EvaluationSuite): EvaluationRegistry;
export function registerEvaluation(first: EvaluationRegistry | EvaluationSuite, second?: EvaluationSuite): EvaluationRegistry {
  const registry = second ? first as EvaluationRegistry : createEvaluationRegistry();
  const suite = second ?? first as EvaluationSuite;
  validateSuite(suite);
  if (registry.suites.some((item) => item.suiteId === suite.suiteId && item.suiteVersion === suite.suiteVersion)) throw new Error(`duplicate suite version: ${suite.suiteId}@${suite.suiteVersion}`);
  for (const item of suite.cases) if (registry.suites.some((existing) => existing.cases.some((candidate) => candidate.caseId === item.caseId && candidate.caseVersion === item.caseVersion))) throw new Error(`duplicate case version: ${item.caseId}@${item.caseVersion}`);
  registry.suites.push({ ...suite, cases: [...suite.cases].sort((a, b) => `${a.caseId}@${a.caseVersion}`.localeCompare(`${b.caseId}@${b.caseVersion}`)) });
  return registry;
}

export function validateEvaluationRegistry(registry: EvaluationRegistry): void {
  if (!registry || !Array.isArray(registry.suites)) throw new Error("invalid evaluation registry");
  const seen = new Set<string>();
  for (const suite of registry.suites) { validateSuite(suite); if (seen.has(suite.suiteId)) throw new Error(`duplicate suite result: ${suite.suiteId}`); seen.add(suite.suiteId); }
  if (seen.size !== REQUIRED_EVALUATION_SUITE_NAMES.length || REQUIRED_EVALUATION_SUITE_NAMES.some((name) => !seen.has(name))) throw new Error("incomplete evaluation registry: all required suites must be registered");
}
