import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
    const tx = {
        $queryRaw: vi.fn(),
        task: { findFirst: vi.fn() },
        caseStudy: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({ id: "case-study-1" }) },
    };
    return {
        auth: vi.fn(),
        getCaseStudyForActor: vi.fn(),
        tx,
        prisma: {
            $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
        },
    };
});

const actorMocks = vi.hoisted(() => ({ toSabahActor: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: (...args: unknown[]) => actorMocks.toSabahActor(...args),
    SabahForbiddenError: class SabahForbiddenError extends Error {},
}));
vi.mock("@/lib/case-studies/commands", () => ({
    getCaseStudyForActor: mocks.getCaseStudyForActor,
    updateCaseStudy: vi.fn(),
    CaseStudyCommandError: class CaseStudyCommandError extends Error {
        constructor(message: string, public status: number, public code: string) {
            super(message);
        }
    },
}));

import { DELETE } from "./route";

describe("DELETE /api/case-studies/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.auth.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
        actorMocks.toSabahActor.mockResolvedValue({ id: "user-1", role: "ADMIN" });
        mocks.tx.caseStudy.findUnique.mockResolvedValue({ ownerId: "owner-1" });
        mocks.tx.task.findFirst.mockResolvedValue(null);
    });

    it("rejects deletion when PMO actions exist without deleting the case study", async () => {
        mocks.tx.task.findFirst.mockResolvedValue({ id: "task-1" });

        const response = await DELETE(
            new Request("http://localhost/api/case-studies/case-study-1", { method: "DELETE" }),
            { params: Promise.resolve({ id: "case-study-1" }) },
        );

        expect(response.status).toBe(409);
        expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
        expect(mocks.tx.$queryRaw).toHaveBeenCalledOnce();
        expect(mocks.tx.task.findFirst).toHaveBeenCalledWith({
            where: { caseStudyId: "case-study-1", type: "EXTERNAL_ACTION" },
            select: { id: true },
        });
        expect(mocks.tx.caseStudy.delete).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({
            error: "This case study cannot be deleted while PMO actions reference it; retain their history.",
            code: "PMO_ACTIONS_EXIST",
        });
    });

    it("deletes the case study only after confirming no PMO actions exist", async () => {
        const response = await DELETE(
            new Request("http://localhost/api/case-studies/case-study-1", { method: "DELETE" }),
            { params: Promise.resolve({ id: "case-study-1" }) },
        );

        expect(response.status).toBe(200);
        expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
        expect(mocks.tx.caseStudy.delete).toHaveBeenCalledWith({ where: { id: "case-study-1" } });
    });

    it("uses the current database actor instead of a stale JWT role", async () => {
        mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
        actorMocks.toSabahActor.mockResolvedValue({ id: "member-1", role: "MEMBER" });

        const response = await DELETE(
            new Request("http://localhost/api/case-studies/case-study-1", { method: "DELETE" }),
            { params: Promise.resolve({ id: "case-study-1" }) },
        );

        expect(response.status).toBe(403);
        expect(actorMocks.toSabahActor).toHaveBeenCalledWith(
            { id: "admin-1", role: "ADMIN" },
            mocks.tx,
        );
        expect(mocks.tx.caseStudy.delete).not.toHaveBeenCalled();
    });
});
