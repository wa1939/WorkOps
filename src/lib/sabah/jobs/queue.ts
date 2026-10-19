import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@prisma/client";
import { scanAndRedactSecrets } from "../security/secret-scan";
import { IMPLEMENTED_JOB_TYPES } from "./contracts";
import type { JobDb, JobPriority, JobType, LeaseContext, QueueDb, QueueJob, QueueJobAttempt, JsonValue } from "./contracts";

const MAX_JSON = 50_000;
const MAX_ID = 160;
const MAX_LEASE_SECONDS = 86_400;
export const MAX_QUEUE_ATTEMPTS = 100;
const MAX_LIMIT = 1_000;
const TERMINAL = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
const PRIORITY_NAMES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

type EnqueueInput = {
  type: JobType;
  idempotencyKey: string;
  priority: JobPriority;
  payload?: JsonValue;
  actorId?: string;
  workflowId?: string;
  stepId?: string;
  maxAttempts: number;
};

type PrismaJobRow = Prisma.AiJobGetPayload<{}>;
type PrismaAttemptRow = Prisma.AiJobAttemptGetPayload<{}>;

function boundedId(value: string | undefined, label: string, required = false): string | null {
  if (value === undefined && !required) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID || !/^[A-Za-z0-9:_./-]+$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function positiveFinite(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) throw new Error(`Invalid ${label}`);
}

function positiveInteger(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): void {
  positiveFinite(value, label, maximum);
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
}

function validNow(now: Date): Date {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("Invalid now");
  return now;
}

function encodedJson(value: JsonValue | undefined, label: string): string | null {
  if (value === undefined) return null;
  const encoded = JSON.stringify(scanAndRedactSecrets(value).value);
  if (encoded.length > MAX_JSON) throw new Error(`${label} exceeds bounds`);
  return encoded;
}

function encodedError(value: string): string {
  const encoded = JSON.stringify(scanAndRedactSecrets(value).value);
  if (encoded.length > MAX_JSON) throw new Error("error exceeds bounds");
  return encoded;
}

function newToken(): string { return crypto.randomBytes(24).toString("hex"); }

function mapJob(row: PrismaJobRow): QueueJob {
  return { ...row, priority: (PRIORITY_NAMES.indexOf(row.priority) + 1) as JobPriority };
}

function mapAttempt(row: PrismaAttemptRow): QueueJobAttempt { return row; }

function leaseContext(workerId: string, leaseToken: string, actorId?: string | null, workflowId?: string | null): LeaseContext {
  boundedId(workerId, "worker id", true);
  boundedId(leaseToken, "lease token", true);
  if (actorId !== undefined) boundedId(actorId ?? undefined, "actor id");
  if (workflowId !== undefined) boundedId(workflowId ?? undefined, "workflow id");
  return { workerId, leaseToken, actorId, workflowId };
}

function updateAttemptFor(status: QueueJobAttempt["status"], now: Date, patch: Partial<QueueJobAttempt> = {}): Partial<QueueJobAttempt> {
  return { status, ...(status === "LEASED" || status === "RUNNING" ? {} : { finishedAt: now }), ...patch };
}

export async function enqueueJob(db: JobDb = createPrismaJobDb(), input: EnqueueInput): Promise<QueueJob> {
  if (!(IMPLEMENTED_JOB_TYPES as readonly JobType[]).includes(input.type)) throw new Error(`No implemented handler for job type: ${input.type}`);
  const idempotencyKey = boundedId(input.idempotencyKey, "idempotency key", true)!;
  positiveInteger(input.maxAttempts, "maxAttempts", MAX_QUEUE_ATTEMPTS);
  if (!PRIORITY_NAMES[input.priority - 1]) throw new Error("Invalid priority");
  const actorId = boundedId(input.actorId, "actor id");
  const workflowId = boundedId(input.workflowId, "workflow id");
  const existing = await db.findJobByIdempotencyKey(idempotencyKey);
  if (existing) {
    if (existing.actorId !== actorId || existing.workflowId !== workflowId) throw new Error("Idempotency key belongs to another actor or workflow");
    return existing;
  }
  const inputRow = {
    type: input.type, status: "QUEUED" as const, priority: input.priority, idempotencyKey, actorId, workflowId,
    stepId: boundedId(input.stepId, "step id"), payloadJson: encodedJson(input.payload, "payload"), checkpointJson: null,
    leaseOwner: null, leaseToken: null, leaseUntil: null, heartbeatAt: null, retryCount: 0, maxAttempts: input.maxAttempts,
    nextAttemptAt: null, canceledAt: null, cancelRequestedAt: null, resultJson: null, errorJson: null,
  } satisfies Omit<QueueJob, "id" | "createdAt" | "updatedAt">;
  try {
    return await db.createJob(inputRow);
  } catch (error) {
    const raced = await db.findJobByIdempotencyKey(idempotencyKey);
    if (!raced) throw error;
    if (raced.actorId !== actorId || raced.workflowId !== workflowId) throw new Error("Idempotency key belongs to another actor or workflow");
    return raced;
  }
}

export async function leaseJobs(db: JobDb = createPrismaJobDb(), workerId: string, limit: number, leaseSeconds: number, now = new Date(), actorId?: string, workflowId?: string, jobId?: string): Promise<QueueJob[]> {
  boundedId(workerId, "worker id", true);
  positiveInteger(limit, "limit", MAX_LIMIT);
  positiveFinite(leaseSeconds, "leaseSeconds", MAX_LEASE_SECONDS);
  validNow(now);
  if (actorId !== undefined) boundedId(actorId, "actor id");
  if (workflowId !== undefined) boundedId(workflowId, "workflow id");
  if (jobId !== undefined) boundedId(jobId, "job id");
  return db.transaction(async (tx) => {
    const candidates = await tx.selectQueuedForLease(limit, now, actorId ?? undefined, workflowId ?? undefined, jobId ?? undefined);
    const result: QueueJob[] = [];
    for (const job of candidates) {
      const leaseToken = newToken();
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      const updated = await tx.updateJob(job.id, { status: "LEASED", leaseOwner: workerId, leaseToken, leaseUntil, heartbeatAt: now, retryCount: job.retryCount + 1, nextAttemptAt: null });
      await tx.createAttempt({ jobId: job.id, attemptNumber: updated.retryCount, workerId, leaseToken, leasedAt: now, startedAt: null, finishedAt: null, status: "LEASED", checkpointJson: null, resultJson: null, errorJson: null });
      result.push(updated);
    }
    return result;
  });
}

async function ownedMutation(db: JobDb, jobId: string, workerId: string, leaseToken: string, patch: Partial<QueueJob>, attemptPatch: Partial<QueueJobAttempt>, now: Date, actorId?: string, workflowId?: string): Promise<QueueJob> {
  validNow(now);
  boundedId(jobId, "job id", true);
  const context = leaseContext(workerId, leaseToken, actorId, workflowId);
  return db.transaction(async (tx) => {
    const updated = await tx.updateJobIfOwned(jobId, context, patch, now);
    const attempt = await tx.findAttempt(jobId, leaseToken);
    if (!attempt) throw new Error("attempt not found");
    await tx.updateAttempt(attempt.id, attemptPatch);
    return updated;
  });
}

export async function heartbeatJob(db: JobDb = createPrismaJobDb(), jobId: string, workerId: string, leaseToken: string, leaseSeconds = 30, now = new Date(), actorId?: string, workflowId?: string): Promise<QueueJob> {
  positiveFinite(leaseSeconds, "leaseSeconds", MAX_LEASE_SECONDS);
  validNow(now);
  return ownedMutation(db, jobId, workerId, leaseToken, { heartbeatAt: now, leaseUntil: new Date(now.getTime() + leaseSeconds * 1000) }, updateAttemptFor("RUNNING", now, { startedAt: now }), now, actorId, workflowId);
}

export async function checkpointJob(db: JobDb = createPrismaJobDb(), jobId: string, workerId: string, leaseToken: string, checkpoint: JsonValue, now = new Date(), actorId?: string, workflowId?: string): Promise<QueueJob> {
  const checkpointJson = encodedJson(checkpoint, "checkpoint");
  return ownedMutation(db, jobId, workerId, leaseToken, { checkpointJson }, updateAttemptFor("RUNNING", now, { checkpointJson }), now, actorId, workflowId);
}

export async function completeJob(db: JobDb = createPrismaJobDb(), jobId: string, workerId: string, leaseToken: string, result: JsonValue, now = new Date(), actorId?: string, workflowId?: string): Promise<QueueJob> {
  const resultJson = encodedJson(result, "result");
  return ownedMutation(db, jobId, workerId, leaseToken, { status: "SUCCEEDED", resultJson, leaseOwner: null, leaseToken: null, leaseUntil: null }, updateAttemptFor("SUCCEEDED", now, { resultJson }), now, actorId, workflowId);
}

export async function failJob(db: JobDb = createPrismaJobDb(), jobId: string, workerId: string, leaseToken: string, error: string, retryable: boolean, now = new Date(), actorId?: string, workflowId?: string): Promise<QueueJob> {
  validNow(now);
  if (typeof error !== "string" || error.length === 0) throw new Error("Invalid error");
  boundedId(jobId, "job id", true);
  const errorJson = encodedError(error);
  const baseContext = leaseContext(workerId, leaseToken, actorId, workflowId);
  return db.transaction(async (tx) => {
    const job = await tx.findJob(jobId);
    if (!job) throw new Error("job not found");
    const attempt = await tx.findAttempt(jobId, leaseToken);
    if (!attempt) throw new Error("attempt not found");
    const shouldRetry = retryable && job.retryCount < job.maxAttempts;
    const jitter = parseInt(crypto.createHash("sha256").update(job.id).digest("hex").slice(0, 4), 16) % 1000;
    const delay = Math.min(3_600_000, 1_000 * 2 ** Math.min(20, job.retryCount) + jitter);
    try {
      const updated = await tx.updateJobIfOwned(jobId, { ...baseContext, requireNoCancellation: true }, { status: shouldRetry ? "RETRY_WAIT" : "FAILED", errorJson, nextAttemptAt: shouldRetry ? new Date(now.getTime() + delay) : null, leaseOwner: null, leaseToken: null, leaseUntil: null }, now);
      await tx.updateAttempt(attempt.id, updateAttemptFor("FAILED", now, { errorJson }));
      return updated;
    } catch (mutationError) {
      const current = await tx.findJob(jobId);
      if (!current?.cancelRequestedAt) throw mutationError;
      const canceled = await tx.updateJobIfOwned(jobId, baseContext, { status: "CANCELED", canceledAt: now, leaseOwner: null, leaseToken: null, leaseUntil: null }, now);
      await tx.updateAttempt(attempt.id, updateAttemptFor("CANCELED", now));
      return canceled;
    }
  });
}

// Returns an unstarted lease to the queue without consuming the retry
// allowance — used when a worker runs out of tick budget before the handler
// ever ran. The never-started attempt row is deleted so the refunded attempt
// number stays free under the unique (jobId, attemptNumber) constraint.
export async function releaseJob(db: JobDb = createPrismaJobDb(), jobId: string, workerId: string, leaseToken: string, now = new Date(), actorId?: string, workflowId?: string): Promise<QueueJob> {
  validNow(now);
  boundedId(jobId, "job id", true);
  const context = leaseContext(workerId, leaseToken, actorId, workflowId);
  return db.transaction(async (tx) => {
    const job = await tx.findJob(jobId);
    if (!job) throw new Error("job not found");
    const attempt = await tx.findAttempt(jobId, leaseToken);
    const updated = await tx.updateJobIfOwned(jobId, context, { status: "QUEUED", leaseOwner: null, leaseToken: null, leaseUntil: null, heartbeatAt: null, retryCount: Math.max(0, job.retryCount - 1) }, now);
    if (attempt) await tx.deleteAttempt(attempt.id);
    return updated;
  });
}

export async function cancelJob(db: JobDb = createPrismaJobDb(), jobId: string, now = new Date()): Promise<QueueJob> {
  boundedId(jobId, "job id", true);
  validNow(now);
  return db.transaction(async (tx) => {
    const job = await tx.findJob(jobId);
    if (!job) throw new Error("job not found");
    if (TERMINAL.has(job.status)) throw new Error("Terminal jobs are immutable");
    const active = job.status === "LEASED" || job.status === "RUNNING";
    const updated = await tx.updateJobIfStatus(jobId, job.status, active ? { cancelRequestedAt: now } : { status: "CANCELED", canceledAt: now });
    if (!active && job.leaseToken) {
      const attempt = await tx.findAttempt(jobId, job.leaseToken);
      if (attempt) await tx.updateAttempt(attempt.id, updateAttemptFor("CANCELED", now));
    }
    return updated;
  });
}

export async function requeueExpiredLeases(db: JobDb = createPrismaJobDb(), now = new Date()): Promise<QueueJob[]> {
  validNow(now);
  return db.transaction(async (tx) => {
    const expired = await tx.findExpiredLeases(now);
    const result: QueueJob[] = [];
    for (const job of expired) {
      if (!job.leaseOwner || !job.leaseToken) continue;
      const attempt = await tx.findAttempt(job.id, job.leaseToken);
      const canceled = job.cancelRequestedAt !== null;
      // A lease that expired on the final allowed attempt is exhausted; keep
      // the maxAttempts bound instead of requeueing a crashing job forever.
      const exhausted = !canceled && job.retryCount >= job.maxAttempts;
      const status = canceled ? "CANCELED" : exhausted ? "FAILED" : "QUEUED";
      const updated = await tx.updateExpiredJobIfOwned(job.id, { workerId: job.leaseOwner, leaseToken: job.leaseToken }, now, { status, canceledAt: canceled ? now : null, leaseOwner: null, leaseToken: null, leaseUntil: null, heartbeatAt: null, ...(exhausted ? { nextAttemptAt: null, errorJson: encodedError("lease expired after final allowed attempt") } : {}) });
      if (attempt) await tx.updateAttempt(attempt.id, updateAttemptFor(canceled ? "CANCELED" : "FAILED", now));
      result.push(updated);
    }
    return result;
  });
}

function toPrismaData(patch: Partial<QueueJob>): Prisma.AiJobUncheckedUpdateManyInput {
  const data: Prisma.AiJobUncheckedUpdateManyInput = {};
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.status !== undefined) data.status = patch.status;
  if (patch.priority !== undefined) data.priority = PRIORITY_NAMES[patch.priority - 1];
  if (patch.actorId !== undefined) data.actorId = patch.actorId;
  if (patch.workflowId !== undefined) data.workflowId = patch.workflowId;
  if (patch.stepId !== undefined) data.stepId = patch.stepId;
  if (patch.payloadJson !== undefined) data.payloadJson = patch.payloadJson;
  if (patch.checkpointJson !== undefined) data.checkpointJson = patch.checkpointJson;
  if (patch.leaseOwner !== undefined) data.leaseOwner = patch.leaseOwner;
  if (patch.leaseToken !== undefined) data.leaseToken = patch.leaseToken;
  if (patch.leaseUntil !== undefined) data.leaseUntil = patch.leaseUntil;
  if (patch.heartbeatAt !== undefined) data.heartbeatAt = patch.heartbeatAt;
  if (patch.retryCount !== undefined) data.retryCount = patch.retryCount;
  if (patch.maxAttempts !== undefined) data.maxAttempts = patch.maxAttempts;
  if (patch.nextAttemptAt !== undefined) data.nextAttemptAt = patch.nextAttemptAt;
  if (patch.canceledAt !== undefined) data.canceledAt = patch.canceledAt;
  if (patch.cancelRequestedAt !== undefined) data.cancelRequestedAt = patch.cancelRequestedAt;
  if (patch.resultJson !== undefined) data.resultJson = patch.resultJson;
  if (patch.errorJson !== undefined) data.errorJson = patch.errorJson;
  return data;
}

export function createPrismaJobDb(client: QueueDb = prisma): JobDb {
  const db: JobDb = {
    async transaction<T>(fn: (db: JobDb) => Promise<T>) {
      if (!client.$transaction) throw new Error("Transaction unavailable");
      return client.$transaction(async (tx) => fn(createPrismaJobDb(tx)));
    },
    async findJobByIdempotencyKey(key) { const row = await client.aiJob.findUnique({ where: { idempotencyKey: key } }); return row ? mapJob(row) : null; },
    async createJob(input) { const row = await client.aiJob.create({ data: { type: input.type, status: input.status, priority: PRIORITY_NAMES[input.priority - 1], idempotencyKey: input.idempotencyKey, actorId: input.actorId, workflowId: input.workflowId, stepId: input.stepId, payloadJson: input.payloadJson, checkpointJson: input.checkpointJson, maxAttempts: input.maxAttempts, cancelRequestedAt: input.cancelRequestedAt } }); return mapJob(row); },
    async selectQueuedForLease(limit, now, actorId, workflowId, jobId) {
      const rows = await client.$queryRaw<PrismaJobRow[]>`SELECT * FROM "AiJob" WHERE status IN ('QUEUED','RETRY_WAIT') AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now}) AND (${actorId ?? null}::text IS NULL OR "actorId" = ${actorId ?? null}) AND (${workflowId ?? null}::text IS NULL OR "workflowId" = ${workflowId ?? null}) AND (${jobId ?? null}::text IS NULL OR "id" = ${jobId ?? null}) ORDER BY CASE priority WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC, "nextAttemptAt" ASC NULLS FIRST, "createdAt" ASC LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
      return rows.map(mapJob);
    },
    async updateJob(id, patch) { const row = await client.aiJob.update({ where: { id }, data: toPrismaData(patch) }); return mapJob(row); },
    async updateJobIfStatus(id, expectedStatus, patch) {
      const count = await client.aiJob.updateMany({ where: { id, status: expectedStatus }, data: toPrismaData(patch) });
      if (count.count !== 1) throw new Error("Job status changed during cancellation");
      const row = await client.aiJob.findUnique({ where: { id } });
      if (!row) throw new Error("job not found");
      return mapJob(row);
    },
    async updateJobIfOwned(id, context, patch, now) {
      const count = await client.aiJob.updateMany({ where: { id, leaseOwner: context.workerId, leaseToken: context.leaseToken, status: { in: ["LEASED", "RUNNING"] }, leaseUntil: { gt: now }, ...(context.actorId === undefined ? {} : { actorId: context.actorId }), ...(context.workflowId === undefined ? {} : { workflowId: context.workflowId }), ...(context.requireNoCancellation ? { cancelRequestedAt: null } : {}) }, data: toPrismaData(patch) });
      if (count.count !== 1) throw new Error("Lease ownership is invalid or expired");
      const row = await client.aiJob.findUnique({ where: { id } });
      if (!row) throw new Error("job not found");
      return mapJob(row);
    },
    async updateExpiredJobIfOwned(id, context, now, patch) {
      const count = await client.aiJob.updateMany({ where: { id, leaseOwner: context.workerId, leaseToken: context.leaseToken, status: { in: ["LEASED", "RUNNING"] }, leaseUntil: { lte: now } }, data: toPrismaData(patch) });
      if (count.count !== 1) throw new Error("Expired lease ownership is invalid");
      const row = await client.aiJob.findUnique({ where: { id } });
      if (!row) throw new Error("job not found");
      return mapJob(row);
    },
    async createAttempt(input) { return mapAttempt(await client.aiJobAttempt.create({ data: input })); },
    async updateAttempt(id, patch) { return mapAttempt(await client.aiJobAttempt.update({ where: { id }, data: patch })); },
    async findAttempt(jobId, leaseToken) { const row = await client.aiJobAttempt.findFirst({ where: { jobId, leaseToken } }); return row ? mapAttempt(row) : null; },
    async deleteAttempt(id) { await client.aiJobAttempt.delete({ where: { id } }); },
    async findJob(id) { const row = await client.aiJob.findUnique({ where: { id } }); return row ? mapJob(row) : null; },
    async findExpiredLeases(now) { const rows = await client.aiJob.findMany({ where: { status: { in: ["LEASED", "RUNNING"] }, leaseUntil: { lte: now } } }); return rows.map(mapJob); },
  };
  return db;
}
