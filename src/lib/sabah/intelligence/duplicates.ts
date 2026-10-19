import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { DuplicateCandidate, SourceRef, WorkspaceEntityType } from "./contracts";
import { getAuthorizedEntityIds, type AuthorizedScopeDb } from "./authorized-scope";
import { createEntityFingerprint } from "./fingerprint";
import { normalizeWorkspaceText } from "./normalize";

export type DuplicateDraft = Record<string, unknown> & {
  entityType?: WorkspaceEntityType;
  title?: string;
  name?: string;
  idempotencyKey?: string;
};
export type DuplicateRecord = {
  id: string;

  name?: string | null;
  title?: string | null;
  description?: string | null;
  objective?: string | null;
  scope?: string | null;
  successCriteria?: string | null;
  signatureHash?: string | null;
  projectId?: string | null;
  stageId?: string | null;
  caseStudyId?: string | null;
  kpiId?: string | null;
  ownerId?: string | null;
  managerId?: string | null;
  responsibleDepartmentId?: string | null;
  startAt?: Date | string | null;
  dueAt?: Date | string | null;
  dueAtEnd?: Date | string | null;
  updatedAt?: Date | string | null;
  createdAt?: Date | string | null;
  isPrivate?: boolean;
  dependencyIds?: string[];
};
type ExistingWorkflow = { id: string; updatedAt: Date };
type FeatureCandidate = { source: SourceRef; score: number; reasons: string[]; overlap: DuplicateCandidate["overlap"] };
export type DuplicateDb = {
  scopeDb: AuthorizedScopeDb;
  loadCandidates: (entityType: "PROJECT" | "TASK", ids: string[]) => Promise<DuplicateRecord[]>;
  findExistingIdempotentWorkflow?: (key: string, actorId: string) => Promise<ExistingWorkflow | null>;
};

const MAX = 25;
const text = (value: unknown) => normalizeWorkspaceText(typeof value === "string" ? value : "") ?? "";
const firstText = (row: DuplicateRecord) => text(row.title ?? row.name);
const bodyText = (row: DuplicateRecord | DuplicateDraft) => text([row.description, row.objective, row.scope, row.successCriteria].filter((v) => typeof v === "string").join(" "));
function date(value: unknown): number | null {
  const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}
function interval(row: DuplicateRecord | DuplicateDraft) {
  const start = date(row.startAt) ?? date(row.dueAt) ?? date(row.createdAt);
  const end = date(row.dueAtEnd) ?? date(row.dueAt) ?? start;
  return start == null || end == null ? null : ([Math.min(start, end), Math.max(start, end)] as const);
}
function tokenSet(value: string) { return new Set(value.split(/[^A-Za-z0-9\u0600-\u06FF]+/).filter((part) => part.length > 2)); }
function similarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aa = tokenSet(a), bb = tokenSet(b);
  return Array.from(aa).filter((token) => bb.has(token)).length / Math.max(aa.size, bb.size, 1);
}
function recurring(value: unknown) { return /(^|[^A-Za-z])(month|monthly|recurr|repeat|quarter|week|سنوي|شهري|متكرر)([^A-Za-z]|$)/i.test(String(value ?? "")); }
function sourceFor(type: WorkspaceEntityType, row: DuplicateRecord): SourceRef {
  const label = String(row.title ?? row.name ?? `${type} ${row.id}`).slice(0, 120);
  const updated = date(row.updatedAt);
  return {
    entityType: type,
    entityId: row.id,
    label,
    href: type === "PROJECT" ? `/projects/${encodeURIComponent(row.id)}` : `/tasks/${encodeURIComponent(row.id)}`,
    sourceUpdatedAt: new Date(updated ?? 0).toISOString(),
    checksum: createEntityFingerprint({ title: row.title ?? row.name, description: row.description, projectId: row.projectId, kpiId: row.kpiId, startAt: row.startAt, dueAt: row.dueAt }),
  };
}
export function classifyOverlap(candidate: { score: number; exact?: boolean; recurring?: boolean }, _draft: unknown): DuplicateCandidate["overlap"] {
  if (candidate.exact) return "EXACT";
  if (candidate.recurring) return "RECURRING";
  if (candidate.score >= 0.7) return "LIKELY_DUPLICATE";
  return "RELATED";
}
function feature(row: DuplicateRecord, type: WorkspaceEntityType, draft: DuplicateDraft, idempotencyMatch = false): FeatureCandidate {
  const draftTitle = text(draft.title ?? draft.name), title = firstText(row), draftBody = bodyText(draft), body = bodyText(row);
  const reasons: string[] = [];
  let score = Math.max(similarity(draftTitle, title) * 0.85, similarity(draftBody, body) * 0.7);
  const exact = idempotencyMatch || Boolean(draft.fingerprint && row.signatureHash === draft.fingerprint) || (draftTitle !== "" && draftTitle === title && draftBody !== "" && draftBody === body);
  if (exact) { score = 1; reasons.push(idempotencyMatch ? "Existing workflow idempotency key matches" : "Exact fingerprint or retry identity match"); }
  else if (draftTitle && draftTitle === title) { score = Math.max(score, 0.78); reasons.push("Normalized title matches"); }
  else if (score >= 0.45) reasons.push("Related normalized vocabulary");
  for (const key of ["projectId", "stageId", "caseStudyId", "kpiId", "ownerId", "managerId", "responsibleDepartmentId"] as const) {
    if (draft[key] != null && draft[key] === row[key]) { score = Math.min(0.96, score + 0.16); reasons.push(`Shared ${key.replace(/Id$/, "")}`); }
  }
  const a = interval(draft), b = interval(row);
  if (a && b && a[0] <= b[1] && b[0] <= a[1]) { score = Math.min(0.96, score + 0.12); reasons.push("Dates overlap"); }
  const draftDependencyIds = Array.isArray(draft.dependencyIds) ? draft.dependencyIds.map(String) : [];
  if ((draftDependencyIds.includes(row.id) || (Array.isArray(row.dependencyIds) && row.dependencyIds.includes(String(draft.id ?? ""))))) { score = Math.max(score, 0.72); reasons.push("Dependency relation"); }
  const draftRecurring = recurring(draft.recurrence ?? draft.recurrenceRule ?? draft.description);
  const candidateRecurring = recurring(row.title) || recurring(row.description);
  if (draftRecurring && candidateRecurring) reasons.push("Recurring work marker");
  const freshness = date(row.updatedAt);
  if (freshness != null && date(draft.updatedAt) != null && freshness > (date(draft.updatedAt) as number)) score = Math.min(0.98, score + 0.001);
  return { source: sourceFor(type, row), score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0, reasons: reasons.slice(0, 6), overlap: classifyOverlap({ score, exact, recurring: draftRecurring && candidateRecurring }, draft) };
}

export function createPrismaDuplicateDb(): DuplicateDb {
  const scopeDb = { project: prisma.project, task: prisma.task } as unknown as AuthorizedScopeDb;
  const loadCandidates = async (entityType: "PROJECT" | "TASK", ids: string[]): Promise<DuplicateRecord[]> => {
    if (entityType === "PROJECT") return prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, description: true, objective: true, scope: true, successCriteria: true, ownerId: true, managerId: true, responsibleDepartmentId: true, startAt: true, dueAt: true, dueAtEnd: true, updatedAt: true, createdAt: true } });
    return prisma.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, description: true, projectId: true, stageId: true, caseStudyId: true, kpiId: true, startAt: true, dueAt: true, dueAtEnd: true, updatedAt: true, createdAt: true, isPrivate: true, signatureHash: true, dependencies: { select: { dependsOnId: true } } } }).then((rows) => rows.map((row) => ({ ...row, dependencyIds: row.dependencies.map((dependency) => dependency.dependsOnId) })));
  };
  const findExistingIdempotentWorkflow = async (key: string, actorId: string): Promise<ExistingWorkflow | null> => prisma.aiWorkflow.findFirst({ where: { idempotencyKey: key, actorId }, select: { id: true, updatedAt: true } });
  return { scopeDb, loadCandidates, findExistingIdempotentWorkflow };
}

export async function findDuplicateCandidates(draft: DuplicateDraft, actor: SabahActor, db: DuplicateDb): Promise<DuplicateCandidate[]> {
  const type = draft.entityType === "PROJECT" || draft.entityType === "TASK" ? draft.entityType : "TASK";
  const idempotencyMatch = draft.idempotencyKey && db.findExistingIdempotentWorkflow ? await db.findExistingIdempotentWorkflow(draft.idempotencyKey, actor.id) : null;
  if (idempotencyMatch) {
    const checksum = createEntityFingerprint(draft);
    const proposed: SourceRef = { entityType: type, entityId: `draft-${checksum.slice(0, 12)}`, label: `Proposed ${type.toLowerCase()}`, href: `/sabah/preview?entityType=${type}&checksum=${checksum}`, sourceUpdatedAt: new Date(0).toISOString(), checksum };
    return [{ source: { entityType: type, entityId: idempotencyMatch.id, label: "Existing workflow retry", href: proposed.href, sourceUpdatedAt: idempotencyMatch.updatedAt.toISOString(), checksum }, duplicateOf: proposed, score: 1, overlap: "EXACT", reasons: ["Existing workflow idempotency key matches"] }];
  }
  const scope = await getAuthorizedEntityIds(actor, [type], { limit: 100 }, db.scopeDb);
  const ids = scope.ids[type] ?? [];
  const rows = ids.length ? await db.loadCandidates(type, ids) : [];
  const output = rows.filter((row) => row.isPrivate !== true).map((row) => feature(row, type, draft, Boolean(idempotencyMatch))).filter((item) => item.overlap === "EXACT" || item.score >= 0.7 || item.reasons.length > 1).map((item) => ({ source: item.source, duplicateOf: { entityType: type, entityId: typeof draft.id === "string" ? draft.id : `draft-${createEntityFingerprint(draft).slice(0, 12)}`, label: `Proposed ${type.toLowerCase()}`, href: `/sabah/preview?entityType=${type}&checksum=${createEntityFingerprint(draft)}`, sourceUpdatedAt: new Date(0).toISOString(), checksum: createEntityFingerprint(draft) }, score: item.score, overlap: item.overlap, reasons: item.reasons.length ? item.reasons : ["Potentially related work"] }));

  return output.sort((a, b) => b.score - a.score || Date.parse(b.source.sourceUpdatedAt) - Date.parse(a.source.sourceUpdatedAt) || `${a.source.entityType}:${a.source.entityId}`.localeCompare(`${b.source.entityType}:${b.source.entityId}`)).slice(0, MAX);
}

export async function assertNoExactDuplicate(draft: DuplicateDraft, actor: SabahActor, db: DuplicateDb): Promise<void> {
  const candidates = await findDuplicateCandidates(draft, actor, db);
  const exact = candidates.find((candidate) => candidate.overlap === "EXACT");
  if (exact) throw Object.assign(new Error("Duplicate work already exists"), { status: 409, code: "DUPLICATE_WORK" });
}
