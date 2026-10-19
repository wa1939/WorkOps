import type { PrismaClient } from "@prisma/client";
import type { SourceRef, WorkspaceEntityType } from "./contracts";
import { normalizeWorkspaceText } from "./normalize";
import { createEntityFingerprint } from "./fingerprint";
import { enqueueJob } from "../jobs/queue";
import type { JobDb, QueueJob, JsonValue } from "../jobs/contracts";
import { scanAndRedactSecrets } from "../security/secret-scan";

const MAX_TEXT = 12_000;
export const ENTITY_TYPES: readonly WorkspaceEntityType[] = ["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"];
type EntityModelName = "project" | "task" | "kPI" | "externalAction" | "notePage" | "leaveRequest" | "caseStudy" | "weeklyReport" | "supportRequest";
const MODEL_BY_TYPE: Record<WorkspaceEntityType, EntityModelName> = { PROJECT: "project", TASK: "task", KPI: "kPI", PMO_ACTION: "externalAction", NOTE: "notePage", LEAVE: "leaveRequest", CASE_STUDY: "caseStudy", REPORT: "weeklyReport", SUPPORT_REQUEST: "supportRequest" };
type FindUnique = (args: { where: { id: string }; select: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
export type IndexDb = Pick<PrismaClient, "aiKnowledgeChunk" | "aiEntityFingerprint"> & Record<EntityModelName, { findUnique: FindUnique }>;
export type IndexChunk = { chunkKind: string; text: string; normalizedText: string; checksum: string };
export type EntityResolver = (ref: SourceRef, db: IndexDb) => Promise<Record<string, unknown> | null>;
export type IndexWarning = { entityType: string; entityId: string; checksum?: string; errorCode: string; retry: () => Promise<void> };
export type IndexerOptions = { now?: () => Date; resolve?: EntityResolver; entityTypes?: WorkspaceEntityType[]; onWarning?: (warning: IndexWarning) => Promise<void>; signal?: AbortSignal; background?: { actorId: string; db?: JobDb; enqueuer?: EntityEnqueuer } };
export type EntityEnqueuer = (input: { type: "INDEX_ENTITY"; idempotencyKey: string; priority: 1 | 2 | 3 | 4; payload: JsonValue; actorId: string; maxAttempts: number }) => Promise<QueueJob>;
export async function enqueueEntityIndex(ref: SourceRef, actorId: string, options: { db?: JobDb; enqueuer?: EntityEnqueuer } = {}): Promise<QueueJob> {
  if (!/^[A-Za-z0-9:_./-]{1,160}$/.test(actorId) || !ref.entityId) throw new Error("index queue identity required");
  const boundedRef = parseSourceRef({ ...ref });
  if (!boundedRef) throw new Error("index payload invalid");
  const payload = scanAndRedactSecrets(boundedRef).value as unknown as JsonValue;
  if (JSON.stringify(payload).length > 50_000) throw new Error("index payload exceeds bounds");
  const input = { type: "INDEX_ENTITY" as const, idempotencyKey: `index:${boundedRef.entityType}:${boundedRef.entityId}:${boundedRef.sourceUpdatedAt}:${boundedRef.checksum}`, priority: 1 as const, payload, actorId, maxAttempts: 3 };
  return options.enqueuer ? options.enqueuer(input) : enqueueJob(options.db, input);
};
const SAFE_FIELD = /^[^\u0000-\u001f\u007f]*$/;
export function parseSourceRef(item: Record<string, unknown>): SourceRef | null {
  const entityType = item.entityType ?? item.type;
  if (typeof entityType !== "string" || !ENTITY_TYPES.includes(entityType as WorkspaceEntityType)) return null;
  const entityId = item.entityId ?? item.id;
  if (typeof entityId !== "string" || entityId.length < 1 || entityId.length > 256 || !SAFE_FIELD.test(entityId)) return null;
  if (typeof item.label !== "string" || item.label.length < 1 || item.label.length > 256 || !SAFE_FIELD.test(item.label)) return null;
  if (typeof item.href !== "string" || item.href.length < 2 || item.href.length > 256 || !item.href.startsWith("/") || item.href.includes("//") || item.href.includes("\\") || !SAFE_FIELD.test(item.href)) return null;
  if (item.sourceUpdatedAt !== undefined && typeof item.sourceUpdatedAt !== "string") return null;
  const sourceUpdatedAt = item.sourceUpdatedAt === undefined ? new Date(0) : new Date(item.sourceUpdatedAt);
  if (!Number.isFinite(sourceUpdatedAt.getTime())) return null;
  if (item.checksum !== undefined && (typeof item.checksum !== "string" || item.checksum.length < 1 || item.checksum.length > 256 || !SAFE_FIELD.test(item.checksum))) return null;
  return { entityType: entityType as WorkspaceEntityType, entityId, label: item.label, href: item.href, sourceUpdatedAt: sourceUpdatedAt.toISOString(), checksum: typeof item.checksum === "string" ? item.checksum : "" };
}

export const SELECT_BY_TYPE: Record<WorkspaceEntityType, Record<string, unknown>> = {
  PROJECT: { id: true, name: true, description: true, status: true, startAt: true, dueAt: true, dueAtEnd: true, priority: true, health: true, objective: true, scope: true, successCriteria: true, updatedAt: true, createdAt: true },
  TASK: { id: true, title: true, description: true, type: true, status: true, priority: true, startAt: true, dueAt: true, dueAtEnd: true, isPrivate: true, projectId: true, caseStudyId: true, kpiId: true, updatedAt: true, createdAt: true },
  KPI: { id: true, perspective: true, objective: true, name: true, definition: true, formula: true, dataSource: true, metric: true, unit: true, annualTarget: true, calculationType: true, level1: true, level2: true, level3: true, level4: true, level5: true, q1Target: true, q2Target: true, q3Target: true, q4Target: true, trackingPeriod: true, status: true, reminderRule: true, updatedAt: true, createdAt: true },
  PMO_ACTION: { id: true, taskId: true, overdueIntervalDays: true, lastExternalResponseAt: true, closedAt: true, closedById: true, closureNote: true, createdAt: true, updatedAt: true, task: { select: { id: true, title: true, description: true, type: true, status: true, priority: true, startAt: true, dueAt: true, dueAtEnd: true, isPrivate: true, projectId: true, caseStudyId: true, kpiId: true, updatedAt: true } } },
  NOTE: { id: true, title: true, body: true, authorId: true, isShared: true, isPinned: true, color: true, taskId: true, caseStudyId: true, createdAt: true, updatedAt: true },
  LEAVE: { id: true, userId: true, delegateId: true, startAt: true, endAt: true, reason: true, status: true, createdAt: true },
  CASE_STUDY: { id: true, name: true, brief: true, status: true, dueAt: true, dueAtEnd: true, reportBody: true, createdAt: true, updatedAt: true },
  REPORT: { id: true, weekStart: true, weekEnd: true, title: true, body: true, type: true, aiSummary: true, finalBody: true, submittedAt: true, createdAt: true },
  SUPPORT_REQUEST: { id: true, projectId: true, taskId: true, requesterId: true, title: true, description: true, status: true, claimedById: true, createdAt: true, updatedAt: true },
};
function bounded(value: string): string { return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT - 1)}…`; }
function valueObject(row: Record<string, unknown>, keys: string[]): Record<string, unknown> { return Object.fromEntries(keys.filter((key) => row[key] !== undefined && row[key] !== null).map((key) => [key, row[key]])); }
function serialize(ref: SourceRef, row: Record<string, unknown>): IndexChunk[] {
  const task = row.task as Record<string, unknown> | undefined;
  const source = task ? { ...row, ...Object.fromEntries(Object.entries(task).map(([key, value]) => [`task${key[0].toUpperCase()}${key.slice(1)}`, value])) } : row;
  const groups: Array<[string, unknown]> = [["identity", { entityType: ref.entityType, entityId: ref.entityId, label: ref.label, href: ref.href }]];
  const content = valueObject(source, ["title", "name", "description", "body", "brief", "reportBody", "aiSummary", "finalBody", "closureNote", "reason", "objective", "scope", "successCriteria", "taskTitle"]);
  const status = valueObject(source, ["status", "priority", "health", "type", "dueAt", "dueAtEnd", "startAt", "endAt", "annualTarget", "trackingPeriod", "closedAt", "lastExternalResponseAt", "submittedAt", "taskStatus"]);
  const relationships = valueObject(source, ["projectId", "taskId", "caseStudyId", "kpiId"]);
  for (const [kind, value] of [["content", content], ["status", status], ["relationships", relationships]] as Array<[string, unknown]>) if (Object.keys(value as object).length) groups.push([kind, value]);
  return groups.map(([chunkKind, value]) => { const text = bounded(`${chunkKind}: ${JSON.stringify(value)}`); return { chunkKind, text, normalizedText: bounded(normalizeWorkspaceText(text) ?? ""), checksum: createEntityFingerprint(value) }; });
}
function model(ref: SourceRef, db: IndexDb): { findUnique: FindUnique } { return db[MODEL_BY_TYPE[ref.entityType]]; }
function sourceFreshness(ref: SourceRef, source: Record<string, unknown>): Date { const value = source.updatedAt ?? source.createdAt ?? ref.sourceUpdatedAt; const date = value instanceof Date ? value : new Date(String(value)); return Number.isFinite(date.getTime()) ? date : new Date(0); }
function safeNow(options: IndexerOptions): Date { try { const value = options.now ? options.now() : new Date(); return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date(0); } catch { return new Date(0); } }

export async function indexEntity(ref: SourceRef, db: IndexDb, options: IndexerOptions = {}): Promise<{ count: number; unchanged: boolean }> {
  try {
    options.signal?.throwIfAborted();
    const source = options.resolve ? await options.resolve(ref, db) : await model(ref, db).findUnique({ where: { id: ref.entityId }, select: SELECT_BY_TYPE[ref.entityType] });
    options.signal?.throwIfAborted();
    if (!source) { await removeEntityFromIndex(ref, db, options); return { count: 0, unchanged: false }; }
    const chunks = serialize(ref, source);
    const task = source.task as Record<string, unknown> | undefined;
    const existing = await db.aiKnowledgeChunk.findMany({ where: { entityType: ref.entityType, entityId: ref.entityId }, select: { chunkKind: true, checksum: true, staleAt: true, deletedAt: true } });
    const fingerprints = await db.aiEntityFingerprint.findMany({ where: { entityType: ref.entityType, entityId: ref.entityId }, select: { kind: true, fingerprint: true, staleAt: true, deletedAt: true } });
    const current = new Set(chunks.map((chunk) => chunk.chunkKind));
    const removed = Array.from(new Set([...existing.map((item: { chunkKind: string }) => item.chunkKind), ...fingerprints.map((item: { kind: string }) => item.kind)].filter((kind) => !current.has(kind))));
    const freshness = sourceFreshness(ref, source);
    const visibilityClass = source.isPrivate === true || task?.isPrivate === true || (ref.entityType === "NOTE" && source.isShared === false) ? "PRIVATE" : "WORKSPACE";
    const at = safeNow(options);
    for (const chunkKind of removed) {
      options.signal?.throwIfAborted();
      await db.aiKnowledgeChunk.updateMany({ where: { entityType: ref.entityType, entityId: ref.entityId, chunkKind }, data: { staleAt: at, deletedAt: at } });
      await db.aiEntityFingerprint.updateMany({ where: { entityType: ref.entityType, entityId: ref.entityId, kind: chunkKind }, data: { staleAt: at, deletedAt: at } });
    }
    let changed = removed.length > 0;
    for (const chunk of chunks) {
      options.signal?.throwIfAborted();
      const old = existing.find((item: { chunkKind: string; checksum: string; staleAt?: Date | null; deletedAt?: Date | null }) => item.chunkKind === chunk.chunkKind);
      if (old?.checksum === chunk.checksum && old.staleAt == null && old.deletedAt == null) continue;
      changed = true;
      await db.aiKnowledgeChunk.upsert({ where: { entityType_entityId_chunkKind: { entityType: ref.entityType, entityId: ref.entityId, chunkKind: chunk.chunkKind } }, create: { entityType: ref.entityType, entityId: ref.entityId, chunkKind: chunk.chunkKind, text: chunk.text, normalizedText: chunk.normalizedText, checksum: chunk.checksum, sourceUpdatedAt: freshness, visibilityClass, staleAt: null, deletedAt: null }, update: { text: chunk.text, normalizedText: chunk.normalizedText, checksum: chunk.checksum, sourceUpdatedAt: freshness, visibilityClass, staleAt: null, deletedAt: null } });
      await db.aiEntityFingerprint.upsert({ where: { entityType_entityId_kind: { entityType: ref.entityType, entityId: ref.entityId, kind: chunk.chunkKind } }, create: { entityType: ref.entityType, entityId: ref.entityId, kind: chunk.chunkKind, fingerprint: chunk.checksum, sourceUpdatedAt: freshness, staleAt: null, deletedAt: null }, update: { fingerprint: chunk.checksum, sourceUpdatedAt: freshness, staleAt: null, deletedAt: null } });
    }
    return { count: changed ? chunks.length : 0, unchanged: !changed };
  } catch (error) { const errorCode = sanitizeErrorCode(error); if (options.onWarning) await options.onWarning({ entityType: ref.entityType, entityId: ref.entityId, checksum: ref.checksum, errorCode, retry: async () => { await indexEntity(ref, db, options); } }); throw error; }
}
export async function removeEntityFromIndex(ref: SourceRef, db: IndexDb, options: IndexerOptions = {}): Promise<void> { const at = safeNow(options); await Promise.all([db.aiKnowledgeChunk.updateMany({ where: { entityType: ref.entityType, entityId: ref.entityId }, data: { staleAt: at, deletedAt: at } }), db.aiEntityFingerprint.updateMany({ where: { entityType: ref.entityType, entityId: ref.entityId }, data: { staleAt: at, deletedAt: at } })]); }
export function sanitizeErrorCode(error: unknown): string { const raw = error instanceof Error && typeof error.name === "string" ? error.name : "INDEX_ERROR"; const safe = raw.replace(/[\u0000-\u001f\u007f]/g, "_").slice(0, 128); return safe || "INDEX_ERROR"; }
export type IndexRetryEvent = { id?: string; eventType: string; metadataJson: string };
type RetryEventRecord = IndexRetryEvent & { id: string };
export type RetryEventDb = { findMany: (args: { where: Record<string, unknown>; orderBy: { id: "asc" }; take: number; select: { id: true; eventType: true; metadataJson: true } }) => Promise<RetryEventRecord[]>; update: (args: { where: { id: string }; data: { eventType: string } }) => Promise<unknown> };
export async function processIndexRetryEvent(event: IndexRetryEvent, db: IndexDb, options: IndexerOptions = {}): Promise<{ count: number; unchanged: boolean }> { if (event.eventType !== "WORKSPACE_INDEX_RETRY") throw new Error("Unsupported retry event"); let data: Record<string, unknown>; try { data = JSON.parse(event.metadataJson) as Record<string, unknown>; } catch { throw new Error("Invalid retry metadata"); } const ref = parseSourceRef(data); if (!ref || typeof data.sourceUpdatedAt !== "string" || typeof data.errorCode !== "string" || data.errorCode.length < 1 || data.errorCode.length > 128 || !SAFE_FIELD.test(data.errorCode)) throw new Error("Invalid retry metadata"); return indexEntity(ref, db, options); }
export type RetryDispatchOptions = IndexerOptions & { retryLimit?: number; retryCursor?: string };
export async function processPendingIndexRetryEvents(db: IndexDb & { aiWorkflowEvent: RetryEventDb }, options: RetryDispatchOptions = {}): Promise<{ processed: number; failed: number; nextCursor: string | null }> { const take = Math.max(1, Math.min(100, Math.trunc(options.retryLimit ?? 100))); const events = await db.aiWorkflowEvent.findMany({ where: { eventType: "WORKSPACE_INDEX_RETRY", ...(options.retryCursor ? { id: { gt: options.retryCursor } } : {}) }, orderBy: { id: "asc" }, take, select: { id: true, eventType: true, metadataJson: true } }); let processed = 0; let failed = 0; for (const event of events) { try { await processIndexRetryEvent(event, db, options); await db.aiWorkflowEvent.update({ where: { id: event.id }, data: { eventType: "WORKSPACE_INDEX_RETRY_COMPLETED" } }); processed++; } catch { failed++; } } return { processed, failed, nextCursor: events.length === take ? events[events.length - 1].id : null }; }
export async function reconcileEntityBatch(cursor: string | undefined, limit: number, db: IndexDb, options: IndexerOptions = {}): Promise<{ count: number; nextCursor: string | null }> { const boundedLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.trunc(limit) : 1)); const rows = await db.aiEntityFingerprint.findMany({ where: { ...(cursor ? { id: { gt: cursor } } : {}), ...(options.entityTypes?.length ? { entityType: { in: options.entityTypes } } : {}), staleAt: null, deletedAt: null }, orderBy: { id: "asc" }, take: boundedLimit, select: { id: true, entityType: true, entityId: true, sourceUpdatedAt: true, fingerprint: true } }); const seen = new Set<string>(); let count = 0; for (const row of rows) { const key = `${row.entityType}:${row.entityId}`; if (seen.has(key)) continue; seen.add(key); if (!ENTITY_TYPES.includes(row.entityType as WorkspaceEntityType)) continue; const ref = { entityType: row.entityType as WorkspaceEntityType, entityId: row.entityId, label: `${row.entityType} ${row.entityId}`, href: `/${String(row.entityType).toLowerCase()}/${row.entityId}`, sourceUpdatedAt: new Date(row.sourceUpdatedAt).toISOString(), checksum: row.fingerprint };
   if (options.background) { await enqueueEntityIndex(ref, options.background.actorId, options.background); } else { await indexEntity(ref, db, options); }
   count++; } return { count, nextCursor: rows.length === boundedLimit ? rows[rows.length - 1].id : null }; }
