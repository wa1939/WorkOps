import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    toSabahActor: vi.fn(),
    findUnique: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: mocks.toSabahActor }));
vi.mock("@/lib/prisma", () => ({ prisma: { aiJob: { findUnique: mocks.findUnique } } }));

import { GET } from "./route";

describe("GET /api/ai/jobs/:id durable projection", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.auth.mockResolvedValue({ user: { id: "actor-1", role: "MEMBER" } });
        mocks.toSabahActor.mockResolvedValue({ id: "actor-1", role: "MEMBER", departmentIds: [] });
        mocks.findUnique.mockResolvedValue({
            id: "job-1",
            type: "WORKFLOW_STEP",
            status: "RUNNING",
            priority: "MEDIUM",
            actorId: "actor-1",
            workflowId: "workflow-1",
            stepId: "step-1",
            payloadJson: JSON.stringify({ workflowKey: "workflow-key", stepKey: "step-key", entityKey: "entity-key", correlationId: "correlation-1" }),
            checkpointJson: JSON.stringify({ cursor: "page-2" }),
            leaseOwner: "worker-1",
            retryCount: 1,
            maxAttempts: 3,
            nextAttemptAt: null,
            leaseUntil: new Date("2026-08-31T12:05:00.000Z"),
            canceledAt: null,
            cancelRequestedAt: null,
            createdAt: new Date("2026-08-31T12:00:00.000Z"),
            updatedAt: new Date("2026-08-31T12:01:00.000Z"),
            resultJson: null,
            errorJson: null,
            attempts: [{
                id: "attempt-1",
                attemptNumber: 1,
                status: "RUNNING",
                workerId: "worker-1",
                leasedAt: new Date("2026-08-31T12:00:00.000Z"),
                startedAt: new Date("2026-08-31T12:00:01.000Z"),
                finishedAt: null,
                createdAt: new Date("2026-08-31T12:00:00.000Z"),
                checkpointJson: JSON.stringify({ cursor: "page-2" }),
                errorJson: null,
            }],
        });
    });

    it("returns bounded checkpoint, lease, and correlation identity fields", async () => {
        const response = await GET(new NextRequest("http://localhost/api/ai/jobs/job-1"), { params: Promise.resolve({ id: "job-1" }) });
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.status).toBe("CHECKPOINTED");
        expect(body.leaseOwner).toBe("worker-1");
        expect(body.checkpoint).toEqual({ present: true });
        expect(body.attempts[0]).toMatchObject({
            workflowKey: "workflow-key",
            stepKey: "step-key",
            entityKey: "entity-key:1",
            correlationId: "correlation-1",
            checkpointed: true,
        });
    });

    it("preserves queued status when checkpoint metadata is present", async () => {
        mocks.findUnique.mockResolvedValue({
            id: "job-queued", type: "WORKFLOW_STEP", status: "QUEUED", priority: "MEDIUM", actorId: "actor-1", workflowId: null, stepId: null,
            payloadJson: null, checkpointJson: JSON.stringify({ cursor: "stale" }), leaseOwner: null, retryCount: 0, maxAttempts: 3,
            nextAttemptAt: null, leaseUntil: null, canceledAt: null, cancelRequestedAt: null, createdAt: new Date(), updatedAt: new Date(),
            resultJson: null, errorJson: null, attempts: [],
        });
        const response = await GET(new NextRequest("http://localhost/api/ai/jobs/job-queued"), { params: Promise.resolve({ id: "job-queued" }) });
        expect(response.status).toBe(200);
        expect((await response.json()).status).toBe("QUEUED");
    });
});
