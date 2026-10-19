import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const findUnique = vi.fn();
const findMany = vi.fn();
const auth = vi.fn();
const toSabahActor = vi.fn();
const processJobTick = vi.fn();
const cancelJob = vi.fn();
const createPrismaJobDb = vi.fn(() => ({ database: "fake" }));

vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor, SabahForbiddenError: class SabahForbiddenError extends Error {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { aiJob: { findUnique, findMany } } }));
vi.mock("@/lib/sabah/jobs/queue", () => ({ cancelJob, createPrismaJobDb }));
vi.mock("@/lib/sabah/jobs/worker", () => ({ processJobTick }));

const job = (overrides: Record<string, unknown> = {}) => ({
    id: "job-1", type: "WORKFLOW_STEP", status: "QUEUED", priority: "HIGH", actorId: "actor-1", workflowId: "workflow-1", stepId: "step-1",
    retryCount: 1, maxAttempts: 3, createdAt: new Date("2026-08-29T00:00:00Z"), updatedAt: new Date("2026-08-29T00:01:00Z"), nextAttemptAt: null,
    leaseUntil: null, canceledAt: null, cancelRequestedAt: null, resultJson: '{"safe":true}', errorJson: null,
    attempts: [{ id: "attempt-1", attemptNumber: 1, status: "SUCCEEDED", workerId: "worker", leasedAt: new Date("2026-08-29T00:00:01Z"), startedAt: null, finishedAt: new Date("2026-08-29T00:00:02Z"), createdAt: new Date("2026-08-29T00:00:01Z"), errorJson: null }],
    payloadJson: '{"credential":"do-not-leak"}', checkpointJson: '{"secret":"do-not-leak"}', ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
    auth.mockResolvedValue({ user: { id: "actor-1", role: "MEMBER" } });
    toSabahActor.mockResolvedValue({ id: "actor-1", role: "MEMBER", departmentIds: [] });
    findUnique.mockResolvedValue(job());
    processJobTick.mockResolvedValue({ leased: 1, completed: 1, failed: 0, canceled: 0, skipped: 0 });
    cancelJob.mockResolvedValue(job({ status: "CANCELED", canceledAt: new Date() }));
});

const routeParams = { params: Promise.resolve({ id: "job-1" }) };

describe("actor-scoped job routes", () => {
    it("returns 401 before any job lookup when unauthenticated", async () => {
        auth.mockResolvedValue(null);
        const { GET } = await import("./[id]/route");
        const response = await GET(new NextRequest("http://localhost/api/ai/jobs/job-1"), routeParams);
        expect(response.status).toBe(401);
        expect(findUnique).not.toHaveBeenCalled();
    });

    it("returns a bounded safe snapshot for the owning actor", async () => {
        const { GET } = await import("./[id]/route");
        const response = await GET(new NextRequest("http://localhost/api/ai/jobs/job-1"), routeParams);
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(body).toMatchObject({ id: "job-1", type: "WORKFLOW_STEP", status: "QUEUED", actorId: "actor-1", workflowId: "workflow-1", stepId: "step-1" });
        expect(body.payloadJson).toBeUndefined();
        expect(body.checkpointJson).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain("do-not-leak");
        expect(body.attempts).toHaveLength(1);
    });

    it("hides malformed or cross-actor job ids without invoking the worker", async () => {
        findUnique.mockResolvedValue(job({ actorId: "other-actor" }));
        const { GET } = await import("./[id]/route");
        const response = await GET(new NextRequest("http://localhost/api/ai/jobs/job-1"), routeParams);
        expect(response.status).toBe(404);
        expect(processJobTick).not.toHaveBeenCalled();
        const malformed = await GET(new NextRequest("http://localhost/api/ai/jobs/bad%20id"), { params: Promise.resolve({ id: "bad id" }) });
        expect(malformed.status).toBe(404);
    });

    it("ticks only the authorized job with actor and eight-second bound", async () => {
        const { POST } = await import("./[id]/tick/route");
        const response = await POST(new NextRequest("http://localhost/api/ai/jobs/job-1", { method: "POST" }), routeParams);
        expect(response.status).toBe(200);
        expect(processJobTick).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-1", actorId: "actor-1", budgetMs: 8_000, limit: 1, db: expect.anything() }));
    });

    it.each([["QUEUED"], ["RUNNING"], ["SUCCEEDED"]])("cancels %s with bounded response", async (status) => {
        cancelJob.mockResolvedValue(job({ status }));
        const { POST } = await import("./[id]/cancel/route");
        const response = await POST(new NextRequest("http://localhost/api/ai/jobs/job-1", { method: "POST" }), routeParams);
        const body = await response.json();
        expect([200, 409]).toContain(response.status);
        expect(body.id).toBe("job-1");
        expect(body.payloadJson).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain("do-not-leak");
    });

    it("does not cancel a workflow job owned by another actor", async () => {
        findUnique.mockResolvedValue(job({ actorId: "other-actor" }));
        const { POST } = await import("./[id]/cancel/route");
        const response = await POST(new NextRequest("http://localhost/api/ai/jobs/job-1", { method: "POST" }), routeParams);
        expect(response.status).toBe(404);
        expect(cancelJob).not.toHaveBeenCalled();
    });
});
