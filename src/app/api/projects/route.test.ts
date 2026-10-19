import { describe, it, expect, vi, beforeEach } from "vitest";

const createProject = vi.fn();
const listProjectsForActor = vi.fn();
const getProjectForActor = vi.fn();
const updateProject = vi.fn();

vi.mock("@/lib/projects/commands", () => ({
    createProject: (...args: unknown[]) => createProject(...args),
    listProjectsForActor: (...args: unknown[]) => listProjectsForActor(...args),
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

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: vi.fn().mockResolvedValue({ id: "user-1", role: "MEMBER", departmentIds: [] }),
    SabahForbiddenError: class SabahForbiddenError extends Error {},
}));

import { GET, POST } from "./route";

const sessionUser = { id: "user-1", role: "MEMBER" };
const validBody = {
    name: "EVP",
    status: "Active",
    sponsorStatus: "APPROVED",
    startAt: "2026-11-01T00:00:00.000Z",
    dueAt: "2027-04-30T23:59:59.999Z",
    dueAtEnd: null,
    ownerId: null,
    managerId: null,
    responsibleDepartmentId: null,
    sponsorId: null,
    objective: null,
    scope: null,
    successCriteria: null,
    projectType: null,
    priority: "MEDIUM",
    health: "NOT_SET",
    workAreaId: null,
    memberIds: [],
    objectives: [],
    outputs: [],
    risks: [],
    stages: [],
    metadata: {},
    description: null,
};

function jsonRequest(body: unknown): Request {
    return new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

describe("GET /api/projects", () => {
    beforeEach(() => vi.clearAllMocks());

    it("401s when unauthenticated", async () => {
        auth.mockResolvedValue(null);
        const response = await GET();
        expect(response.status).toBe(401);
    });

    it("delegates listing to listProjectsForActor", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        listProjectsForActor.mockResolvedValue([]);
        const response = await GET();
        expect(response.status).toBe(200);
        expect(listProjectsForActor).toHaveBeenCalled();
    });
});

describe("POST /api/projects", () => {
    beforeEach(() => vi.clearAllMocks());

    it("401s when unauthenticated", async () => {
        auth.mockResolvedValue(null);
        const response = await POST(jsonRequest(validBody));
        expect(response.status).toBe(401);
    });

    it("400s on invalid body (Zod)", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        const response = await POST(jsonRequest({ ...validBody, name: "" }));
        expect(response.status).toBe(400);
        expect(createProject).not.toHaveBeenCalled();
    });

    it("authenticates, parses, and delegates to createProject with 201", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        createProject.mockResolvedValue({ id: "proj-1", name: "EVP" });
        const response = await POST(jsonRequest(validBody));
        expect(response.status).toBe(201);
        const [input] = createProject.mock.calls[0];
        expect(input).toMatchObject({ name: "EVP" });
    });

    it("maps INVALID_REFERENCE to 400", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        createProject.mockRejectedValue(
            Object.assign(new Error("bad ref"), { status: 400, code: "INVALID_REFERENCE" }),
        );
        const response = await POST(jsonRequest(validBody));
        expect(response.status).toBe(400);
    });

    it("passes ownerId null when makeFloating is true (201)", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        createProject.mockResolvedValue({ id: "proj-1", name: "EVP" });
        const { ownerId: _omitted, ...bodyWithoutOwner } = validBody;
        const response = await POST(jsonRequest({ ...bodyWithoutOwner, makeFloating: true }));
        expect(response.status).toBe(201);
        expect(createProject).toHaveBeenCalledTimes(1);
        const [input] = createProject.mock.calls[0];
        expect(input.ownerId).toBeNull();
        expect(input.makeFloating).toBeUndefined();
    });

    it("does not force floating when makeFloating is false", async () => {
        auth.mockResolvedValue({ user: sessionUser });
        createProject.mockResolvedValue({ id: "proj-1", name: "EVP" });
        const { ownerId: _omitted, ...bodyWithoutOwner } = validBody;
        const response = await POST(jsonRequest({ ...bodyWithoutOwner, makeFloating: false }));
        expect(response.status).toBe(201);
        const [input] = createProject.mock.calls[0];
        expect(input.ownerId).toBeUndefined(); // command defaults to actor
    });
});
