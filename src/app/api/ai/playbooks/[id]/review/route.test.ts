import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { getLearningDependencies, learningErrorResponse } from "@/lib/sabah/capabilities/modules/learning";
import { submitPlaybookReview } from "@/lib/sabah/playbooks/service";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: vi.fn() }));
vi.mock("@/lib/sabah/capabilities/modules/learning", () => ({
    getLearningDependencies: vi.fn(),
    learningErrorResponse: vi.fn(),
}));
vi.mock("@/lib/sabah/playbooks/service", () => ({ submitPlaybookReview: vi.fn() }));

const actor = { id: "u1", role: "MEMBER" as const, departmentIds: ["d1"] };
const adapter = { name: "playbook-adapter" };
const dependencies = {
    playbooks: adapter,
    playbookOptions: { registry: { name: "registry" } },
};

function request(): NextRequest {
    return new NextRequest("http://localhost/api/ai/playbooks/pbv1/review", { method: "POST" });
}

describe("POST /api/ai/playbooks/[id]/review", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.mocked(getLearningDependencies).mockReturnValue(dependencies as never);
        vi.mocked(toSabahActor).mockResolvedValue(actor as never);
        vi.mocked(learningErrorResponse).mockReturnValue({ status: 500, body: { error: "mapped" } } as never);
    });

    it("requires an authenticated actor", async () => {
        vi.mocked(auth).mockResolvedValue(null as never);
        const response = await POST(request(), { params: Promise.resolve({ id: "pbv1" }) });
        expect(response.status).toBe(401);
        expect(submitPlaybookReview).not.toHaveBeenCalled();
    });

    it("rejects unsafe version identifiers before the service seam", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
        const response = await POST(request(), { params: Promise.resolve({ id: "../secret" }) });
        expect(response.status).toBe(400);
        expect(submitPlaybookReview).not.toHaveBeenCalled();
    });

    it("submits only the immutable version through the governed service and returns a bounded projection", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "MEMBER" } } as never);
        vi.mocked(submitPlaybookReview).mockResolvedValue({
            id: "pbv1",
            playbookId: "launch",
            version: 2,
            state: "IN_REVIEW",
            checksum: "abc",
            description: "must not be returned",
        } as never);

        const response = await POST(request(), { params: Promise.resolve({ id: "pbv1" }) });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
            id: "pbv1",
            playbookId: "launch",
            version: 2,
            state: "IN_REVIEW",
            checksum: "abc",
        });
        expect(submitPlaybookReview).toHaveBeenCalledWith("pbv1", actor, {
            registry: dependencies.playbookOptions.registry,
            adapter,
        });
    });

    it("maps governed service failures without bypassing the service", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1" } } as never);
        vi.mocked(submitPlaybookReview).mockRejectedValue(new Error("only drafts"));
        vi.mocked(learningErrorResponse).mockReturnValue({ status: 409, body: { error: "invalid state" } } as never);

        const response = await POST(request(), { params: Promise.resolve({ id: "pbv1" }) });
        expect(response.status).toBe(409);
        await expect(response.json()).resolves.toEqual({ error: "invalid state" });
    });
});
