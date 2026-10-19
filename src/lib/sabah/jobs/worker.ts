import type { JobDb, JsonValue, QueueJob, QueueJobAttempt } from "./contracts";
import { checkpointJob, completeJob, failJob, heartbeatJob, leaseJobs, releaseJob } from "./queue";
import { defaultJobHandlerRegistry, type JobHandlerContext, type JobHandlerRegistry } from "./handlers";

const DEFAULT_BUDGET = 45_000;
const MAX_BUDGET = 300_000;
const MAX_OUTPUT = 48_000;
const MAX_ERROR = 512;
const LEASE_SECONDS = 60;
export type ProcessJobTickOptions = { db: JobDb; workerId: string; limit?: number; budgetMs?: number; heartbeatSafetyMs?: number; heartbeatIntervalMs?: number; jobId?: string; actorId?: string; workflowId?: string; clock?: () => Date; signal?: AbortSignal; handlers?: JobHandlerRegistry; circuitBreaker?: number };
export type ProcessJobTickResult = { leased: number; completed: number; failed: number; canceled: number; skipped: number };
function boundedBudget(value: number | undefined): number { const budget = value ?? DEFAULT_BUDGET; if (!Number.isFinite(budget) || budget <= 0 || budget > MAX_BUDGET) throw new Error("Invalid budgetMs"); return budget; }
function safeJson(value: unknown): JsonValue { const encoded = JSON.stringify(value); if (encoded === undefined || encoded.length > MAX_OUTPUT) throw new Error("handler result exceeds bounds"); return JSON.parse(encoded) as JsonValue; }
function redactedError(error: unknown): string { const text = error instanceof Error ? error.message : "job failed"; return text.replace(/[\u0000-\u001f\u007f]/g, "_").replace(/(secret|token|password|key)[^\s]*/gi, "$1=[REDACTED]").slice(0, MAX_ERROR) || "job failed"; }
function canceled(job: QueueJob, signal: AbortSignal): boolean { return signal.aborted || job.cancelRequestedAt !== null || job.canceledAt !== null; }
function permanent(error: unknown): boolean { return error instanceof Error && (error.name === "PermanentJobError" || /malformed|unknown job type|unavailable|invalid|canceled|payload|EXTRACTION_STORAGE_UNAVAILABLE/i.test(error.message)); }
function permanentError(message: string): Error { const error = new Error(message); error.name = "PermanentJobError"; return error; }
function parseJson<T>(value: string, label: string): T { try { return JSON.parse(value) as T; } catch { throw permanentError(`malformed ${label} JSON`); } }
function linkedAbortController(parent: AbortSignal): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  if (parent.aborted) abort(); else parent.addEventListener("abort", abort, { once: true });
  return { controller, dispose: () => parent.removeEventListener("abort", abort) };
}
async function leaseOrResume(options: ProcessJobTickOptions, now: Date, result: ProcessJobTickResult): Promise<QueueJob[]> {
  const jobs = await leaseJobs(options.db, options.workerId, Math.min(100, Math.max(1, options.limit ?? 10)), LEASE_SECONDS, now, options.actorId, options.workflowId, options.jobId);
  result.leased = jobs.length;
  if (jobs.length > 0 || !options.jobId) return jobs;
  const existing = await options.db.findJob(options.jobId);
  const actorMatches = options.actorId === undefined || existing?.actorId === options.actorId;
  const workflowMatches = options.workflowId === undefined || existing?.workflowId === options.workflowId;
  if (!existing || (existing.status !== "LEASED" && existing.status !== "RUNNING") || existing.leaseOwner !== options.workerId || !existing.leaseToken || !existing.leaseUntil || existing.leaseUntil.getTime() <= now.getTime() || !actorMatches || !workflowMatches) return [];
  return [existing];
}
async function finalizeCanceledJob(db: JobDb, job: QueueJob, workerId: string, token: string, now: Date, actorId?: string, workflowId?: string): Promise<void> { await db.transaction(async (tx) => { const updated = await tx.updateJobIfOwned(job.id, { workerId, leaseToken: token, actorId, workflowId }, { status: "CANCELED", canceledAt: now, leaseOwner: null, leaseToken: null, leaseUntil: null }, now); const attempt = await tx.findAttempt(updated.id, token); if (attempt) await tx.updateAttempt(attempt.id, { status: "CANCELED", finishedAt: now }); }); }
export async function processJobTick(options: ProcessJobTickOptions): Promise<ProcessJobTickResult> {
  const clock = options.clock ?? (() => new Date()); const started = clock().getTime(); const budget = boundedBudget(options.budgetMs); const safety = Math.max(1_000, options.heartbeatSafetyMs ?? 5_000); const interval = options.heartbeatIntervalMs ?? Math.min(15_000, Math.max(1_000, Math.floor(LEASE_SECONDS * 1000 / 3))); if (!Number.isFinite(interval) || interval < 250 || interval >= LEASE_SECONDS * 1000) throw new Error("Invalid heartbeatIntervalMs"); const result: ProcessJobTickResult = { leased: 0, completed: 0, failed: 0, canceled: 0, skipped: 0 };
  if (budget <= safety || budget - safety < interval) return result;
  const remaining = () => budget - (clock().getTime() - started); const now = () => clock();
  const jobs = await leaseOrResume(options, now(), result);
  const failures = new Map<string, number>(); const signal = options.signal ?? new AbortController().signal; const registry = options.handlers ?? defaultJobHandlerRegistry;
  for (const leased of jobs) {
    const token = leased.leaseToken; if (!token) { result.skipped++; continue; }
    // Out of tick budget before this handler ran: release the lease so the
    // next tick picks the job up again instead of terminally failing it.
    if (remaining() <= safety) { try { await releaseJob(options.db, leased.id, options.workerId, token, now(), options.actorId, options.workflowId); } catch { /* ownership may be gone */ } result.skipped++; continue; }
    const { controller, dispose } = linkedAbortController(signal);
    let heartbeatFailure: unknown;
    let heartbeatFailed = false;
    try {
      const live = await options.db.findJob(leased.id); if (!live || canceled(live, signal)) { await finalizeCanceledJob(options.db, leased, options.workerId, token, now(), options.actorId, options.workflowId); result.canceled++; continue; }
      const prior = failures.get(leased.type) ?? 0; if (prior >= (options.circuitBreaker ?? 3)) { await failJob(options.db, leased.id, options.workerId, token, "circuit breaker open", false, now(), options.actorId, options.workflowId); result.skipped++; continue; }
      await heartbeatJob(options.db, leased.id, options.workerId, token, LEASE_SECONDS, now(), options.actorId, options.workflowId);
      const checkpoint = leased.checkpointJson ? parseJson<JsonValue>(leased.checkpointJson, "checkpoint") : undefined;
      const heartbeat = async () => { const current = await options.db.findJob(leased.id); if (!current || canceled(current, controller.signal)) { controller.abort(); return; } await heartbeatJob(options.db, leased.id, options.workerId, token, LEASE_SECONDS, now(), options.actorId, options.workflowId); };
      const context: JobHandlerContext = { jobId: leased.id, actorId: leased.actorId, workflowId: leased.workflowId, stepId: leased.stepId, signal: controller.signal, checkpoint, heartbeat, saveCheckpoint: async (value) => { controller.signal.throwIfAborted(); safeJson(value); await checkpointJob(options.db, leased.id, options.workerId, token, value, now(), options.actorId, options.workflowId); } };
      let heartbeatInFlight: Promise<void> | null = null;
      const runScheduledHeartbeat = () => {
        if (heartbeatInFlight) return;
        const pending = heartbeat()
          .catch((error) => { heartbeatFailed = true; heartbeatFailure = error; controller.abort(error); })
          .finally(() => { if (heartbeatInFlight === pending) heartbeatInFlight = null; });
        heartbeatInFlight = pending;
      };
      const timer = setInterval(runScheduledHeartbeat, interval);
      try { const payload = leased.payloadJson ? parseJson<unknown>(leased.payloadJson, "payload") : null; const output = await registry.get(leased.type)(payload, context); clearInterval(timer); await heartbeatInFlight; if (heartbeatFailed) throw heartbeatFailure; const current = await options.db.findJob(leased.id); if (!current || canceled(current, controller.signal)) { await finalizeCanceledJob(options.db, leased, options.workerId, token, now(), options.actorId, options.workflowId); result.canceled++; continue; } await completeJob(options.db, leased.id, options.workerId, token, safeJson(output.result), now(), options.actorId, options.workflowId); result.completed++; } finally { clearInterval(timer); await heartbeatInFlight; }
    } catch (error) { try { const current = await options.db.findJob(leased.id); if (current && canceled(current, signal)) { await finalizeCanceledJob(options.db, leased, options.workerId, token, now(), options.actorId, options.workflowId); result.canceled++; continue; } const failed = await failJob(options.db, leased.id, options.workerId, token, redactedError(error), heartbeatFailed || !permanent(error), now(), options.actorId, options.workflowId); if (failed.status === "CANCELED") { result.canceled++; continue; } failures.set(leased.type, (failures.get(leased.type) ?? 0) + 1); result.failed++; } catch { /* lease may have expired */ result.failed++; } }
    finally { dispose(); }
  }
  return result;
}
