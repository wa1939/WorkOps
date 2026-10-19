import crypto from "node:crypto";
import { findDuplicateCandidates, type DuplicateDb, type DuplicateRecord } from "@/lib/sabah/intelligence/duplicates";

export type DuplicateGuardInput = {
  title: string;
  creatorId: string;
  workspaceId?: string | null;
  recurrenceKey?: string | null;
  idempotencyKey?: string | null;
};

export type DuplicateGuardResult = {
  decision: "allow" | "blocked-idempotent-replay" | "similar-warn";
  existingTaskId?: string;
  similar?: Array<{ id: string; title: string; score: number }>;
  idempotencyKey?: string;
};

type TaskCreateMarker = {
  taskId?: string;
  state?: string;
};

const TASK_CREATE_MARKER_TYPE = "TASK_CREATE";
const IDEMPOTENCY_MARKER_KIND = "IDEMPOTENCY_KEY";
const RECURRENCE_MARKER_KIND = "RECURRENCE_KEY";
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const idempotencyFingerprint = (input: DuplicateGuardInput) => hash(input.idempotencyKey ?? "");
const markerKey = (input: DuplicateGuardInput) => `task-create:${hash(JSON.stringify({ creatorId: input.creatorId, workspaceId: input.workspaceId ?? null, idempotencyKey: input.idempotencyKey }))}`;
const recurrenceFingerprint = (value: string) => hash(value);

function parseMarker(outputJson: unknown): TaskCreateMarker | null {
  if (typeof outputJson !== "string" || !outputJson) return null;
  try {
    const value = JSON.parse(outputJson) as TaskCreateMarker;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

async function taskExists(db: any, taskId: string, input?: DuplicateGuardInput): Promise<boolean> {
  if (!db.task?.findUnique) return true;
  const where: Record<string, unknown> = { id: taskId };
  if (input) {
    where.createdById = input.creatorId;
    if (input.workspaceId !== undefined) where.workspaceId = input.workspaceId;
  }
  const row = await db.task.findUnique({ where, select: { id: true } });
  return Boolean(row);
}

async function readFingerprintTask(db: any, input: DuplicateGuardInput): Promise<string | null> {
  if (!db.aiEntityFingerprint) return null;
  const where = {
    entityType: TASK_CREATE_MARKER_TYPE,
    kind: IDEMPOTENCY_MARKER_KIND,
    fingerprint: idempotencyFingerprint(input),
    staleAt: null,
    deletedAt: null,
  };
  const row = db.aiEntityFingerprint.findFirst
    ? await db.aiEntityFingerprint.findFirst({ where, select: { entityId: true } })
    : (await db.aiEntityFingerprint.findMany?.({ where, select: { entityId: true }, take: 1 }))?.[0];
  if (!row?.entityId || !(await taskExists(db, row.entityId, input))) return null;
  return row.entityId;
}

async function readCapabilityResultTask(db: any, input: DuplicateGuardInput): Promise<string | null> {
  if (!db.aiCapabilityResult?.findUnique || !input.idempotencyKey) return null;
  const row = await db.aiCapabilityResult.findUnique({ where: { key: markerKey(input) }, select: { state: true, outputJson: true } });
  const marker = parseMarker(row?.outputJson);
  if (!marker?.taskId || !(await taskExists(db, marker.taskId, input))) return null;
  return marker.taskId;
}

async function readExistingTask(db: any, input: DuplicateGuardInput): Promise<string | null> {
  if (!input.idempotencyKey) return null;
  return (await readCapabilityResultTask(db, input)) ?? (await readFingerprintTask(db, input));
}

/**
 * Claim the unique capability-result key only inside the task transaction.
 * The transaction client has no $transaction method, while the root Prisma
 * client does; this keeps preview/authorization checks read-only and makes
 * concurrent createTask calls wait for the winning transaction.
 */
async function claimIdempotency(db: any, input: DuplicateGuardInput): Promise<string | null> {
  if (!input.idempotencyKey || !db.aiCapabilityResult?.upsert || typeof db.$transaction === "function") {
    return readExistingTask(db, input);
  }

  const row = await db.aiCapabilityResult.upsert({
    where: { key: markerKey(input) },
    create: { key: markerKey(input), state: "EXECUTING", outputJson: null },
    update: { updatedAt: new Date() },
    select: { state: true, outputJson: true },
  });
  const marker = parseMarker(row?.outputJson);
  if (marker?.taskId && (await taskExists(db, marker.taskId))) return marker.taskId;
  return null;
}

function workspaceWhere(workspaceId: string | null | undefined): Record<string, unknown> {
  return workspaceId === undefined ? {} : { workspaceId };
}

function createDuplicateDb(db: any, workspaceId: string | null | undefined): DuplicateDb | null {
  if (!db.task?.findMany) return null;
  const scopedTask = {
    findMany: (args: any) => db.task.findMany({
      ...args,
      where: { AND: [args.where ?? {}, workspaceWhere(workspaceId)] },
    }),
  };
  return {
    scopeDb: { task: scopedTask } as any,
    loadCandidates: async (entityType: "PROJECT" | "TASK", ids: string[]): Promise<DuplicateRecord[]> => {
      if (entityType !== "TASK" || !ids.length) return [];
      const rows = await db.task.findMany({
        where: { AND: [{ id: { in: ids } }, workspaceWhere(workspaceId)] },
        select: {
          id: true,
          title: true,
          description: true,
          projectId: true,
          stageId: true,
          caseStudyId: true,
          kpiId: true,
          startAt: true,
          dueAt: true,
          dueAtEnd: true,
          updatedAt: true,
          createdAt: true,
          createdById: true,
          isPrivate: true,
          signatureHash: true,
          dependencies: { select: { dependsOnId: true } },
        },
      });
      return rows.map((row: any) => ({ ...row, dependencyIds: row.dependencies.map((dependency: any) => dependency.dependsOnId) }));
    },
  };
}

async function actorForGuard(db: any, creatorId: string): Promise<{ id: string; role: "ADMIN" | "MEMBER"; departmentIds: string[] }> {
  if (!db.user?.findUnique) return { id: creatorId, role: "MEMBER", departmentIds: [] };
  const user = await db.user.findUnique({ where: { id: creatorId }, select: { role: true } });
  return { id: creatorId, role: user?.role === "ADMIN" ? "ADMIN" : "MEMBER", departmentIds: [] };
}

async function recurringCandidateIds(db: any, ids: string[], recurrenceKey?: string | null): Promise<Set<string>> {
  if (!recurrenceKey || !ids.length || !db.aiEntityFingerprint?.findMany) return new Set();
  const rows = await db.aiEntityFingerprint.findMany({
    where: { entityType: "TASK", kind: RECURRENCE_MARKER_KIND, entityId: { in: ids }, staleAt: null, deletedAt: null },
    select: { entityId: true, fingerprint: true },
  });
  // Any persisted recurring occurrence is a legitimate sibling/template, not
  // a duplicate of the new occurrence. Non-recurring legacy rows still pass
  // through the shared similarity scorer.
  return new Set(rows.filter((row: any) => row.fingerprint !== recurrenceFingerprint(recurrenceKey)).map((row: any) => row.entityId));
}

async function recentCreatorMatches(db: any, ids: string[], input: DuplicateGuardInput): Promise<Set<string>> {
  if (!ids.length || !db.task?.findMany) return new Set();
  const createdAfter = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.task.findMany({
    where: {
      AND: [
        { id: { in: ids } },
        { createdById: input.creatorId },
        { createdAt: { gte: createdAfter } },
        workspaceWhere(input.workspaceId),
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((row: { id: string }) => row.id));
}

async function findSimilar(db: any, input: DuplicateGuardInput): Promise<Array<{ id: string; title: string; score: number }>> {
  const duplicateDb = createDuplicateDb(db, input.workspaceId);
  if (!duplicateDb) return [];
  const actor = await actorForGuard(db, input.creatorId);
  const candidates = await findDuplicateCandidates({ entityType: "TASK", title: input.title }, actor as any, duplicateDb);
  const candidateIds = candidates.map((candidate) => candidate.source.entityId);
  const recurringIds = await recurringCandidateIds(db, candidateIds, input.recurrenceKey);
  const recentCreatorIds = await recentCreatorMatches(db, candidateIds, input);
  return candidates
    .filter((candidate) => !recurringIds.has(candidate.source.entityId))
    .map((candidate) => ({
      id: candidate.source.entityId,
      title: candidate.source.label,
      score: recentCreatorIds.has(candidate.source.entityId) ? Math.max(candidate.score, 0.99) : candidate.score,
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 3);
}

export async function checkDuplicateOnCreate(db: any, input: DuplicateGuardInput): Promise<DuplicateGuardResult> {
  const idempotencyKey = input.idempotencyKey ?? undefined;
  const existingTaskId = await claimIdempotency(db, input);
  if (existingTaskId) return { decision: "blocked-idempotent-replay", existingTaskId, idempotencyKey };
  const similar = await findSimilar(db, input);
  return similar.length ? { decision: "similar-warn", similar, idempotencyKey } : { decision: "allow", idempotencyKey };
}

export async function recordTaskCreateMarkers(
  db: any,
  input: DuplicateGuardInput,
  task: { id: string; createdAt?: Date | null },
): Promise<void> {
  const sourceUpdatedAt = task.createdAt ?? new Date();
  if (input.idempotencyKey && db.aiCapabilityResult?.update) {
    await db.aiCapabilityResult.update({
      where: { key: markerKey(input) },
      data: { state: "VERIFIED", outputJson: JSON.stringify({ version: 1, taskId: task.id }) },
    });
  }
  if (input.idempotencyKey && db.aiEntityFingerprint?.create) {
    await db.aiEntityFingerprint.create({
      data: {
        entityType: TASK_CREATE_MARKER_TYPE,
        entityId: task.id,
        kind: IDEMPOTENCY_MARKER_KIND,
        fingerprint: idempotencyFingerprint(input),
        sourceUpdatedAt,
        staleAt: null,
        deletedAt: null,
      },
    });
  }
  if (input.recurrenceKey && db.aiEntityFingerprint?.create) {
    await db.aiEntityFingerprint.create({
      data: {
        entityType: "TASK",
        entityId: task.id,
        kind: RECURRENCE_MARKER_KIND,
        fingerprint: recurrenceFingerprint(input.recurrenceKey),
        sourceUpdatedAt,
        staleAt: null,
        deletedAt: null,
      },
    });
  }
}

export function attachDuplicateWarnings<T extends Record<string, unknown>>(task: T, guard: DuplicateGuardResult): T & { metadata?: Record<string, unknown> } {
  if (guard.decision !== "similar-warn" || !guard.similar?.length) return task;
  return {
    ...task,
    metadata: {
      ...((task as any).metadata ?? {}),
      duplicateWarnings: guard.similar,
    },
  };
}
