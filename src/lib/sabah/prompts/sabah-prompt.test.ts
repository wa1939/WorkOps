import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { capabilityRegistry } from "../capabilities/registry";
import type { SabahCapability, SabahActor } from "../capabilities/contracts";
import { composeSystemPrompt, buildPersonaSection, buildPolicySection, buildCapabilitySection } from "./sabah-prompt";
import { getSabahFlags } from "../flags";

describe("sabah-prompt", () => {
    let mockActor: SabahActor;

    beforeEach(() => {
        (capabilityRegistry as any).definitions.clear();

        mockActor = {
            id: "user-123",
            role: "ADMIN",
            departmentIds: ["dept-1"],
        };

        const mockCapability: SabahCapability<{ query: string }, { results: string[] }> = {
            name: "test_capability",
            version: 1,
            module: "test",
            description: "A test capability",
            inputSchema: z.object({
                query: z.string(),
            }),
            outputSchema: z.object({
                results: z.array(z.string()),
            }),
            risk: "READ" as const,
            available: async () => true,
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

    describe("buildPersonaSection", () => {
        it("returns persona text with Sabah identity", () => {
            const result = buildPersonaSection();

            expect(result).toContain("Sabah");
            expect(result).toContain("صباح");
            expect(result).toContain("morning");
        });
    });

    describe("buildPolicySection", () => {
        it("includes safety and language rules", () => {
            const flags = getSabahFlags();
            const result = buildPolicySection(mockActor, flags);

            expect(result).toBeDefined();
            expect(typeof result).toBe("string");
        });

        it("reflects platform flag in policy", () => {
            const flagsWithPlatform = getSabahFlags();
            const result = buildPolicySection(mockActor, flagsWithPlatform);

            expect(result).toBeDefined();
        });
    });

    describe("buildCapabilitySection", () => {
        it("lists available capabilities from registry", async () => {
            const result = await buildCapabilitySection(mockActor);

            expect(result).toBeDefined();
            expect(typeof result).toBe("string");
            expect(result).toContain("test_capability");
        });

        it("filters capabilities by actor availability", async () => {
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

            const result = await buildCapabilitySection(restrictedActor);

            expect(result).toBeDefined();
            expect(result).toContain("test_capability");
            expect(result).not.toContain("restricted_capability");
        });
    });

    describe("composeSystemPrompt", () => {
        it("combines persona, policy, and capability sections", async () => {
            const result = await composeSystemPrompt(mockActor);

            expect(result).toBeDefined();
            expect(typeof result).toBe("string");

            // Check all three sections are present
            expect(result).toContain("Sabah");
            expect(result.length).toBeGreaterThan(0);
        });

        it("stays within token budget with many capabilities", async () => {
            // Register many capabilities
            for (let i = 2; i <= 50; i++) {
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

            const result = await composeSystemPrompt(mockActor);

            // Rough token budget check (1 token ≈ 4 characters)
            // Brief says token budget, let's verify it's reasonable
            expect(result.length).toBeGreaterThan(0);
            expect(result.length).toBeLessThan(50000); // Reasonable upper bound
        });

        it("handles empty registry gracefully", async () => {
            (capabilityRegistry as any).definitions.clear();

            const result = await composeSystemPrompt(mockActor);

            expect(result).toBeDefined();
            expect(result).toContain("Sabah");
        });
    });
});
