import { describe, expect, it } from "vitest";
import { cancelJob, checkpointJob, completeJob, enqueueJob, failJob, heartbeatJob, leaseJobs, releaseJob, requeueExpiredLeases } from "./queue";
import type { JobDb, QueueJob, QueueJobAttempt, LeaseContext } from "./contracts";

class FakeDb implements JobDb {
  jobs: QueueJob[] = [];
  attempts: QueueJobAttempt[] = [];
  private sequence = 0;
  private transactionTail: Promise<void> = Promise.resolve();
  hideNextIdempotencyLookup = false;
  async transaction<T>(fn: (db: JobDb) => Promise<T>): Promise<T> {
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await fn(this); } finally { release(); }
  }
  async findJobByIdempotencyKey(key: string) { if (this.hideNextIdempotencyLookup) { this.hideNextIdempotencyLookup = false; return null; } return this.jobs.find((job) => job.idempotencyKey === key) ?? null; }
  async createJob(input: Omit<QueueJob, "id" | "createdAt" | "updatedAt">) {
    if (this.jobs.some((job) => job.idempotencyKey === input.idempotencyKey)) throw new Error("Unique constraint failed");
    const now = new Date();
    const job = { ...input, id: `job-${++this.sequence}`, createdAt: now, updatedAt: now };
    this.jobs.push(job);
    return job;
  }
  async selectQueuedForLease(limit: number, now: Date, actorId?: string | null, workflowId?: string | null) {
    return this.jobs.filter((job) => (job.status === "QUEUED" || job.status === "RETRY_WAIT") && (!job.nextAttemptAt || job.nextAttemptAt <= now) && (actorId === undefined || job.actorId === actorId) && (workflowId === undefined || job.workflowId === workflowId)).sort((a, b) => b.priority - a.priority || (a.nextAttemptAt?.getTime() ?? 0) - (b.nextAttemptAt?.getTime() ?? 0) || a.createdAt.getTime() - b.createdAt.getTime()).slice(0, limit);
  }
  async updateJob(id: string, patch: Partial<QueueJob>) { return this.apply(id, patch); }
  async updateJobIfStatus(id: string, expectedStatus: QueueJob["status"], patch: Partial<QueueJob>) {
    const job = this.jobs.find((row) => row.id === id);
    if (!job || job.status !== expectedStatus) throw new Error("Job status changed during cancellation");
    return this.apply(id, patch);
  }
  async updateJobIfOwned(id: string, context: LeaseContext, patch: Partial<QueueJob>, now: Date) {
    const job = this.jobs.find((row) => row.id === id);
    if (!job || job.leaseOwner !== context.workerId || job.leaseToken !== context.leaseToken || !job.leaseUntil || job.leaseUntil <= now || (context.actorId !== undefined && job.actorId !== context.actorId) || (context.workflowId !== undefined && job.workflowId !== context.workflowId) || (context.requireNoCancellation && job.cancelRequestedAt)) throw new Error("Lease ownership is invalid or expired");
    return this.apply(id, patch);
  }
  async updateExpiredJobIfOwned(id: string, context: LeaseContext, now: Date, patch: Partial<QueueJob>) {
    const job = this.jobs.find((row) => row.id === id);
    if (!job || job.leaseOwner !== context.workerId || job.leaseToken !== context.leaseToken || !job.leaseUntil || job.leaseUntil > now) throw new Error("Expired lease ownership is invalid");
    return this.apply(id, patch);
  }
  private async apply(id: string, patch: Partial<QueueJob>) { const job = this.jobs.find((row) => row.id === id); if (!job) throw new Error("job not found"); Object.assign(job, patch, { updatedAt: new Date() }); return job; }
  async createAttempt(input: Omit<QueueJobAttempt, "id" | "createdAt">) { if (this.attempts.some((row) => row.jobId === input.jobId && row.attemptNumber === input.attemptNumber)) throw new Error("Unique constraint failed on (jobId, attemptNumber)"); const attempt = { ...input, id: `attempt-${++this.sequence}`, createdAt: new Date() }; this.attempts.push(attempt); return attempt; }
  async deleteAttempt(id: string) { const index = this.attempts.findIndex((row) => row.id === id); if (index >= 0) this.attempts.splice(index, 1); }
  async updateAttempt(id: string, patch: Partial<QueueJobAttempt>) { const attempt = this.attempts.find((row) => row.id === id); if (!attempt) throw new Error("attempt not found"); Object.assign(attempt, patch); return attempt; }
  async findAttempt(jobId: string, token: string) { return this.attempts.find((attempt) => attempt.jobId === jobId && attempt.leaseToken === token) ?? null; }
  async findJob(id: string) { return this.jobs.find((job) => job.id === id) ?? null; }
  async findExpiredLeases(now: Date) { return this.jobs.filter((job) => (job.status === "LEASED" || job.status === "RUNNING") && job.leaseUntil !== null && job.leaseUntil <= now); }
}

const input = (key: string, priority = 2, actorId = "actor-1", workflowId = "flow-1") => ({ type: "COMPRESSION" as const, idempotencyKey: key, priority: priority as 1 | 2 | 3 | 4, payload: { source: "safe" }, actorId, workflowId, stepId: "step-1", maxAttempts: 3 });

describe("typed durable job queue", () => {
  it("rejects enqueueing job types that have no implemented handler", async () => {
    const db = new FakeDb();
    await expect(enqueueJob(db, { ...input("monitor"), type: "MONITOR" as never })).rejects.toThrow(/no implemented handler/i);
    await expect(enqueueJob(db, { ...input("connector"), type: "CONNECTOR_DELIVERY" as never })).rejects.toThrow(/no implemented handler/i);
    await expect(enqueueJob(db, { ...input("specialist"), type: "SPECIALIST_ANALYSIS" as never })).rejects.toThrow(/no implemented handler/i);
    expect(db.jobs).toHaveLength(0);
  });
  it("recovers a concurrent idempotency conflict and rejects isolation mismatch", async () => { const db = new FakeDb(); const first = await enqueueJob(db, input("same")); db.hideNextIdempotencyLookup = true; expect((await enqueueJob(db, input("same"))).id).toBe(first.id); await expect(enqueueJob(db, input("same", 2, "other"))).rejects.toThrow(); });
  it("leases queued and due retry jobs in numeric priority order", async () => { const db = new FakeDb(); const low = await enqueueJob(db, input("low", 1)); const high = await enqueueJob(db, input("high", 4)); const first = (await leaseJobs(db, "worker", 2, 30, new Date("2026-01-01T00:00:00Z"))); expect(first.map((job) => job.id)).toEqual([high.id, low.id]); const retried = await failJob(db, low.id, "worker", first[1].leaseToken!, "temporary", true, new Date("2026-01-01T00:00:00Z")); const second = (await leaseJobs(db, "worker-2", 1, 30, new Date(retried.nextAttemptAt!.getTime() + 1)))[0]; expect(second.retryCount).toBe(2); expect(db.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 1, 2]); });
  it("updates attempt state and rejects stale tokens", async () => { const db = new FakeDb(); const job = await enqueueJob(db, input("attempt")); const leased = (await leaseJobs(db, "worker", 1, 30))[0]; await heartbeatJob(db, job.id, "worker", leased.leaseToken!, 30); await checkpointJob(db, job.id, "worker", leased.leaseToken!, { n: 1 }); await completeJob(db, job.id, "worker", leased.leaseToken!, { ok: true }); expect(db.attempts[0].status).toBe("SUCCEEDED"); await expect(checkpointJob(db, job.id, "worker", leased.leaseToken!, { n: 2 })).rejects.toThrow(); });
  it("persists active cancellation and recovers it as canceled", async () => { const db = new FakeDb(); const job = await enqueueJob(db, input("cancel")); const leased = (await leaseJobs(db, "worker", 1, 1, new Date("2026-01-01T00:00:00Z")))[0]; const marked = await cancelJob(db, job.id, new Date("2026-01-01T00:00:00Z")); expect(marked.cancelRequestedAt).toBeInstanceOf(Date); const recovered = (await requeueExpiredLeases(db, new Date("2026-01-01T00:01:00Z")))[0]; expect(recovered.status).toBe("CANCELED"); expect(recovered.leaseOwner).toBeNull(); expect(recovered.leaseToken).toBeNull(); expect(recovered.leaseUntil).toBeNull(); expect(db.attempts[0].status).toBe("CANCELED"); expect(db.attempts[0].leaseToken).toBeTruthy(); });
  it("cancels queued work and enforces bounds", async () => { const db = new FakeDb(); const queued = await enqueueJob(db, input("queued")); expect((await cancelJob(db, queued.id)).status).toBe("CANCELED"); await expect(enqueueJob(db, { ...input("bad"), payload: "x".repeat(50001) })).rejects.toThrow(); await expect(enqueueJob(db, { ...input("too-many"), maxAttempts: 101 })).rejects.toThrow(/maxAttempts/); await expect(leaseJobs(db, "", 1, 1)).rejects.toThrow(); await expect(leaseJobs(db, "worker", 1, Number.NaN)).rejects.toThrow(); await expect(heartbeatJob(db, "", "worker", "token", 1)).rejects.toThrow(); });
  it("cancels waiting approval and retry wait states without leaving leases", async () => { const db = new FakeDb(); const waiting = await enqueueJob(db, input("waiting")); await db.updateJob(waiting.id, { status: "WAITING_APPROVAL" }); expect((await cancelJob(db, waiting.id)).status).toBe("CANCELED"); const retry = await enqueueJob(db, input("retry-state")); await db.updateJob(retry.id, { status: "RETRY_WAIT", nextAttemptAt: new Date(0) }); const canceled = await cancelJob(db, retry.id); expect(canceled.status).toBe("CANCELED"); expect(canceled.leaseOwner).toBeNull(); expect(canceled.leaseToken).toBeNull(); });
  it("fails the final allowed attempt without retrying", async () => { const db = new FakeDb(); const now = new Date("2026-01-01T00:00:00Z"); const job = await enqueueJob(db, { ...input("final"), maxAttempts: 1 }); const leased = (await leaseJobs(db, "worker", 1, 30, now))[0]; const failed = await failJob(db, job.id, "worker", leased.leaseToken!, "permanent", true, now); expect(failed.status).toBe("FAILED"); expect(failed.nextAttemptAt).toBeNull(); expect(db.attempts[0].status).toBe("FAILED"); });
  it("keeps concurrent cancellation and leasing from producing canceled leased work", async () => { const run = async (first: "cancel" | "lease") => { const db = new FakeDb(); const job = await enqueueJob(db, input(`race-${first}`)); const operation = (kind: "cancel" | "lease") => kind === "cancel" ? cancelJob(db, job.id, new Date("2026-01-01T00:00:00Z")) : leaseJobs(db, "worker", 1, 30, new Date("2026-01-01T00:00:00Z")); await Promise.allSettled(first === "cancel" ? [operation("cancel"), operation("lease")] : [operation("lease"), operation("cancel")]); return (await db.findJob(job.id))!; }; const canceled = await run("cancel"); expect(canceled.status).toBe("CANCELED"); expect(canceled.leaseOwner).toBeNull(); expect(canceled.leaseToken).toBeNull(); expect(canceled.leaseUntil).toBeNull(); const leased = await run("lease"); expect(leased.status).toBe("LEASED"); expect(leased.leaseOwner).toBe("worker"); expect(leased.leaseToken).toEqual(expect.any(String)); expect(leased.leaseUntil).toBeInstanceOf(Date); expect(leased.cancelRequestedAt).toBeInstanceOf(Date); });
  it("keeps retry backoff deterministic and exercises the cap", async () => { const run = async () => { const db = new FakeDb(); const now = new Date("2026-01-01T00:00:00Z"); const job = await enqueueJob(db, input("backoff")); const leased = (await leaseJobs(db, "worker", 1, 30, now))[0]; const failed = await failJob(db, job.id, "worker", leased.leaseToken!, "temporary", true, now); return failed.nextAttemptAt!.getTime() - now.getTime(); }; expect(await run()).toBe(2_618); expect(await run()).toBe(2_618); const cappedDb = new FakeDb(); const cappedNow = new Date("2026-01-01T00:00:00Z"); const cappedJob = await enqueueJob(cappedDb, { ...input("capped"), maxAttempts: 100 }); cappedJob.retryCount = 20; const cappedLease = (await leaseJobs(cappedDb, "worker", 1, 30, cappedNow))[0]; const capped = await failJob(cappedDb, cappedJob.id, "worker", cappedLease.leaseToken!, "temporary", true, cappedNow); expect(capped.nextAttemptAt!.getTime() - cappedNow.getTime()).toBe(3_600_000); });
  it("fails exhausted jobs during expired-lease recovery instead of requeueing forever", async () => {
    const db = new FakeDb();
    const spent = await enqueueJob(db, { ...input("spent"), maxAttempts: 1 });
    const fresh = await enqueueJob(db, { ...input("fresh", 2, "actor-1", "flow-2"), maxAttempts: 3 });
    await leaseJobs(db, "worker", 2, 1, new Date("2026-01-01T00:00:00Z"));
    const recovered = await requeueExpiredLeases(db, new Date("2026-01-01T00:01:00Z"));
    const spentAfter = recovered.find((job) => job.id === spent.id)!;
    const freshAfter = recovered.find((job) => job.id === fresh.id)!;
    expect(spentAfter.status).toBe("FAILED");
    expect(spentAfter.nextAttemptAt).toBeNull();
    expect(spentAfter.leaseOwner).toBeNull();
    expect(freshAfter.status).toBe("QUEUED");
  });
  it("releases an unstarted lease back to the queue and refunds the attempt", async () => {
    const db = new FakeDb();
    const job = await enqueueJob(db, input("release"));
    const leased = (await leaseJobs(db, "worker", 1, 30, new Date("2026-01-01T00:00:00Z")))[0];
    expect(leased.retryCount).toBe(1);
    const released = await releaseJob(db, job.id, "worker", leased.leaseToken!, new Date("2026-01-01T00:00:05Z"));
    expect(released.status).toBe("QUEUED");
    expect(released.retryCount).toBe(0);
    expect(released.leaseOwner).toBeNull();
    expect(released.leaseToken).toBeNull();
    expect(released.leaseUntil).toBeNull();
    // The never-started attempt is deleted so its number stays free under the
    // unique (jobId, attemptNumber) constraint.
    expect(db.attempts).toHaveLength(0);
    const again = (await leaseJobs(db, "worker-2", 1, 30, new Date("2026-01-01T00:01:00Z")))[0];
    expect(again.id).toBe(job.id);
    expect(again.retryCount).toBe(1);
    expect(db.attempts).toHaveLength(1);
    expect(db.attempts[0].attemptNumber).toBe(1);
  });
  it("fails closed for expired cancellation tokens and terminal cancellation", async () => { const db = new FakeDb(); const job = await enqueueJob(db, input("expired")); const leased = (await leaseJobs(db, "worker", 1, 1, new Date("2026-01-01T00:00:00Z")))[0]; await expect(heartbeatJob(db, job.id, "worker", leased.leaseToken!, 1, new Date("2026-01-01T00:02:00Z"))).rejects.toThrow(); await completeJob(db, job.id, "worker", leased.leaseToken!, {}, new Date("2026-01-01T00:00:00Z")).catch(() => undefined); await expect(cancelJob(db, job.id)).rejects.toThrow(); });
});
