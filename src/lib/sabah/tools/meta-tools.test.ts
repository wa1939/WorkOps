import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { capabilityRegistry } from "../capabilities/registry";
import { SabahCapability, SabahActor, CapabilityRisk, CapabilityContext } from "../capabilities/contracts";
import { listCapabilities, getCapabilityDetails } from "./meta-tools";

describe("meta-tools", () => {
    let mockActor: SabahActor;
    let mockCapability: SabahCapability<{ query: string }, { results: string[] }>;
    let mockContext: CapabilityContext;

    beforeEach(() => {
        // Clear the registry before each test
        (capabilityRegistry as any).definitions.clear();

        mockActor = {
            id: "user-123",
            role: "MEMBER",
            departmentIds: ["dept-1"],
        };

        mockContext = {
            actor: mockActor,
            requestId: "req-1",
            conversationId: null,
            workflowId: null,
            now: new Date(),
        };

        mockCapability = {
            name: "test_capability",
            version: 1,
            module: "test",
            description: "A test capability",
            risk: "READ" as const,
            inputSchema: z.object({
                query: z.string(),
            }),
            outputSchema: z.object({
                results: z.array(z.string()),
            }),
            available: async (actor) => true,
            authorize: async () => {},
            preview: async () => ({ title: "Test Preview", fields: [] }),
            execute: async (input) => ({ results: [input.query] }),
            verify: async (output) => output,
            summarize: (output) => `Found ${output.results.length} results`,
        };

        capabilityRegistry.register(mockCapability);
    });

    afterEach(() => {
        (capabilityRegistry as any).definitions.clear();
    });

    describe("listCapabilities", () => {
        it("returns available capabilities paged with limit", async () => {
            const result = await listCapabilities(mockActor, {
                query: "",
                module: null,
                limit: 10,
                offset: 0,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.items).toHaveLength(1);
                expect(result.data.items[0]).toEqual({
                    name: "test_capability",
                    version: 1,
                    module: "test",
                    description: "A test capability",
                    risk: "READ",
                });
                expect(result.data.total).toBe(1);
                expect(result.data.hasMore).toBe(false);
            }
        });

        it("filters by module when provided", async () => {
            const result = await listCapabilities(mockActor, {
                query: "",
                module: "test",
                limit: 10,
                offset: 0,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.items).toHaveLength(1);
                expect(result.data.items[0].module).toBe("test");
            }
        });

        it("returns empty list when module filter doesn't match", async () => {
            const result = await listCapabilities(mockActor, {
                query: "",
                module: "other",
                limit: 10,
                offset: 0,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.items).toHaveLength(0);
            }
        });

        it("respects actor authorization", async () => {
            const restrictedActor: SabahActor = {
                id: "user-456",
                role: "MEMBER",
                departmentIds: ["dept-1"],
            };

            const restrictedCapability: SabahCapability<{}, { results: string[] }> = {
                name: "restricted_capability",
                version: 1,
                module: "test",
                description: "A restricted capability",
                inputSchema: z.object({}),
                outputSchema: z.object({
                    results: z.array(z.string()),
                }),
                risk: "REVERSIBLE_WRITE" as const,
                available: async (actor) => actor.role === "ADMIN" || actor.role === "LEAD",
                authorize: async () => {},
                preview: async () => ({ title: "Test Preview", fields: [] }),
                execute: async () => ({ results: [] }),
                verify: async (output) => output,
                summarize: () => "Restricted result",
            };

            capabilityRegistry.register(restrictedCapability);

            const result = await listCapabilities(restrictedActor, {
                query: "",
                module: null,
                limit: 10,
                offset: 0,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.items).toHaveLength(1);
                expect(result.data.items[0].name).toBe("test_capability");
                expect(result.data.items.every((c) => c.name !== "restricted_capability")).toBe(true);
            }
        });

        it("implements paging with offset", async () => {
            // Register more capabilities
            for (let i = 2; i <= 15; i++) {
                capabilityRegistry.register({
                    name: `capability_${i}`,
                    version: 1,
                    module: "test",
                    description: `Capability ${i}`,
                    inputSchema: z.object({}),
                    outputSchema: z.object({}),
                    risk: "READ" as const,
                    available: async () => true,
                    authorize: async () => {},
                    preview: async () => ({ title: `Preview ${i}`, fields: [] }),
                    execute: async () => ({}),
                    verify: async (output) => output,
                    summarize: () => `Summary ${i}`,
                });
            }

            const result1 = await listCapabilities(mockActor, {
                query: "",
                module: "test",
                limit: 5,
                offset: 0,
            });

            expect(result1.ok).toBe(true);
            if (result1.ok) {
                expect(result1.data.items).toHaveLength(5);
                expect(result1.data.hasMore).toBe(true);
                expect(result1.data.total).toBe(15);
            }

            const result2 = await listCapabilities(mockActor, {
                query: "",
                module: "test",
                limit: 5,
                offset: 5,
            });

            expect(result2.ok).toBe(true);
            if (result2.ok) {
                expect(result2.data.items).toHaveLength(5);
                expect(result2.data.hasMore).toBe(true);
            }

            const result3 = await listCapabilities(mockActor, {
                query: "",
                module: "test",
                limit: 5,
                offset: 10,
            });

            expect(result3.ok).toBe(true);
            if (result3.ok) {
                expect(result3.data.items).toHaveLength(5);
                expect(result3.data.hasMore).toBe(false);
            }
        });

        it("reports complete actor-authorized totals beyond the registry default page", async () => {
            for (let i = 2; i <= 25; i++) {
                capabilityRegistry.register({
                    name: `capability_${i}`,
                    version: 1,
                    module: "test",
                    description: `Capability ${i}`,
                    inputSchema: z.object({}),
                    outputSchema: z.object({}),
                    risk: "READ" as const,
                    available: async () => true,
                    authorize: async () => {},
                    preview: async () => ({ title: `Preview ${i}`, fields: [] }),
                    execute: async () => ({}),
                    verify: async (output) => output,
                    summarize: () => `Summary ${i}`,
                });
            }

            const result = await listCapabilities(mockActor, {
                query: "capability_",
                module: "test",
                limit: 5,
                offset: 20,
            });

            expect(result).toEqual(expect.objectContaining({
                ok: true,
                data: expect.objectContaining({ total: 24, hasMore: false }),
            }));
            if (result.ok) expect(result.data.items).toHaveLength(4);
        });
    });

    describe("getCapabilityDetails", () => {
        it("returns full capability details including schemas", async () => {
            const result = await getCapabilityDetails(mockActor, {
                name: "test_capability",
                version: 1,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data).toEqual({
                    name: "test_capability",
                    version: 1,
                    module: "test",
                    description: "A test capability",
                    risk: "READ",
                    inputSchema: expect.objectContaining({
                        type: "object",
                        properties: expect.objectContaining({
                            query: expect.any(Object),
                        }),
                    }),
                    outputSchema: expect.objectContaining({
                        type: "object",
                        properties: expect.objectContaining({
                            results: expect.any(Object),
                        }),
                    }),
                });
            }
        });

        it("returns typed error for unknown capability", async () => {
            const result = await getCapabilityDetails(mockActor, {
                name: "unknown_capability",
                version: 1,
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("Capability 'unknown_capability@1' not found");
            }
        });

        it("returns typed error when capability not available to actor", async () => {
            const restrictedActor: SabahActor = {
                id: "user-456",
                role: "MEMBER",
                departmentIds: ["dept-1"],
            };

            const restrictedCapability: SabahCapability<{}, {}> = {
                name: "restricted_capability",
                version: 1,
                module: "test",
                description: "A restricted capability",
                inputSchema: z.object({}),
                outputSchema: z.object({}),
                risk: "SENSITIVE_WRITE" as const,
                available: async (actor) => actor.role === "ADMIN" || actor.role === "LEAD",
                authorize: async () => {},
                preview: async () => ({ title: "Test Preview", fields: [] }),
                execute: async () => ({}),
                verify: async (output) => output,
                summarize: () => "Restricted result",
            };

            capabilityRegistry.register(restrictedCapability);

            const result = await getCapabilityDetails(restrictedActor, {
                name: "restricted_capability",
                version: 1,
            });

            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error).toBe("Capability 'restricted_capability@1' not available to you");
            }
        });

        it("returns highest version when version not specified", async () => {
            capabilityRegistry.register({
                ...mockCapability,
                version: 2,
                description: "Version 2 of test capability",
            });

            const result = await getCapabilityDetails(mockActor, {
                name: "test_capability",
                version: undefined,
            });

            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.data.version).toBe(2);
                expect(result.data.description).toBe("Version 2 of test capability");
            }
        });
    });
});
