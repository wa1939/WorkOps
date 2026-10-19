import { describe, expect, it, vi } from "vitest";
import type { JobDb, QueueJob, QueueJobAttempt, LeaseContext } from "./contracts";
import { processJobTick } from "./worker";
import { createDefaultJobHandlerRegistry, createJobHandlerRegistry, registerJobHandler } from "./handlers";

const date = new Date("2026-08-29T00:00:00.000Z");
function job(overrides: Partial<QueueJob> = {}): QueueJob { return { id: "job-1", type: "WORKFLOW_STEP", status: "QUEUED", priority: 1, idempotencyKey: "wf:step", actorId: "actor-1", workflowId: "wf-1", stepId: "step-1", payloadJson: JSON.stringify({ ok: true }), checkpointJson: null, leaseOwner: null, leaseToken: null, leaseUntil: null, heartbeatAt: null, retryCount: 0, maxAttempts: 3, nextAttemptAt: null, canceledAt: null, cancelRequestedAt: null, resultJson: null, errorJson: null, createdAt: date, updatedAt: date, ...overrides }; }
class FakeDb implements JobDb {
  public calls: string[] = [];
  public attempts: QueueJobAttempt[] = [];
  constructor(public items: QueueJob[]) {}
  async transaction<T>(fn: (db: JobDb) => Promise<T>): Promise<T> { return fn(this); }
  async findJobByIdempotencyKey(key: string): Promise<QueueJob | null> { return this.items.find((item) => item.idempotencyKey === key) ?? null; }
  async createJob(input: Omit<QueueJob, "id" | "createdAt" | "updatedAt">): Promise<QueueJob> { const created = job(input); this.items.push(created); return created; }
  async selectQueuedForLease(): Promise<QueueJob[]> { return this.items.filter((item) => item.status === "QUEUED"); }
  async updateJob(id: string, patch: Partial<QueueJob>): Promise<QueueJob> { const item = this.require(id); Object.assign(item, patch); this.calls.push(`update:${id}`); return item; }
  async updateJobIfStatus(id: string, expectedStatus: QueueJob["status"], patch: Partial<QueueJob>): Promise<QueueJob> { const item = this.require(id); if (item.status !== expectedStatus) throw new Error("status changed"); Object.assign(item, patch); return item; }
  async updateJobIfOwned(id: string, context: LeaseContext, patch: Partial<QueueJob>, _now?: Date) { const item = this.require(id); if (item.leaseOwner !== context.workerId || item.leaseToken !== context.leaseToken || (context.requireNoCancellation && item.cancelRequestedAt)) throw new Error("not owned"); Object.assign(item, patch); this.calls.push(`owned:${id}`); return item; }
  async updateExpiredJobIfOwned(id: string, context: LeaseContext, _now: Date, patch: Partial<QueueJob>): Promise<QueueJob> { return this.updateJobIfOwned(id, context, patch); }
  async createAttempt(input: Omit<QueueJobAttempt, "id" | "createdAt">): Promise<QueueJobAttempt> { const attempt: QueueJobAttempt = { ...input, id: `attempt-${this.attempts.length + 1}`, createdAt: date }; this.attempts.push(attempt); return attempt; }
  async updateAttempt(id: string, patch: Partial<QueueJobAttempt>): Promise<QueueJobAttempt> { const attempt = this.attempts.find((item) => item.id === id); if (!attempt) throw new Error("attempt missing"); Object.assign(attempt, patch); this.calls.push(`attempt:${attempt.status}`); return attempt; }
  async findAttempt(jobId: string, token: string): Promise<QueueJobAttempt | null> { return this.attempts.find((item) => item.jobId === jobId && item.leaseToken === token) ?? null; }
  async deleteAttempt(id: string): Promise<void> { const index = this.attempts.findIndex((item) => item.id === id); if (index >= 0) this.attempts.splice(index, 1); }
  async findJob(id: string): Promise<QueueJob | null> { return this.items.find((item) => item.id === id) ?? null; }
  async findExpiredLeases(): Promise<QueueJob[]> { return []; }
  private require(id: string): QueueJob { const item = this.items.find((candidate) => candidate.id === id); if (!item) throw new Error("job missing"); return item; }
}

describe("bounded durable worker", () => {
  it("does not lease when budget cannot cover initial heartbeat", async () => { const db = new FakeDb([job()]); const result = await processJobTick({ db, workerId: "w1", budgetMs: 45_000, clock: () => date, heartbeatSafetyMs: 45_001 }); expect(result.leased).toBe(0); expect(db.calls).toEqual([]); });
  it("resumes an existing owned lease when an explicit job is requested", async () => { const item = job({ status: "LEASED", leaseOwner: "w1", leaseToken: "lease-1", leaseUntil: new Date(date.getTime() + 60_000), checkpointJson: JSON.stringify({ cursor: "page-2" }) }); const db = new FakeDb([item]); db.attempts.push({ id: "attempt-1", jobId: item.id, attemptNumber: 1, workerId: "w1", leaseToken: "lease-1", leasedAt: date, startedAt: null, finishedAt: null, status: "LEASED", checkpointJson: null, resultJson: null, errorJson: null, createdAt: date }); const handler = vi.fn(async (_payload, context) => { expect(context.checkpoint).toEqual({ cursor: "page-2" }); return { result: { resumed: true } }; }); const result = await processJobTick({ db, workerId: "w1", actorId: "actor-1", workflowId: "wf-1", jobId: item.id, clock: () => date, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) }); expect(result.completed).toBe(1); expect(item.status).toBe("SUCCEEDED"); expect(db.attempts[0]?.status).toBe("SUCCEEDED"); });
  it("releases unstarted jobs back to the queue when the tick budget runs out", async () => {
    const first = job();
    const second = job({ id: "job-2", idempotencyKey: "wf:step-2" });
    const db = new FakeDb([first, second]);
    let nowMs = date.getTime();
    const handler = vi.fn(async () => { nowMs += 26_000; return { result: { ok: true } }; });
    const result = await processJobTick({ db, workerId: "w1", limit: 2, budgetMs: 30_000, heartbeatSafetyMs: 5_000, clock: () => new Date(nowMs), handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.completed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(second.status).toBe("QUEUED");
    expect(second.leaseOwner).toBeNull();
    expect(second.leaseToken).toBeNull();
    expect(second.retryCount).toBe(0);
  });
  it("durably cancels before handler and updates the attempt", async () => { const item = job({ cancelRequestedAt: date }); const db = new FakeDb([item]); const handler = vi.fn(async () => ({ result: null })); const result = await processJobTick({ db, workerId: "w1", clock: () => date, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) }); expect(handler).not.toHaveBeenCalled(); expect(result.canceled).toBe(1); expect(item.status).toBe("CANCELED"); expect(db.attempts[0]?.status).toBe("CANCELED"); });
  it("uses the real bounded extraction handler with an injected reader", async () => { const reader = vi.fn(async () => ({ filename: "intake.txt", buffer: Buffer.from("Action: send report", "utf8") })); const registry = createDefaultJobHandlerRegistry({ assetReader: reader }); const output = await registry.get("EXTRACTION")({ assetId: "asset-1" }, { jobId: "j", actorId: null, workflowId: null, stepId: null, signal: new AbortController().signal, checkpoint: undefined, heartbeat: async () => {}, saveCheckpoint: async () => {} }); expect(reader).toHaveBeenCalledWith("asset-1", expect.anything()); expect(output.result).toMatchObject({ kind: "text" }); });
  it("registers all production handler types", () => { const registry = createDefaultJobHandlerRegistry({}); expect(registry.get("WORKFLOW_STEP")).toBeTypeOf("function"); expect(registry.get("COMPRESSION")).toBeTypeOf("function"); expect(registry.get("INDEX_ENTITY")).toBeTypeOf("function"); expect(registry.get("EXTRACTION")).toBeTypeOf("function"); });
  it("rejects unknown work without retrying and continues", async () => { const items = [job({ type: "MONITOR" }), job({ id: "job-2", type: "MONITOR", idempotencyKey: "other" })]; const db = new FakeDb(items); const result = await processJobTick({ db, workerId: "w1", limit: 2, clock: () => date, handlers: createJobHandlerRegistry() }); expect(result.failed).toBe(2); expect(items.every((item) => item.status === "FAILED")).toBe(true); });
  it("classifies malformed checkpoint and payload JSON as permanent failures", async () => { const checkpointDb = new FakeDb([job({ checkpointJson: "{" })]); await processJobTick({ db: checkpointDb, workerId: "w1", clock: () => date, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: async () => ({ result: null }) }) }); expect(checkpointDb.items[0]?.status).toBe("FAILED"); const payloadDb = new FakeDb([job({ payloadJson: "{" })]); await processJobTick({ db: payloadDb, workerId: "w1", clock: () => date, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: async () => ({ result: null }) }) }); expect(payloadDb.items[0]?.status).toBe("FAILED"); expect(payloadDb.items[0]?.nextAttemptAt).toBeNull(); });
  it("cancellation wins when a handler rejects after abort", async () => { const controller = new AbortController(); const db = new FakeDb([job()]); const handler = async () => { controller.abort(); throw new Error("transient handler error"); }; const result = await processJobTick({ db, workerId: "w1", clock: () => date, signal: controller.signal, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) }); expect(result.canceled).toBe(1); expect(result.failed).toBe(0); expect(db.items[0]?.status).toBe("CANCELED"); expect(db.attempts[0]?.status).toBe("CANCELED"); });
  it("aborts the running handler when a heartbeat observes durable cancellation", async () => {
    const item = job();
    const db = new FakeDb([item]);
    let handlerObservedAbort = false;
    const handler = vi.fn(async (_payload, context) => {
      item.cancelRequestedAt = date;
      await context.heartbeat();
      handlerObservedAbort = context.signal.aborted;
      return { result: { shouldNotComplete: true } };
    });
    const result = await processJobTick({ db, workerId: "w1", clock: () => date, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) });
    expect(handler).toHaveBeenCalledOnce();
    expect(handlerObservedAbort).toBe(true);
    expect(result).toMatchObject({ completed: 0, failed: 0, canceled: 1 });
    expect(item.status).toBe("CANCELED");
  });
  it("treats a periodic heartbeat database error as a retriable failure", async () => {
    vi.useFakeTimers();
    try {
      const item = job();
      const db = new FakeDb([item]);
      let findCalls = 0;
      const originalFindJob = db.findJob.bind(db);
      db.findJob = vi.fn(async (id: string) => {
        findCalls++;
        if (findCalls === 2) throw new Error("Invalid Prisma invocation: database unavailable");
        return originalFindJob(id);
      });
      let started!: () => void;
      const handlerStarted = new Promise<void>((resolve) => { started = resolve; });
      const handler = vi.fn(async (_payload, context) => {
        started();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true });
        });
        return { result: null };
      });
      const pending = processJobTick({ db, workerId: "w1", clock: () => date, heartbeatIntervalMs: 250, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) });
      await handlerStarted;
      await vi.advanceTimersByTimeAsync(250);
      const result = await pending;
      expect(result).toMatchObject({ completed: 0, failed: 1, canceled: 0 });
      expect(item.status).toBe("RETRY_WAIT");
      expect(item.retryCount).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("drains an in-flight heartbeat before classifying the handler outcome", async () => {
    vi.useFakeTimers();
    try {
      const item = job();
      const db = new FakeDb([item]);
      const originalFindJob = db.findJob.bind(db);
      let findCalls = 0;
      let rejectHeartbeat!: (error: Error) => void;
      db.findJob = vi.fn(async (id: string) => {
        findCalls++;
        if (findCalls === 2) {
          return await new Promise<QueueJob | null>((_resolve, reject) => { rejectHeartbeat = reject; });
        }
        return originalFindJob(id);
      });
      let started!: () => void;
      const handlerStarted = new Promise<void>((resolve) => { started = resolve; });
      let finishHandler!: (value: { result: { ok: true } }) => void;
      const handler = vi.fn(async () => {
        started();
        return await new Promise<{ result: { ok: true } }>((resolve) => { finishHandler = resolve; });
      });
      const pending = processJobTick({ db, workerId: "w1", clock: () => date, heartbeatIntervalMs: 250, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) });
      await handlerStarted;
      await vi.advanceTimersByTimeAsync(250);
      finishHandler({ result: { ok: true } });
      rejectHeartbeat(new Error("Invalid Prisma invocation: database unavailable"));
      const result = await pending;
      expect(result).toMatchObject({ completed: 0, failed: 1, canceled: 0 });
      expect(item.status).toBe("RETRY_WAIT");
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not count cooperative cancellations toward the circuit breaker", async () => {
    const items = [
      job(),
      job({ id: "job-2", idempotencyKey: "wf:step-2" }),
      job({ id: "job-3", idempotencyKey: "wf:step-3" }),
      job({ id: "job-4", idempotencyKey: "wf:step-4" }),
    ];
    const db = new FakeDb(items);
    const handler = vi.fn(async (_payload, context) => {
      if (context.jobId !== "job-4") {
        db.items.find((candidate) => candidate.id === context.jobId)!.cancelRequestedAt = date;
        await context.heartbeat();
        context.signal.throwIfAborted();
      }
      return { result: { ok: true } };
    });
    const result = await processJobTick({ db, workerId: "w1", limit: 4, clock: () => date, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) });
    expect(result).toMatchObject({ completed: 1, failed: 0, canceled: 3, skipped: 0 });
    expect(items[3]?.status).toBe("SUCCEEDED");
  });
  it("lets cancellation win atomically during failure recording without opening the breaker", async () => {
    const items = [
      job(),
      job({ id: "job-2", idempotencyKey: "wf:step-2" }),
      job({ id: "job-3", idempotencyKey: "wf:step-3" }),
      job({ id: "job-4", idempotencyKey: "wf:step-4" }),
    ];
    const db = new FakeDb(items);
    const originalUpdateOwned = db.updateJobIfOwned.bind(db);
    db.updateJobIfOwned = vi.fn(async (id, context, patch, now) => {
      if (patch.status === "RETRY_WAIT" || patch.status === "FAILED") {
        db.items.find((candidate) => candidate.id === id)!.cancelRequestedAt = date;
      }
      const guarded = context as LeaseContext & { requireNoCancellation?: boolean };
      if (guarded.requireNoCancellation && db.items.find((candidate) => candidate.id === id)?.cancelRequestedAt) {
        throw new Error("Job cancellation won");
      }
      return originalUpdateOwned(id, context, patch, now);
    });
    const handler = vi.fn(async (_payload, context) => {
      if (context.jobId !== "job-4") throw new Error("temporary handler failure");
      return { result: { ok: true } };
    });
    const result = await processJobTick({ db, workerId: "w1", limit: 4, clock: () => date, handlers: createJobHandlerRegistry({ WORKFLOW_STEP: handler }) });
    expect(result).toMatchObject({ completed: 1, failed: 0, canceled: 3, skipped: 0 });
    expect(items[3]?.status).toBe("SUCCEEDED");
  });
  it("fails closed with an explicit extraction storage limitation by default", async () => { await expect(createDefaultJobHandlerRegistry({}).get("EXTRACTION")({ assetId: "asset-1" }, { jobId: "j", actorId: null, workflowId: null, stepId: null, signal: new AbortController().signal, checkpoint: undefined, heartbeat: async () => {}, saveCheckpoint: async () => {} })).rejects.toThrow("EXTRACTION_STORAGE_UNAVAILABLE"); });
  it("supports registry replacement", () => { const registry = createJobHandlerRegistry(); const fn = vi.fn(async () => ({ result: null })); registerJobHandler("WORKFLOW_STEP", fn, registry); expect(registry.get("WORKFLOW_STEP")).toBe(fn); });
});
