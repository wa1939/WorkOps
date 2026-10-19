import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { getSnapshot } from "@/lib/sabah/workflows/service";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        aiWorkflow: { findUnique: vi.fn(), updateMany: vi.fn() },
        aiWorkflowStep: { updateMany: vi.fn() },
        aiApproval: { updateMany: vi.fn() },
        $transaction: vi.fn(),
    },
}));
vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: vi.fn(),
    SabahForbiddenError: class SabahForbiddenError extends Error {},
}));
vi.mock("@/lib/sabah/workflows/service", () => ({ getSnapshot: vi.fn() }));

const actor = { id: "user-1", role: "MEMBER" as const, departmentIds: [] };
const running = { id: "wf-1", actorId: actor.id, status: "RUNNING" };
const canceledSnapshot = {
    id: "wf-1",
    goal: "Test",
    status: "CANCELED",
    actorId: actor.id,
    steps: [],
    approvals: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
};

function request(): NextRequest {
    return new NextRequest("http://localhost/api/ai/workflows/wf-1/stop", { method: "POST" });
}

describe("POST /api/ai/workflows/[id]/stop", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth).mockResolvedValue({ user: { id: actor.id } } as never);
        vi.mocked(toSabahActor).mockResolvedValue(actor);
        vi.mocked(getSnapshot).mockResolvedValue(canceledSnapshot as never);
        vi.mocked(prisma.aiWorkflowStep.updateMany).mockResolvedValue({ count: 0 } as never);
        vi.mocked(prisma.aiApproval.updateMany).mockResolvedValue({ count: 0 } as never);
        vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => callback(prisma));
    });

    it("returns the canceled snapshot when a concurrent stop wins the claim", async () => {
        vi.mocked(prisma.aiWorkflow.findUnique)
            .mockResolvedValueOnce(running as never)
            .mockResolvedValueOnce({ ...running, status: "CANCELED" } as never);
        vi.mocked(prisma.aiWorkflow.updateMany).mockResolvedValue({ count: 0 } as never);

        const response = await POST(request(), { params: Promise.resolve({ id: "wf-1" }) });

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ id: "wf-1", status: "CANCELED" });
        expect(getSnapshot).toHaveBeenCalledWith(actor, "wf-1", prisma);
    });

    it("preserves a completed outcome and returns a conflict", async () => {
        vi.mocked(prisma.aiWorkflow.findUnique)
            .mockResolvedValueOnce({ ...running, status: "COMPLETED" } as never)
            .mockResolvedValueOnce({ ...running, status: "COMPLETED" } as never);
        vi.mocked(prisma.aiWorkflow.updateMany).mockResolvedValue({ count: 0 } as never);

        const response = await POST(request(), { params: Promise.resolve({ id: "wf-1" }) });

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ status: "COMPLETED" });
        expect(getSnapshot).not.toHaveBeenCalled();
    });

    it("atomically cancels an awaiting workflow, skips its open steps, and rejects pending approvals", async () => {
        vi.mocked(prisma.aiWorkflow.findUnique).mockResolvedValue({ ...running, status: "AWAITING_APPROVAL" } as never);
        vi.mocked(prisma.aiWorkflow.updateMany).mockResolvedValue({ count: 1 } as never);
        vi.mocked(prisma.aiWorkflowStep.updateMany).mockResolvedValue({ count: 2 } as never);
        vi.mocked(prisma.aiApproval.updateMany).mockResolvedValue({ count: 1 } as never);

        const response = await POST(request(), { params: Promise.resolve({ id: "wf-1" }) });

        expect(response.status).toBe(200);
        expect(prisma.$transaction).toHaveBeenCalledOnce();
        expect(prisma.aiWorkflowStep.updateMany).toHaveBeenCalledWith({
            where: { workflowId: "wf-1", status: { in: ["PENDING", "APPROVAL_REQUIRED"] } },
            data: { status: "SKIPPED", completedAt: expect.any(Date) },
        });
        expect(prisma.aiApproval.updateMany).toHaveBeenCalledWith({
            where: { workflowId: "wf-1", status: "PENDING" },
            data: {
                status: "REJECTED",
                decidedById: actor.id,
                decidedAt: expect.any(Date),
                decisionType: "REJECT",
                decisionReason: "Workflow stopped",
            },
        });
    });
});
