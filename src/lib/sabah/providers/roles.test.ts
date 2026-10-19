import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    InvalidModelAssignmentConfigError,
    parseModelAssignmentConfig,
    resolveModelForRole,
    type ModelAssignmentDb,
} from "./roles";

// Fake prisma mock that returns data based on our test needs
const mockPrisma = {
    aiModelAssignment: {
        findUnique: vi.fn(),
    },
};

describe("resolveModelForRole", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("prefers DB assignment over env var fallback", async () => {
        // DB has assignment
        mockPrisma.aiModelAssignment.findUnique.mockResolvedValue({
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-4.5-flash",
            configJson: '{"temperature":0.3}',
        });

        // Env var also set but should be ignored
        process.env.GLM_API_KEY = "env-key-ignored";

        const result = await resolveModelForRole("CHAT", mockPrisma as any);

        expect(result).toEqual({
            providerKey: "zai",
            modelName: "glm-4.5-flash",
            config: { temperature: 0.3 },
        });

        delete process.env.GLM_API_KEY;
    });

    it("falls back to env var when DB assignment missing", async () => {
        // DB has no assignment
        mockPrisma.aiModelAssignment.findUnique.mockResolvedValue(null);

        // Env var set
        process.env.GLM_API_KEY = "env-key-fallback";

        const result = await resolveModelForRole("CHAT", mockPrisma as any);

        expect(result).toEqual({
            providerKey: "zai",
            modelName: "glm-4.5-flash",
            config: {},
        });

        delete process.env.GLM_API_KEY;
    });

    it("falls back to hardcoded safe default when DB and env both missing", async () => {
        // DB has no assignment
        mockPrisma.aiModelAssignment.findUnique.mockResolvedValue(null);

        // No env var
        delete process.env.GLM_API_KEY;

        const result = await resolveModelForRole("CHAT", mockPrisma as any);

        // Should return safe default (no actual key, just model info)
        expect(result).toEqual({
            providerKey: "zai",
            modelName: "glm-4.5-flash",
            config: {},
        });
    });

    it("uses GLM-5.3-Flash for native Vision and OCR fallback roles", async () => {
        delete process.env.GLM_API_KEY;
        const noAssignmentDb: ModelAssignmentDb = {
            aiModelAssignment: { findUnique: async () => null },
        };

        await expect(resolveModelForRole("VISION", noAssignmentDb)).resolves.toMatchObject({
            providerKey: "zai",
            modelName: "glm-5.3-flash",
        });
        await expect(resolveModelForRole("OCR", noAssignmentDb)).resolves.toMatchObject({
            providerKey: "zai",
            modelName: "glm-5.3-flash",
        });
    });

    it("resolves different roles independently", async () => {
        mockPrisma.aiModelAssignment.findUnique.mockImplementation(async ({ where }) => {
            if (where.role === "CHAT") {
                return { role: "CHAT", providerKey: "zai", modelName: "glm-4.5-flash", configJson: null };
            }
            if (where.role === "VISION") {
                return { role: "VISION", providerKey: "zai", modelName: "glm-4.5-vision", configJson: null };
            }
            return null;
        });

        const chatResult = await resolveModelForRole("CHAT", mockPrisma as any);
        const visionResult = await resolveModelForRole("VISION", mockPrisma as any);

        expect(chatResult.modelName).toBe("glm-4.5-flash");
        expect(visionResult.modelName).toBe("glm-4.5-vision");
    });

    it("parses configJson when present", async () => {
        mockPrisma.aiModelAssignment.findUnique.mockResolvedValue({
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            configJson: '{"temperature":0.7,"maxTokens":4000}',
        });

        const result = await resolveModelForRole("CHAT", mockPrisma as any);

        expect(result.config).toEqual({
            temperature: 0.7,
            maxTokens: 4000,
        });
    });

    it("uses empty config when configJson is null", async () => {
        mockPrisma.aiModelAssignment.findUnique.mockResolvedValue({
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-4.5-flash",
            configJson: null,
        });

        const result = await resolveModelForRole("CHAT", mockPrisma as any);

        expect(result.config).toEqual({});
    });

    it("supports all role enum values", async () => {
        const roles = ["CHAT", "PLANNER", "CRITIC", "COMPRESSION", "VISION", "OCR", "ASR", "EMBEDDING"] as const;

        for (const role of roles) {
            mockPrisma.aiModelAssignment.findUnique.mockResolvedValue({
                role,
                providerKey: "zai",
                modelName: "glm-4.5-flash",
                configJson: null,
            });

            const result = await resolveModelForRole(role, mockPrisma as any);
            expect(result.providerKey).toBe("zai");
        }
    });

    it("returns an ordered fallback list, including multiple models from one provider", async () => {
        mockPrisma.aiModelAssignment.findUnique.mockResolvedValue({
            role: "CHAT",
            providerKey: "zai",
            modelName: "glm-5",
            configJson: JSON.stringify({
                fallbacks: [
                    { providerKey: "zai", modelName: "glm-4.5" },
                    { providerKey: "zai", modelName: "glm-4.5-air" },
                ],
            }),
        });

        await expect(resolveModelForRole("CHAT", mockPrisma as any)).resolves.toEqual({
            providerKey: "zai",
            modelName: "glm-5",
            config: {
                fallbacks: [
                    { providerKey: "zai", modelName: "glm-4.5" },
                    { providerKey: "zai", modelName: "glm-4.5-air" },
                ],
            },
        });
    });
});

describe("parseModelAssignmentConfig fallback limits", () => {
    it("rejects more than four fallback targets", () => {
        expect(() => parseModelAssignmentConfig("CHAT", JSON.stringify({
            fallbacks: [
                { providerKey: "zai", modelName: "glm-5" },
                { providerKey: "zai", modelName: "glm-5.3" },
                { providerKey: "zai", modelName: "glm-5.3-flash" },
                { providerKey: "zai", modelName: "glm-4.7" },
                { providerKey: "zai", modelName: "glm-4.5" },
            ],
        }))).toThrow(InvalidModelAssignmentConfigError);
    });

    it("rejects duplicate provider/model identities but permits different models from one provider", () => {
        expect(() => parseModelAssignmentConfig("CHAT", JSON.stringify({
            fallbacks: [
                { providerKey: "zai", modelName: "glm-4.5" },
                { providerKey: "zai", modelName: "glm-4.5" },
            ],
        }))).toThrow(/duplicated/i);

        expect(parseModelAssignmentConfig("CHAT", JSON.stringify({
            fallbacks: [
                { providerKey: "zai", modelName: "glm-4.5" },
                { providerKey: "zai", modelName: "glm-4.5-air" },
            ],
        }))).toMatchObject({
            fallbacks: [
                { providerKey: "zai", modelName: "glm-4.5" },
                { providerKey: "zai", modelName: "glm-4.5-air" },
            ],
        });
    });
});
