import type { PrismaClient } from "@prisma/client";

export const JOB_TYPES = ["WORKFLOW_STEP", "COMPRESSION", "INDEX_ENTITY", "MONITOR", "CONNECTOR_DELIVERY", "SPECIALIST_ANALYSIS", "EXTRACTION"] as const;
export type JobType = (typeof JOB_TYPES)[number];
// Types with a registered production handler; enqueueJob refuses the rest so
// unimplemented types (MONITOR, CONNECTOR_DELIVERY, SPECIALIST_ANALYSIS)
// cannot enter the queue and dead-letter on every cron tick.
export const IMPLEMENTED_JOB_TYPES = ["WORKFLOW_STEP", "COMPRESSION", "INDEX_ENTITY", "EXTRACTION"] as const satisfies readonly JobType[];
export const JOB_STATUSES = ["QUEUED", "LEASED", "RUNNING", "WAITING_APPROVAL", "RETRY_WAIT", "SUCCEEDED", "FAILED", "CANCELED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobPriority = 1 | 2 | 3 | 4;
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type LeaseContext = { workerId: string; leaseToken: string; actorId?: string | null; workflowId?: string | null; requireNoCancellation?: boolean };
export type QueueJob = { id: string; type: JobType; status: JobStatus; priority: JobPriority; idempotencyKey: string; actorId: string | null; workflowId: string | null; stepId: string | null; payloadJson: string | null; checkpointJson: string | null; leaseOwner: string | null; leaseToken: string | null; leaseUntil: Date | null; heartbeatAt: Date | null; retryCount: number; maxAttempts: number; nextAttemptAt: Date | null; canceledAt: Date | null; cancelRequestedAt: Date | null; resultJson: string | null; errorJson: string | null; createdAt: Date; updatedAt: Date };
export type QueueJobAttempt = { id: string; jobId: string; attemptNumber: number; workerId: string | null; leaseToken: string | null; leasedAt: Date | null; startedAt: Date | null; finishedAt: Date | null; status: "LEASED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED"; checkpointJson: string | null; resultJson: string | null; errorJson: string | null; createdAt: Date };
export type JobDb = {
  transaction<T>(fn: (db: JobDb) => Promise<T>): Promise<T>;
  findJobByIdempotencyKey(key: string): Promise<QueueJob | null>;
  createJob(input: Omit<QueueJob, "id" | "createdAt" | "updatedAt">): Promise<QueueJob>;
  selectQueuedForLease(limit: number, now: Date, actorId?: string | null, workflowId?: string | null, jobId?: string | null): Promise<QueueJob[]>;
  updateJob(id: string, patch: Partial<QueueJob>): Promise<QueueJob>;
  updateJobIfStatus(id: string, expectedStatus: JobStatus, patch: Partial<QueueJob>): Promise<QueueJob>;
  updateJobIfOwned(id: string, context: LeaseContext, patch: Partial<QueueJob>, now: Date): Promise<QueueJob>;
  updateExpiredJobIfOwned(id: string, context: LeaseContext, now: Date, patch: Partial<QueueJob>): Promise<QueueJob>;
  createAttempt(input: Omit<QueueJobAttempt, "id" | "createdAt">): Promise<QueueJobAttempt>;
  updateAttempt(id: string, patch: Partial<QueueJobAttempt>): Promise<QueueJobAttempt>;
  findAttempt(jobId: string, token: string): Promise<QueueJobAttempt | null>;
  deleteAttempt(id: string): Promise<void>;
  findJob(id: string): Promise<QueueJob | null>;
  findExpiredLeases(now: Date): Promise<QueueJob[]>;
};
export type QueueDb = Pick<PrismaClient, "aiJob" | "aiJobAttempt" | "$queryRaw"> & Partial<Pick<PrismaClient, "$transaction">>;
