import { describe, it, expect, vi, beforeEach } from "vitest";

const getProjectForActor = vi.fn();
const updateProject = vi.fn();

vi.mock("@/lib/projects/commands", () => ({
    getProjectForActor: (...args: unknown[]) => getProjectForActor(...args),
    updateProject: (...args: unknown[]) => updateProject(...args),
    ProjectCommandError: class ProjectCommandError extends Error {
        constructor(message: string, public status: number, public code: string) {
            super(message);
        }
    },
}));

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));

const deleteMocks = vi.hoisted(() => {
    const tx = {
        $queryRaw: vi.fn(),
        task: { deleteMany: vi.fn(), findFirst: vi.fn() },
        project: { findUnique: vi.fn(), delete: vi.fn().mockResolvedValue({ id: "project-1" }) },
    };
    return {
        project: { findUnique: vi.fn(), delete: vi.fn() },
        tx,
        $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
});

const actorMocks = vi.hoisted(() => ({
    toSabahActor: vi.fn().mockResolvedValue({ id: "user-1", role: "MEMBER", departmentIds: [] }),
}));

vi.mock("@/lib/prisma", () => ({ prisma: deleteMocks }));

vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: (...args: unknown[]) => actorMocks.toSabahActor(...args),
    SabahForbiddenError: class SabahForbiddenError extends Error {},
}));

import { DELETE, GET, PATCH } from "./route";

const sessionUser = { id: "user-1", role: "MEMBER" };

function makeParams(id: string) {
    return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown): Request {
    return new Request("http://localhost/api/projects/proj-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("GET /api/projects/[id]", () => {
    beforeEach(() => vi.clearAllMocks());

    it("401s when unauthenticated", async () => {
        auth.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost"), makeParams("proj-1"));
        expect(response.status).toBe(401);
    });

    it("404s when the project is inaccessible", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        getProjectForActor.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost"), makeParams("nope"));
        expect(response.status).toBe(404);
    });

    it("returns the projection", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        getProjectForActor.mockResolvedValue({ id: "proj-1", name: "EVP" });
        const response = await GET(new Request("http://localhost"), makeParams("proj-1"));
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.id).toBe("proj-1");
    });
});

describe("PATCH /api/projects/[id]", () => {
    beforeEach(() => vi.clearAllMocks());

    it("401s when unauthenticated", async () => {
        auth.mockResolvedValue(null);
        const response = await PATCH(patchRequest({ name: "New" }), makeParams("proj-1"));
        expect(response.status).toBe(401);
    });

    it("delegates to updateProject with expected version", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        updateProject.mockResolvedValue({ id: "proj-1", name: "New" });
        const response = await PATCH(
            patchRequest({ name: "New", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" }),
            makeParams("proj-1"),
        );
        expect(response.status).toBe(200);
        expect(updateProject).toHaveBeenCalledWith(
            "proj-1",
            expect.objectContaining({ name: "New" }),
            expect.anything(),
            expect.any(Date),
        );
    });

    it("accepts a nested timeline date patch and reuses the project update command", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        updateProject.mockResolvedValue({ id: "proj-1", startAt: "2026-01-01" });
        const response = await PATCH(
            patchRequest({
                expectedUpdatedAt: "2026-08-24T00:00:00.000Z",
                dates: {
                    startAt: "2026-01-01T00:00:00.000Z",
                    dueAt: "2026-01-31T00:00:00.000Z",
                    dueAtEnd: null,
                },
            }),
            makeParams("proj-1"),
        );

        expect(response.status).toBe(200);
        expect(updateProject).toHaveBeenCalledWith(
            "proj-1",
            {
                startAt: "2026-01-01T00:00:00.000Z",
                dueAt: "2026-01-31T00:00:00.000Z",
                dueAtEnd: null,
            },
            expect.anything(),
            expect.any(Date),
        );
    });

    it("maps VERSION_CONFLICT to 409", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        updateProject.mockRejectedValue(
            Object.assign(new Error("conflict"), { status: 409, code: "VERSION_CONFLICT" }),
        );
        const response = await PATCH(patchRequest({ name: "New", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" }), makeParams("proj-1"));
        expect(response.status).toBe(409);
    });

    it("maps NOT_FOUND to 404", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        updateProject.mockRejectedValue(Object.assign(new Error("gone"), { status: 404, code: "NOT_FOUND" }));
        const response = await PATCH(patchRequest({ name: "New", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" }), makeParams("nope"));
        expect(response.status).toBe(404);
    });

    it("400s on Zod failure", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        const response = await PATCH(patchRequest({ name: "" }), makeParams("proj-1"));
        expect(response.status).toBe(400);
    });
});

describe("DELETE /api/projects/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.mockResolvedValue({ user: { id: "user-1", role: "ADMIN" } });
        actorMocks.toSabahActor.mockResolvedValue({ id: "user-1", role: "ADMIN", departmentIds: [] });
        deleteMocks.tx.project.findUnique.mockResolvedValue({ ownerId: "owner-1" });
        deleteMocks.tx.task.findFirst.mockResolvedValue(null);
    });

    it("rejects deletion when PMO actions exist without deleting the project", async () => {
        deleteMocks.tx.task.findFirst.mockResolvedValue({ id: "task-1" });

        const response = await DELETE(
            new Request("http://localhost/api/projects/project-1", { method: "DELETE" }),
            makeParams("project-1"),
        );

        expect(response.status).toBe(409);
        expect(deleteMocks.$transaction).toHaveBeenCalledOnce();
        expect(deleteMocks.tx.$queryRaw).toHaveBeenCalledOnce();
        expect(deleteMocks.tx.task.findFirst).toHaveBeenCalledWith({
            where: { projectId: "project-1", type: "EXTERNAL_ACTION" },
            select: { id: true },
        });
        expect(deleteMocks.tx.task.deleteMany).not.toHaveBeenCalled();
        expect(deleteMocks.tx.project.delete).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toEqual({
            error: "This project cannot be deleted while PMO actions reference it; retain their history.",
            code: "PMO_ACTIONS_EXIST",
        });
    });

    it("deletes the project only after confirming no PMO actions exist", async () => {
        const response = await DELETE(
            new Request("http://localhost/api/projects/project-1", { method: "DELETE" }),
            makeParams("project-1"),
        );

        expect(response.status).toBe(200);
        expect(deleteMocks.$transaction).toHaveBeenCalledOnce();
        expect(deleteMocks.tx.task.deleteMany).not.toHaveBeenCalled();
        expect(deleteMocks.tx.project.delete).toHaveBeenCalledWith({ where: { id: "project-1" } });
    });

    it("uses the current database actor instead of a stale JWT role", async () => {
        auth.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
        actorMocks.toSabahActor.mockResolvedValue({ id: "member-1", role: "MEMBER", departmentIds: [] });

        const response = await DELETE(
            new Request("http://localhost/api/projects/project-1", { method: "DELETE" }),
            makeParams("project-1"),
        );

        expect(response.status).toBe(403);
        expect(actorMocks.toSabahActor).toHaveBeenCalledWith(
            { id: "admin-1", role: "ADMIN" },
            deleteMocks.tx,
        );
        expect(deleteMocks.tx.project.delete).not.toHaveBeenCalled();
    });
});
