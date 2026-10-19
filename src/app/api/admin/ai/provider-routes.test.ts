import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "../../ai/admin/providers/route";
import { PUT } from "../../ai/admin/providers/[id]/route";
import { POST as TestPOST } from "../../ai/admin/providers/[id]/test/route";
import { GET as AssignmentGET, PUT as AssignmentPUT } from "../../ai/admin/model-assignments/route";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import {
    listProviderCredentials,
    createProviderCredential,
    rotateProviderCredential,
    testProviderCredential,
    assignModelRole,
    listModelAssignments,
    unassignModelRole,
    rollbackProviderCredential,
} from "@/lib/sabah/providers/admin-service";
import { InvalidModelAssignmentConfigError } from "@/lib/sabah/providers/roles";
import { prisma } from "@/lib/prisma";

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

vi.mock("@/lib/sabah/providers/admin-service", () => ({
    listProviderCredentials: vi.fn(),
    createProviderCredential: vi.fn(),
    rotateProviderCredential: vi.fn(),
    testProviderCredential: vi.fn(),
    assignModelRole: vi.fn(),
    listModelAssignments: vi.fn(),
    rollbackProviderCredential: vi.fn(),
    unassignModelRole: vi.fn(),
    CredentialWriteUnavailableError: class CredentialWriteUnavailableError extends Error {
        status = 503;
        code = "CREDENTIAL_WRITE_UNAVAILABLE";
    },
    NoPreviousCredentialError: class NoPreviousCredentialError extends Error {
        status = 409;
    },
    CredentialConflictError: class CredentialConflictError extends Error {
        status = 409;
    },
    UnsupportedChatProviderError: class UnsupportedChatProviderError extends Error {
        status = 400;
        constructor(providerKey: string) { super(`CHAT provider ${providerKey} is unsupported`); }
    },
    UnsupportedModelAssignmentError: class UnsupportedModelAssignmentError extends Error {
        status = 400;
        constructor(role: string, providerKey: string, modelName: string) { super(`${role} target ${providerKey}/${modelName} is unsupported`); }
    },
}));

const adminActor = { id: "user_admin", role: "ADMIN" as const, departmentIds: ["dept_1"] };
const memberActor = { id: "user_member", role: "MEMBER" as const, departmentIds: ["dept_1"] };

const mockCredential = {
    id: "cred_1",
    providerKey: "openai",
    encryptedValue: "encrypted_blob",
    iv: "iv_blob",
    authTag: "tag_blob",
    keyVersion: 1,
    isEnabled: true,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
};

const maskedCredential = {
    id: "cred_1",
    providerKey: "openai",
    keyVersion: 1,
    isEnabled: true,
    maskedHint: "ope•••••••key",
    source: "db" as const,
    mutable: true as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

const jsonRequest = (body: unknown) =>
    new NextRequest("http://localhost/api/ai/admin/providers", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
    });

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/ai/admin/providers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 200 with masked provider credentials list", async () => {
        vi.stubEnv("GLM_API_KEY", "");
        vi.stubEnv("NUHA_API_KEY", "");
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(listProviderCredentials).mockResolvedValue([maskedCredential] as any);

        const response = await GET(new NextRequest("http://localhost/api/ai/admin/providers"));

        expect(response.status).toBe(200);
        const body = await response.json();
        // DB row first, then the env-configured providers (zai, nuha) so
        // admins can assign roles to them without a stored credential row.
        expect(body.providers).toHaveLength(3);
        expect(body.providers[0].maskedHint).toBe("ope•••••••key");
        expect(body.providers[0]).toMatchObject({ source: "db", mutable: true });
        expect(body.providers.map((p: { providerKey: string }) => p.providerKey)).toEqual(["openai", "zai", "nuha"]);
        expect(body.providers.filter((p: { id: string }) => p.id.startsWith("new:"))).toHaveLength(2);
        expect(body.providers.filter((p: { source: string }) => p.source === "placeholder")).toEqual(expect.arrayContaining([
            expect.objectContaining({ providerKey: "zai", mutable: true, isEnabled: false }),
            expect.objectContaining({ providerKey: "nuha", mutable: true, isEnabled: false }),
        ]));
        expect(listProviderCredentials).toHaveBeenCalledTimes(1);
    });

    it("falls back to environment and placeholder metadata when the provider schema is stale", async () => {
        vi.stubEnv("GLM_API_KEY", "env-zai-key");
        vi.stubEnv("NUHA_API_KEY", "");
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(listProviderCredentials).mockRejectedValue({ code: "P2022" });

        const response = await GET(new NextRequest("http://localhost/api/ai/admin/providers"));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
            providers: [
                expect.objectContaining({
                    id: "env:zai",
                    providerKey: "zai",
                    source: "env",
                    isEnabled: true,
                    mutable: false,
                }),
                expect.objectContaining({
                    id: "new:nuha",
                    providerKey: "nuha",
                    source: "placeholder",
                    isEnabled: false,
                    mutable: true,
                }),
            ],
        });
    });

    it("never returns credential plaintext", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(listProviderCredentials).mockResolvedValue([maskedCredential] as any);

        const response = await GET(new NextRequest("http://localhost/api/ai/admin/providers"));
        const body = await response.json();

        expect(JSON.stringify(body)).not.toContain("actual-secret");
        expect(body.providers[0].credential).toBeUndefined();
        expect(body.providers[0].encryptedValue).toBeUndefined();
    });

    it("returns 401 when unauthenticated", async () => {
        vi.mocked(auth).mockResolvedValue(null as any);

        const response = await GET(new NextRequest("http://localhost/api/ai/admin/providers"));

        expect(response.status).toBe(401);
        expect(listProviderCredentials).not.toHaveBeenCalled();
    });

    it("returns 403 when non-admin", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_member" } } as any);
        vi.mocked(toSabahActor).mockRejectedValue(new SabahForbiddenError());

        const response = await GET(new NextRequest("http://localhost/api/ai/admin/providers"));

        expect(response.status).toBe(403);
    });
});

describe("POST /api/ai/admin/providers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        { providerKey: "zai" },
        { providerKey: 42, credential: "provider-key" },
        { providerKey: "zai", credential: 42 },
    ])("returns 400 before service invocation for malformed creation input %#", async (input) => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(createProviderCredential).mockResolvedValue(maskedCredential as any);

        const response = await POST(jsonRequest(input));

        expect(response.status).toBe(400);
        expect(createProviderCredential).not.toHaveBeenCalled();
    });

    it("returns 201 with masked credential after creation", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(createProviderCredential).mockResolvedValue(maskedCredential as any);

        const response = await POST(
            jsonRequest({
                providerKey: "openai",
                credential: "sk-actual-secret-key",
            })
        );

        expect(response.status).toBe(201);
        const body = await response.json();
        expect(body.providerKey).toBe("openai");
        expect(body.credential).toBeUndefined();
        expect(createProviderCredential).toHaveBeenCalledWith(
            adminActor,
            { providerKey: "openai", credential: "sk-actual-secret-key" }
        );
    });

    it("returns 400 when body fails validation", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(createProviderCredential).mockRejectedValue(
            Object.assign(new Error("Invalid"), { issues: [{ path: ["providerKey"] }] })
        );

        const response = await POST(jsonRequest({ invalid: true }));

        expect(response.status).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
        vi.mocked(auth).mockResolvedValue(null as any);

        const response = await POST(jsonRequest({}));

        expect(response.status).toBe(401);
    });

    it("returns 403 when non-admin", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_member" } } as any);
        vi.mocked(toSabahActor).mockRejectedValue(new SabahForbiddenError());

        const response = await POST(jsonRequest({}));

        expect(response.status).toBe(403);
    });
});

describe("PUT /api/ai/admin/providers/[id]", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 200 with masked credential after rotation", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(rotateProviderCredential).mockResolvedValue(maskedCredential as any);

        const response = await PUT(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1", {
                method: "PUT",
                body: JSON.stringify({ newCredential: "sk-new-secret-key" }),
                headers: { "content-type": "application/json" },
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.keyVersion).toBe(1);
        expect(body.credential).toBeUndefined();
    });

    it("rejects rotation for an environment-configured provider before the credential service", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);

        const response = await PUT(new NextRequest("http://localhost/api/ai/admin/providers/env:zai", {
            method: "PUT",
            body: JSON.stringify({ newCredential: "new-key" }),
            headers: { "content-type": "application/json" },
        }), { params: { id: "env:zai" } } as any);

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/read-only/i) });
        expect(rotateProviderCredential).not.toHaveBeenCalled();
    });

    it("returns 401 when unauthenticated", async () => {
        vi.mocked(auth).mockResolvedValue(null as any);

        const response = await PUT(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1", {
                method: "PUT",
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(401);
    });

    it("returns 403 when non-admin", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_member" } } as any);
        vi.mocked(toSabahActor).mockRejectedValue(new SabahForbiddenError());

        const response = await PUT(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1", {
                method: "PUT",
                body: JSON.stringify({ newCredential: "sk-new-key" }),
                headers: { "content-type": "application/json" },
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(403);
    });
});

describe("PUT /api/ai/admin/providers/[id] rollback", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("restores the retained previous credential version", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(rollbackProviderCredential).mockResolvedValue(maskedCredential as any);

        const response = await PUT(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1", {
                method: "PUT",
                body: JSON.stringify({ action: "rollback" }),
                headers: { "content-type": "application/json" },
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ ok: true, providerKey: "openai" });
        expect(rollbackProviderCredential).toHaveBeenCalledWith(adminActor, "cred_1");
        expect(rotateProviderCredential).not.toHaveBeenCalled();
    });

    it("returns 409 when no previous version is retained", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        const { NoPreviousCredentialError } = await import("@/lib/sabah/providers/admin-service");
        vi.mocked(rollbackProviderCredential).mockRejectedValue(new (NoPreviousCredentialError as any)());

        const response = await PUT(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1", {
                method: "PUT",
                body: JSON.stringify({ action: "rollback" }),
                headers: { "content-type": "application/json" },
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(409);
    });

    it("rejects rollback for an environment-configured provider before the credential service", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);

        const response = await PUT(new NextRequest("http://localhost/api/ai/admin/providers/env:nuha", {
            method: "PUT",
            body: JSON.stringify({ action: "rollback" }),
            headers: { "content-type": "application/json" },
        }), { params: { id: "env:nuha" } } as any);

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/read-only/i) });
        expect(rollbackProviderCredential).not.toHaveBeenCalled();
    });
});

describe("GET /api/ai/admin/model-assignments", () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it("returns assignments in the UI shape with model mirroring modelName", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(listModelAssignments).mockResolvedValue([
            { id: "a1", role: "CHAT", providerKey: "zai", modelName: "glm-4.5-flash", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
        ] as any);

        const response = await AssignmentGET();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ assignments: [{ role: "CHAT", providerKey: "zai", model: "glm-4.5-flash" }] });
    });

    it("returns explicit fallback targets in the UI shape", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(listModelAssignments).mockResolvedValue([
            {
                id: "a1",
                role: "CHAT",
                providerKey: "zai",
                modelName: "glm-5",
                fallbacks: [{ providerKey: "nuha", modelName: "Nuha-2.1" }],
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ] as any);

        const response = await AssignmentGET();
        expect(await response.json()).toEqual({
            assignments: [{
                role: "CHAT",
                providerKey: "zai",
                model: "glm-5",
                fallbacks: [{ providerKey: "nuha", model: "Nuha-2.1" }],
            }],
        });
    });

    it("returns 403 for non-admins", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_member" } } as any);
        vi.mocked(toSabahActor).mockRejectedValue(new SabahForbiddenError());
        expect((await AssignmentGET()).status).toBe(403);
    });
});

describe("POST /api/ai/admin/providers/[id]/test", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 200 with test result", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(testProviderCredential).mockResolvedValue({
            success: true,
            latencyMs: 45,
            model: "gpt-4o",
        } as any);

        const response = await TestPOST(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1/test", {
                method: "POST",
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.latencyMs).toBe(45);
    });

    it("rejects testing an environment-configured provider before the credential service", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);

        const response = await TestPOST(new NextRequest("http://localhost/api/ai/admin/providers/env:zai/test", {
            method: "POST",
        }), { params: { id: "env:zai" } } as any);

        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/read-only/i) });
        expect(testProviderCredential).not.toHaveBeenCalled();
    });

    it("returns 401 when unauthenticated", async () => {
        vi.mocked(auth).mockResolvedValue(null as any);

        const response = await TestPOST(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1/test", {
                method: "POST",
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(401);
    });

    it("returns 403 when non-admin", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_member" } } as any);
        vi.mocked(toSabahActor).mockRejectedValue(new SabahForbiddenError());

        const response = await TestPOST(
            new NextRequest("http://localhost/api/ai/admin/providers/cred_1/test", {
                method: "POST",
            }),
            { params: { id: "cred_1" } } as any
        );

        expect(response.status).toBe(403);
    });
});

describe("PUT /api/ai/admin/model-assignments", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns 200 after upserting assignment", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(assignModelRole).mockResolvedValue({
            id: "assign_1",
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
        } as any);

        const response = await AssignmentPUT(
            new NextRequest("http://localhost/api/ai/admin/model-assignments", {
                method: "PUT",
                body: JSON.stringify({
                    role: "CHAT",
                    providerKey: "zai",
                    modelName: "glm-5",
                }),
                headers: { "content-type": "application/json" },
            })
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.role).toBe("CHAT");
        expect(assignModelRole).toHaveBeenCalledWith(
            adminActor,
            { role: "CHAT", providerKey: "zai", modelName: "glm-5" }
        );
    });

    it("passes explicit fallback targets through the admin API", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(assignModelRole).mockResolvedValue({
            id: "assign_1",
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: [{ providerKey: "nuha", modelName: "Nuha-2.1" }],
        } as any);

        const response = await AssignmentPUT(new NextRequest("http://localhost/api/ai/admin/model-assignments", {
            method: "PUT",
            body: JSON.stringify({
                role: "CHAT",
                providerKey: "zai",
                modelName: "glm-5",
                fallbacks: [{ providerKey: "nuha", modelName: "Nuha-2.1" }],
            }),
            headers: { "content-type": "application/json" },
        }));

        expect(response.status).toBe(200);
        expect(assignModelRole).toHaveBeenCalledWith(adminActor, {
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: [{ providerKey: "nuha", modelName: "Nuha-2.1" }],
        });
        expect((await response.json()).fallbacks).toEqual([{ providerKey: "nuha", model: "Nuha-2.1" }]);
    });

    it("passes the explicit null automatic-fallback sentinel through the admin API", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(assignModelRole).mockResolvedValue({
            id: "assign_1",
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
        } as any);

        const response = await AssignmentPUT(new NextRequest("http://localhost/api/ai/admin/model-assignments", {
            method: "PUT",
            body: JSON.stringify({
                role: "CHAT",
                providerKey: "zai",
                modelName: "glm-5",
                fallbacks: null,
            }),
            headers: { "content-type": "application/json" },
        }));

        expect(response.status).toBe(200);
        expect(assignModelRole).toHaveBeenCalledWith(adminActor, {
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: null,
        });
    });

    it("returns 400 for invalid fallback configuration", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(assignModelRole).mockRejectedValue(new InvalidModelAssignmentConfigError("CHAT fallback target is duplicated"));

        const response = await AssignmentPUT(new NextRequest("http://localhost/api/ai/admin/model-assignments", {
            method: "PUT",
            body: JSON.stringify({
                role: "CHAT",
                providerKey: "zai",
                modelName: "glm-5",
                fallbacks: [{ providerKey: "zai", modelName: "glm-4.5" }],
            }),
            headers: { "content-type": "application/json" },
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/duplicated/i) });
    });

    it("persists unassignment when the primary target is cleared", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(unassignModelRole).mockResolvedValue({ ok: true, role: "CHAT", unassigned: true });

        const response = await AssignmentPUT(new NextRequest("http://localhost/api/ai/admin/model-assignments", {
            method: "PUT",
            body: JSON.stringify({ role: "CHAT", providerKey: null, modelName: null }),
            headers: { "content-type": "application/json" },
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, role: "CHAT", unassigned: true });
        expect(unassignModelRole).toHaveBeenCalledWith(adminActor, "CHAT");
        expect(assignModelRole).not.toHaveBeenCalled();
    });

    it("returns 400 when CHAT is assigned to a provider without a chat adapter", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        const { UnsupportedChatProviderError } = await import("@/lib/sabah/providers/admin-service");
        vi.mocked(assignModelRole).mockRejectedValue(new (UnsupportedChatProviderError as any)("openai"));

        const response = await AssignmentPUT(new NextRequest("http://localhost/api/ai/admin/model-assignments", {
            method: "PUT",
            body: JSON.stringify({ role: "CHAT", providerKey: "openai", modelName: "gpt-4o-mini" }),
            headers: { "content-type": "application/json" },
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/unsupported/i) });
    });

    it("returns 400 when COMPRESSION is assigned to a target the runtime cannot execute", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        const { UnsupportedModelAssignmentError } = await import("@/lib/sabah/providers/admin-service");
        vi.mocked(assignModelRole).mockRejectedValue(new (UnsupportedModelAssignmentError as any)("COMPRESSION", "zai", "glm-5.3"));

        const response = await AssignmentPUT(new NextRequest("http://localhost/api/ai/admin/model-assignments", {
            method: "PUT",
            body: JSON.stringify({ role: "COMPRESSION", providerKey: "zai", modelName: "glm-5.3" }),
            headers: { "content-type": "application/json" },
        }));

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: expect.stringMatching(/unsupported/i) });
    });

    it("returns 400 before assignment when modelName is missing", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);

        const response = await AssignmentPUT(new NextRequest("http://localhost/api/ai/admin/model-assignments", {
            method: "PUT",
            body: JSON.stringify({ role: "COMPRESSION", providerKey: "zai" }),
            headers: { "content-type": "application/json" },
        }));

        expect(response.status).toBe(400);
        expect(assignModelRole).not.toHaveBeenCalled();
    });

    it("returns 400 for role mismatch", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_admin" } } as any);
        vi.mocked(toSabahActor).mockResolvedValue(adminActor as any);
        vi.mocked(assignModelRole).mockRejectedValue(
            Object.assign(new Error("Invalid role"), { issues: [{ path: ["role"] }] })
        );

        const response = await AssignmentPUT(
            new NextRequest("http://localhost/api/ai/admin/model-assignments", {
                method: "PUT",
                body: JSON.stringify({ role: "INVALID_ROLE" }),
                headers: { "content-type": "application/json" },
            })
        );

        expect(response.status).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
        vi.mocked(auth).mockResolvedValue(null as any);

        const response = await AssignmentPUT(
            new NextRequest("http://localhost/api/ai/admin/model-assignments", {
                method: "PUT",
            })
        );

        expect(response.status).toBe(401);
    });

    it("returns 403 when non-admin", async () => {
        vi.mocked(auth).mockResolvedValue({ user: { id: "user_member" } } as any);
        vi.mocked(toSabahActor).mockRejectedValue(new SabahForbiddenError());

        const response = await AssignmentPUT(
            new NextRequest("http://localhost/api/ai/admin/model-assignments", {
                method: "PUT",
                body: JSON.stringify({ role: "REASONING" }),
                headers: { "content-type": "application/json" },
            })
        );

        expect(response.status).toBe(403);
    });
});
