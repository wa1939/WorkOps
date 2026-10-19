import { describe, expect, it, vi } from "vitest";
import {
    assignModelRole,
    listModelAssignments,
    listProviderCredentials,
    resolveRuntimeProviderCredentials,
    UnsupportedChatProviderError,
    UnsupportedModelAssignmentError,
} from "./admin-service";
import type { ModelTarget } from "./roles";
import { encryptCredential } from "./crypto";

const admin = { id: "admin-1", role: "ADMIN" as const, departmentIds: [] };

function database() {
    return {
        aiModelAssignment: { upsert: vi.fn() },
    };
}

describe("assignModelRole CHAT provider boundary", () => {
    it("rejects a provider without a CHAT runtime adapter before persistence", async () => {
        const db = database();

        await expect(assignModelRole(admin, {
            role: "CHAT",
            providerKey: "openai",
            modelName: "gpt-4o-mini",
        }, db as never)).rejects.toBeInstanceOf(UnsupportedChatProviderError);

        expect(db.aiModelAssignment.upsert).not.toHaveBeenCalled();
    });

    it.each([
        ["zai", "glm-5"],
        ["nuha", "Nuha-2.1"],
    ])("allows the supported %s CHAT provider", async (providerKey, modelName) => {
        const db = database();
        db.aiModelAssignment.upsert.mockResolvedValue({
            id: "assignment-1",
            role: "CHAT",
            providerKey,
            modelName,
            createdAt: new Date(0),
            updatedAt: new Date(0),
        });

        await expect(assignModelRole(admin, { role: "CHAT", providerKey, modelName }, db as never))
            .resolves.toMatchObject({ role: "CHAT", providerKey, modelName });
    });
});

describe("assignModelRole COMPRESSION execution boundary", () => {
    it.each([
        ["openai", "gpt-4o-mini"],
        ["anthropic", "claude-3-5-sonnet"],
        ["zai", "glm-5.3"],
    ])("rejects unsupported %s/%s before persistence", async (providerKey, modelName) => {
        const db = database();

        await expect(assignModelRole(admin, { role: "COMPRESSION", providerKey, modelName }, db as never))
            .rejects.toBeInstanceOf(UnsupportedModelAssignmentError);
        expect(db.aiModelAssignment.upsert).not.toHaveBeenCalled();
    });

    it.each([["zai", "glm-5"], ["nuha", "Nuha-2.1"]])("allows executable %s/%s", async (providerKey, modelName) => {
        const db = database();
        db.aiModelAssignment.upsert.mockResolvedValue({ id: "assignment-1", role: "COMPRESSION", providerKey, modelName, createdAt: new Date(0), updatedAt: new Date(0) });

        await expect(assignModelRole(admin, { role: "COMPRESSION", providerKey, modelName }, db as never))
            .resolves.toMatchObject({ role: "COMPRESSION", providerKey, modelName });
    });
});

describe("assignModelRole runtime role boundary", () => {
    it("rejects a role without a wired runtime adapter before persistence", async () => {
        const db = database();

        await expect(assignModelRole(admin, { role: "PLANNER", providerKey: "zai", modelName: "glm-5" }, db as never))
            .rejects.toBeInstanceOf(UnsupportedModelAssignmentError);
        expect(db.aiModelAssignment.upsert).not.toHaveBeenCalled();
    });
});

describe("provider metadata listing", () => {
    it("uses a metadata-only projection that does not require rotation-history columns", async () => {
        const findMany = vi.fn().mockResolvedValue([{
            id: "cred-zai",
            providerKey: "zai",
            keyVersion: 2,
            isEnabled: true,
            createdAt: new Date("2026-01-02T03:04:05.000Z"),
            updatedAt: new Date("2026-01-03T03:04:05.000Z"),
        }]);

        const result = await listProviderCredentials(admin, { aiProviderCredential: { findMany } } as never);

        expect(findMany).toHaveBeenCalledWith({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                providerKey: true,
                keyVersion: true,
                isEnabled: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        expect(result).toEqual([{
            id: "cred-zai",
            providerKey: "zai",
            keyVersion: 2,
            isEnabled: true,
            maskedHint: "zai•••••••key",
            source: "db",
            mutable: true,
            createdAt: "2026-01-02T03:04:05.000Z",
            updatedAt: "2026-01-03T03:04:05.000Z",
        }]);
        expect(result[0]).not.toHaveProperty("encryptedValue");
    });
});

describe("model assignment metadata and ordered fallbacks", () => {
    it("lists validated fallback targets without selecting encrypted provider data", async () => {
        const findMany = vi.fn().mockResolvedValue([{
            id: "assignment-1",
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            configJson: JSON.stringify({
                temperature: 0.2,
                fallbacks: [
                    { providerKey: "zai", modelName: "glm-4.5" },
                    { providerKey: "zai", modelName: "glm-4.5-air" },
                ],
            }),
            createdAt: new Date(0),
            updatedAt: new Date(0),
        }]);

        const result = await listModelAssignments(admin, { aiModelAssignment: { findMany } } as never);

        expect(findMany).toHaveBeenCalledWith({
            orderBy: { role: "asc" },
            select: {
                id: true,
                role: true,
                providerKey: true,
                modelName: true,
                configJson: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        expect(result[0]).toMatchObject({
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: [
                { providerKey: "zai", modelName: "glm-4.5" },
                { providerKey: "zai", modelName: "glm-4.5-air" },
            ],
        });
    });

    it("preserves other config while persisting same-provider fallback models in order", async () => {
        const upsert = vi.fn().mockResolvedValue({
            id: "assignment-1",
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            createdAt: new Date(0),
            updatedAt: new Date(0),
        });
        const findUnique = vi.fn().mockResolvedValue({ configJson: JSON.stringify({ temperature: 0.2 }) });
        const db = { aiModelAssignment: { findUnique, upsert } };
        const fallbacks: ModelTarget[] = [
            { providerKey: "zai", modelName: "glm-4.5" },
            { providerKey: "zai", modelName: "glm-4.5-air" },
        ];

        await assignModelRole(admin, {
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks,
        }, db as never);

        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({
                configJson: JSON.stringify({ temperature: 0.2, fallbacks }),
            }),
        }));
    });

    it("persists an empty fallback array to disable automatic fallback", async () => {
        const upsert = vi.fn().mockResolvedValue({
            id: "assignment-1",
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            createdAt: new Date(0),
            updatedAt: new Date(0),
        });
        const db = {
            aiModelAssignment: {
                findUnique: vi.fn().mockResolvedValue(null),
                upsert,
            },
        };

        await assignModelRole(admin, {
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: [],
        }, db as never);

        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ configJson: JSON.stringify({ fallbacks: [] }) }),
            update: expect.objectContaining({ configJson: JSON.stringify({ fallbacks: [] }) }),
        }));
    });

    it("clears only fallbacks when the explicit null sentinel is supplied", async () => {
        const upsert = vi.fn().mockResolvedValue({
            id: "assignment-1",
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            createdAt: new Date(0),
            updatedAt: new Date(0),
        });
        const findUnique = vi.fn().mockResolvedValue({
            configJson: JSON.stringify({
                temperature: 0.2,
                maxTokens: 4000,
                fallbacks: [{ providerKey: "zai", modelName: "glm-4.5" }],
            }),
        });
        const db = { aiModelAssignment: { findUnique, upsert } };

        await assignModelRole(admin, {
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            fallbacks: null,
        }, db as never);

        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({
                configJson: JSON.stringify({ temperature: 0.2, maxTokens: 4000 }),
            }),
        }));
    });
});

describe("runtime provider credentials", () => {
    it("decrypts enabled supported credentials for internal chat execution", async () => {
        const masterKey = Buffer.from("r".repeat(32), "utf8").toString("base64");
        vi.stubEnv("SABAH_CREDENTIAL_KEY", masterKey);
        const encrypted = encryptCredential("stored-zai-key", masterKey);
        const db = { aiProviderCredential: { findMany: vi.fn(async () => [{ providerKey: "zai", isEnabled: true, ...encrypted }]) } };

        await expect(resolveRuntimeProviderCredentials(db as never)).resolves.toEqual({ zai: "stored-zai-key" });
    });
});
