import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, GET } from "./route";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { proposeWorkflow, listWorkflows, WorkflowServiceError } from "@/lib/sabah/workflows/service";

vi.mock("@/lib/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: vi.fn(),
    SabahForbiddenError: class extends Error {
        status = 403;
        code = "SABAH_FORBIDDEN";
    },
}));

vi.mock("@/lib/sabah/workflows/service", () => ({
    proposeWorkflow: vi.fn(),
    listWorkflows: vi.fn(),
    WorkflowServiceError: class extends Error {
        constructor(message: string, public status = 400) { super(message); }
    },
}));

vi.mock("@/lib/sabah/capabilities/runner-deps", () => ({
    getRunnerDeps: vi.fn(() => ({
        registry: {},
        db: {},
        now: () => new Date(),
        flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true },
    })),
}));

const adminActor = { id: "user_admin", role: "ADMIN" as const, departmentIds: ["dept_1"] };

const snapshot = {
    id: "wf1",
    goal: "Test",
    status: "PLANNED" as const,
    steps: [],
    approvals: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

const jsonRequest = (body: unknown) =>
    new NextRequest("http://localhost/api/ai/workflows", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
    });

describe("POST /api/ai/workflows", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 201 with the proposed workflow snapshot", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(proposeWorkflow).mockResolvedValue(snapshot as any);

        const response = await POST(jsonRequest({
            goal: "Test",
            steps: [{ clientStepId: "a", capability: "test.one", args: {}, dependsOn: [], confidence: 0.9 }],
            idempotencyKey: "key-1",
        }));

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.id).toBe("wf1");
        expect(proposeWorkflow).toHaveBeenCalledTimes(1);
    });

    it("returns 401 when unauthenticated", async () => {
        vi.mocked(auth).mockResolvedValue(null as any);

        const response = await POST(jsonRequest({}));

        expect(response.status).toBe(401);
        expect(proposeWorkflow).not.toHaveBeenCalled();
    });

    it("returns 403 when the actor is forbidden", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_viewer" } } as any);
        vi.mocked(toSabahActor).mockRejectedValue(new SabahForbiddenError());

        const response = await POST(jsonRequest({}));

        expect(response.status).toBe(403);
    });

    it("returns 400 when the body fails schema validation", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(proposeWorkflow).mockRejectedValue(
            Object.assign(new Error("Invalid"), { issues: [{ path: ["goal"] }] })
        );

        const response = await POST(jsonRequest({ invalid: true }));

        expect(response.status).toBe(400);
    });

    it("returns an idempotency conflict with its service status", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(proposeWorkflow).mockRejectedValue(new WorkflowServiceError("Idempotency key reused with different workflow content", 409));

        const response = await POST(jsonRequest({ goal: "Changed" }));

        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ error: "Idempotency key reused with different workflow content" });
    });
});

describe("GET /api/ai/workflows", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns actor-scoped workflows", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(listWorkflows).mockResolvedValue([snapshot] as any);

        const response = await GET(new NextRequest("http://localhost/api/ai/workflows?status=PLANNED&conversationId=conv-123"));

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.workflows).toHaveLength(1);
        expect(listWorkflows).toHaveBeenCalledWith(adminActor, { status: "PLANNED", conversationId: "conv-123", limit: undefined });
    });

    it("returns 401 when unauthenticated", async () => {
        vi.mocked(auth).mockResolvedValue(null as any);

        const response = await GET(new NextRequest("http://localhost/api/ai/workflows"));

        expect(response.status).toBe(401);
    });
});
