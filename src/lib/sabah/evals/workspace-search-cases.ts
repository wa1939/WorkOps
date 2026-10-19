import { findDuplicateCandidates, type DuplicateDb, type DuplicateRecord } from "../intelligence/duplicates";
import { workspaceSearch, type IndexedFindManyArgs, type IndexedRow, type WorkspaceSearchDb } from "../intelligence/search";
import type { ScopeRow } from "../intelligence/authorized-scope";
import type { WorkspaceEntityType } from "../intelligence/contracts";
import { recommendAssignments } from "../intelligence/recommendations";
import type { CapacityEvidence, ContextPackDb } from "../intelligence/context-packs";
import type { SourceRef } from "../intelligence/contracts";
import type { SabahActor } from "../auth/actor";

type EvalCase = {
  caseId: string;
  duplicateEntityType: "PROJECT" | "TASK";
  draft: Record<string, unknown>;
  rows: DuplicateRecord[];
  expectedCandidateIds: string[];
  exactRetry?: boolean;
  idempotencyKey?: string;
  search?: {
    entityType: WorkspaceEntityType;
    query: string;
    indexed: IndexedRow[];
    scopeRows: Partial<Record<WorkspaceEntityType, ScopeRow[]>>;
    expectedResultIds: string[];
    inaccessibleIds: string[];
    currentSourceChecksums?: Record<string, string>;
    capacityRecommendation?: { taskRef: SourceRef; candidateUserIds: string[]; effortHours: number; evidence: CapacityEvidence[]; authorizedCandidateIds: string[]; expectedTopUserId: string };
  };
};

export type WorkspaceSearchCaseMetric = {
  caseId: string;
  expectedCount: number;
  predictedCount: number;
  truePositiveCount: number;
  inaccessibleIndexedCount: number;
  inaccessibleResultCount: number;
  exactRetryBlocked: boolean;
  capacityEvidenceFound: number;
};

type WorkspaceSearchQualityMetric = {
  expectedCount: number;
  predictedCount: number;
  truePositiveCount: number;
  precision: number;
  recall: number;
};

export type WorkspaceSearchEvaluation = {
  totalCases: number;
  duplicate: WorkspaceSearchQualityMetric;
  search: WorkspaceSearchQualityMetric;
  precision: number;
  recall: number;
  inaccessibleResultCount: number;
  exactRetryBlockRate: number;
  failingCaseIds: string[];
  metrics: WorkspaceSearchCaseMetric[];
};

const actor: SabahActor = { id: "eval-actor", role: "MEMBER", departmentIds: ["eval-dept"] };
const date = "2026-08-20T00:00:00.000Z";
const sourceChecksum = (id: string) => `checksum-${id}`;
const identity = (type: WorkspaceEntityType, id: string, label: string, checksum = sourceChecksum(id)): IndexedRow => ({
  id: `identity-${id}`, entityType: type, entityId: id, chunkKind: "identity",
  text: JSON.stringify({ entityType: type, entityId: id, label, href: type === "PROJECT" ? `/projects/${id}` : type === "LEAVE" ? `/leave/${id}` : `/tasks/${id}` }),
  checksum, sourceUpdatedAt: date,
});
const chunk = (type: WorkspaceEntityType, id: string, text: string, options: Pick<IndexedRow, "staleAt" | "checksum"> = {}): IndexedRow => ({
  id: `chunk-${id}`, entityType: type, entityId: id, chunkKind: "body", text, normalizedText: text,
  checksum: options.checksum ?? sourceChecksum(id), sourceUpdatedAt: date, staleAt: options.staleAt,
});

const project = (id: string, name: string, description: string): DuplicateRecord => ({ id, name, description, isPrivate: false, responsibleDepartmentId: "eval-dept", updatedAt: date });
const task = (id: string, title: string, description: string, extra: Partial<DuplicateRecord> = {}): DuplicateRecord => ({ id, title, description, isPrivate: false, createdAt: date, updatedAt: date, ...extra });
const scopeRow = (id: string, extra: Partial<ScopeRow> = {}): ScopeRow => ({ id, responsibleDepartmentId: "eval-dept", ...extra });
const taskSource = (id: string, label: string): SourceRef => ({ entityType: "TASK", entityId: id, label, href: `/tasks/${id}`, sourceUpdatedAt: date, checksum: `checksum-${id}` });

const leaveSearch = {
  entityType: "LEAVE" as const,
  query: "annual leave coverage",
  indexed: [
    identity("LEAVE", "leave-current", "Current leave record"),
    chunk("LEAVE", "leave-current", "Annual leave coverage and bounded capacity plan"),
    identity("LEAVE", "leave-private", "Private leave record"),
    chunk("LEAVE", "leave-private", "Annual leave coverage private record"),
    identity("LEAVE", "leave-stale", "Stale leave record"),
    chunk("LEAVE", "leave-stale", "Annual leave coverage stale record", { staleAt: "2026-08-21T00:00:00.000Z" }),
    identity("LEAVE", "leave-mismatched", "Mismatched leave record"),
    chunk("LEAVE", "leave-mismatched", "Annual leave coverage with changed source", { checksum: "old-checksum" }),
  ],
  scopeRows: {
    LEAVE: [
      scopeRow("leave-current", { userId: actor.id, status: "PENDING" }),
      scopeRow("leave-private", { userId: "foreign-actor", status: "PENDING" }),
      scopeRow("leave-stale", { userId: actor.id, status: "PENDING" }),
      scopeRow("leave-mismatched", { userId: actor.id, status: "PENDING" }),
    ],
  },
  expectedResultIds: ["leave-current"],
  inaccessibleIds: ["leave-private"],
  currentSourceChecksums: { "leave-mismatched": "new-checksum" },
  capacityRecommendation: {
    taskRef: taskSource("capacity-task", "Coordinate bounded leave capacity"), candidateUserIds: ["capacity-on-leave", "capacity-available"], effortHours: 8,
    evidence: [
      { userId: "capacity-on-leave", displayName: "On leave", capacityHours: 35, loadHours: 5, leaveDays: 3 },
      { userId: "capacity-available", displayName: "Available", capacityHours: 20, loadHours: 2, leaveDays: 0 },
    ], authorizedCandidateIds: ["capacity-on-leave", "capacity-available"], expectedTopUserId: "capacity-available",
  },
};

export const workspaceSearchCases: EvalCase[] = [
  { caseId: "workspace-evp-project-overlap", duplicateEntityType: "PROJECT", draft: { entityType: "PROJECT", name: "EVP transformation project", objective: "Employee value proposition transformation" }, rows: [project("evp-existing", "EVP transformation project", "Employee value proposition transformation")], expectedCandidateIds: ["evp-existing"] },
  { caseId: "workspace-employer-brand-unrelated", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "Employer brand campaign", description: "Plan external employer branding" }, rows: [task("survey-unrelated", "Quarterly finance close", "Reconcile ledger balances")], expectedCandidateIds: [] },
  { caseId: "workspace-arabic-normalized", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "مراجعة الأداء", description: "تحليل النتائج" }, rows: [task("arabic-review", "مُراجعة الأداء", "تحليل النتائج")], expectedCandidateIds: ["arabic-review"] },
  { caseId: "workspace-recurring-survey", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "Monthly engagement survey", description: "Recurring employee survey", recurrence: "MONTHLY" }, rows: [task("survey-monthly", "Monthly engagement survey", "Recurring employee survey")], expectedCandidateIds: ["survey-monthly"] },
  { caseId: "workspace-exact-retry", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "Create EVP brief", idempotencyKey: "retry-eval" }, rows: [], expectedCandidateIds: ["workflow-existing"], exactRetry: true, idempotencyKey: "retry-eval" },
  { caseId: "workspace-shared-kpi-date", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "KPI performance review", description: "Review shared KPI results", kpiId: "kpi-shared", startAt: date, dueAt: "2026-08-25T00:00:00.000Z" }, rows: [task("kpi-review", "Performance KPI review", "Review shared KPI results", { kpiId: "kpi-shared", startAt: "2026-08-18T00:00:00.000Z", dueAt: "2026-08-22T00:00:00.000Z" })], expectedCandidateIds: ["kpi-review"] },
  { caseId: "workspace-private-foreign", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "Confidential EVP work" }, rows: [task("private-foreign", "Confidential EVP work", "Restricted", { isPrivate: true })], expectedCandidateIds: [] },
  { caseId: "workspace-dependency-relation", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "Publish EVP brief", dependencyIds: ["dependency-parent"] }, rows: [task("dependency-parent", "Approve legal review", "Unrelated wording")], expectedCandidateIds: ["dependency-parent"] },
  { caseId: "workspace-leave-capacity-conflict", duplicateEntityType: "TASK", draft: { entityType: "TASK", title: "Coordinate bounded leave capacity", description: "Annual leave coverage and bounded capacity plan" }, rows: [], expectedCandidateIds: [], search: leaveSearch },
  { caseId: "workspace-stale-index", duplicateEntityType: "PROJECT", draft: { entityType: "PROJECT", name: "Stale indexed EVP project" }, rows: [], expectedCandidateIds: [], search: { entityType: "PROJECT", query: "EVP", indexed: [identity("PROJECT", "stale-project", "Stale project"), chunk("PROJECT", "stale-project", "EVP project", { staleAt: "2026-08-21T00:00:00.000Z" })], scopeRows: { PROJECT: [scopeRow("stale-project")] }, expectedResultIds: [], inaccessibleIds: [] } },
];

function duplicateDb(rows: DuplicateRecord[], exactRetry: boolean, idempotencyKey?: string): DuplicateDb {
  const values = (type: "PROJECT" | "TASK") => rows.filter((row) => type === "PROJECT" ? row.name !== undefined : row.title !== undefined);
  const scopeModel = (type: "PROJECT" | "TASK") => ({
    findMany: async () => values(type).map((row) => ({ id: row.id, isPrivate: row.isPrivate, createdById: row.id === "private-foreign" ? "foreign-actor" : actor.id, responsibleDepartmentId: "eval-dept" })),
    findUnique: async ({ where }: { where: { id: string } }) => { const row = values(type).find((candidate) => candidate.id === where.id); return row ? { id: row.id, isPrivate: row.isPrivate, createdById: row.id === "private-foreign" ? "foreign-actor" : actor.id, responsibleDepartmentId: "eval-dept" } : null; },
  });
  return {
    scopeDb: { project: scopeModel("PROJECT"), task: scopeModel("TASK") },
    loadCandidates: async (type, ids) => values(type).filter((row) => ids.includes(row.id)),
    ...(exactRetry ? { findExistingIdempotentWorkflow: async (key: string, actorId: string) => key === idempotencyKey && actorId === actor.id ? { id: "workflow-existing", updatedAt: new Date(date) } : null } : {}),
  };
}

type SearchHarness = { db: WorkspaceSearchDb; observedInaccessibleIds: Set<string> };

function searchDb(item: EvalCase): SearchHarness {
  const search = item.search;
  const indexed = search?.indexed ?? [];
  const rowsByType = search?.scopeRows ?? {};
  const observedInaccessibleIds = new Set<string>();
  type ScopeModel = NonNullable<WorkspaceSearchDb["project"]>;
  const scopeModel = (type: WorkspaceEntityType): ScopeModel => ({
    findMany: async (_args) => rowsByType[type] ?? [],
    findUnique: async ({ where }) => (rowsByType[type] ?? []).find((row) => row.id === where.id) ?? null,
  });
  const findMany = async (args: IndexedFindManyArgs) => {
    const rows = indexed.filter((row) => {
      if (args.where.chunkKind === "identity") return row.chunkKind === "identity";
      const text = `${row.text ?? ""} ${row.normalizedText ?? ""}`.toLocaleLowerCase();
      return text.includes((search?.query ?? "").toLocaleLowerCase());
    });
    for (const row of rows) {
      if (search?.inaccessibleIds.includes(row.entityId)) observedInaccessibleIds.add(row.entityId);
    }
    return rows;
  };
  const db: WorkspaceSearchDb = {
    ...(rowsByType.LEAVE ? { leaveRequest: scopeModel("LEAVE") } : {}),
    ...(rowsByType.PROJECT ? { project: scopeModel("PROJECT") } : {}),
    ...(rowsByType.TASK ? { task: scopeModel("TASK") } : {}),
    aiKnowledgeChunk: { findMany },
    aiEntityFingerprint: { findMany: async () => [] },
    getCurrentSource: async (source) => ({ sourceUpdatedAt: date, checksum: search?.currentSourceChecksums?.[source.entityId] ?? sourceChecksum(source.entityId) }),
  };
  return { db, observedInaccessibleIds };
}

function capacityDb(config: NonNullable<NonNullable<EvalCase["search"]>["capacityRecommendation"]>): ContextPackDb {
  return {
    authorize: async (refs) => refs.filter((ref) => ref.entityType === "TASK" && ref.entityId === config.taskRef.entityId),
    load: async (ref) => ({ ref, title: "Bounded capacity task", relationships: [], relations: [] }),
    getCurrentSource: async () => config.taskRef,
    capacity: async () => config.evidence,
    authorizeCandidates: async (_actor, ids) => ids.filter((id) => config.authorizedCandidateIds.includes(id)),
  };
}

export async function evaluateWorkspaceSearch(cases: readonly EvalCase[]): Promise<WorkspaceSearchEvaluation> {
  const metrics: WorkspaceSearchCaseMetric[] = [];
  const duplicateStats = { truePositives: 0, predicted: 0, expected: 0 };
  const searchStats = { truePositives: 0, predicted: 0, expected: 0 };
  let inaccessible = 0; let retryCount = 0; let retryBlocked = 0;
  for (const item of cases) {
    const candidates = await findDuplicateCandidates(item.draft, actor, duplicateDb(item.rows, Boolean(item.exactRetry), item.idempotencyKey));
    const duplicateIds = candidates.map((candidate) => candidate.source.entityId);
    const searchHarness = item.search ? searchDb(item) : null;
    const result = searchHarness ? await workspaceSearch({ query: item.search!.query, entityTypes: [item.search!.entityType], limit: 20 }, actor, searchHarness.db) : null;
    const returnedIds = result?.items.map((entry) => entry.source.entityId) ?? duplicateIds;
    const expectedIds = new Set(item.search?.expectedResultIds ?? item.expectedCandidateIds);
    const truePositiveCount = returnedIds.filter((id) => expectedIds.has(id)).length;
    const inaccessibleCount = returnedIds.filter((id) => item.search?.inaccessibleIds.includes(id) ?? false).length;
    const inaccessibleIndexedCount = searchHarness?.observedInaccessibleIds.size ?? 0;
    const blocked = item.exactRetry ? candidates.some((candidate) => candidate.overlap === "EXACT") : false;
    const capacityConfig = item.search?.capacityRecommendation;
    const recommendations = capacityConfig ? await recommendAssignments({ taskRef: capacityConfig.taskRef, candidateUserIds: capacityConfig.candidateUserIds, effortHours: capacityConfig.effortHours }, actor, capacityDb(capacityConfig)) : null;
    const capacityEvidenceFound = capacityConfig && recommendations && recommendations.recommendations.length === capacityConfig.evidence.length && recommendations.recommendations[0]?.userId === capacityConfig.expectedTopUserId && recommendations.recommendations.some((recommendation) => recommendation.evidence.leaveDays > 0 && recommendation.reasons.some((reason) => reason.includes("leave day(s) reduce weekly capacity"))) ? recommendations.recommendations.length : 0;
    const stats = item.search ? searchStats : duplicateStats;
    stats.truePositives += truePositiveCount; stats.predicted += returnedIds.length; stats.expected += expectedIds.size;
    inaccessible += inaccessibleCount;
    if (item.exactRetry) { retryCount += 1; if (blocked) retryBlocked += 1; }
    metrics.push({ caseId: item.caseId, expectedCount: expectedIds.size, predictedCount: returnedIds.length, truePositiveCount, inaccessibleIndexedCount, inaccessibleResultCount: inaccessibleCount, exactRetryBlocked: blocked, capacityEvidenceFound });
  }
  const quality = (stats: typeof duplicateStats): WorkspaceSearchQualityMetric => ({ expectedCount: stats.expected, predictedCount: stats.predicted, truePositiveCount: stats.truePositives, precision: stats.predicted ? stats.truePositives / stats.predicted : 1, recall: stats.expected ? stats.truePositives / stats.expected : 1 });
  const duplicate = quality(duplicateStats);
  const search = quality(searchStats);
  const failingCaseIds = metrics.filter((metric) => {
    const item = cases.find((candidate) => candidate.caseId === metric.caseId);
    return metric.truePositiveCount !== metric.expectedCount || metric.inaccessibleResultCount !== 0 || (item?.search?.inaccessibleIds.length && metric.inaccessibleIndexedCount === 0) || (metric.caseId === "workspace-exact-retry" && !metric.exactRetryBlocked) || (metric.caseId === "workspace-leave-capacity-conflict" && metric.capacityEvidenceFound === 0);
  }).map((metric) => metric.caseId);
  return { totalCases: cases.length, duplicate, search, precision: duplicate.precision, recall: duplicate.recall, inaccessibleResultCount: inaccessible, exactRetryBlockRate: retryCount ? retryBlocked / retryCount : 1, failingCaseIds, metrics };
}
