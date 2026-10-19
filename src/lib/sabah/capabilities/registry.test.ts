import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
    CapabilityRegistry,
    CapabilitySummary,
    CapabilityDescription,
} from "./registry";
import {
    defineCapability,
    CAPABILITY_RISKS,
    type SabahCapability,
    type SabahActor,
} from "./contracts";

const adminActor: SabahActor = {
    id: "admin-1",
    role: "ADMIN",
    departmentIds: ["dept-1"],
};

const viewerActor: SabahActor = {
    id: "viewer-1",
    role: "VIEWER",
    departmentIds: ["dept-1"],
};

const readCapability = defineCapability({
    name: "tasks.read",
    version: 1,
    module: "tasks",
    description: "Read tasks",
    risk: "READ",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ title: z.string() }),
    available: async () => true,
    authorize: async () => {},
    preview: async () => ({
        title: "Preview",
        fields: [],
    }),
    execute: async () => ({ title: "Test Task" }),
    verify: async (output) => output,
    summarize: () => "Task read",
});

const adminOnlyCapability = defineCapability({
    name: "tasks.adminOnly",
    version: 1,
    module: "tasks",
    description: "Admin-only operation",
    risk: "SENSITIVE_WRITE",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ success: z.boolean() }),
    available: async (actor) => actor.role === "ADMIN",
    authorize: async () => {},
    preview: async () => ({
        title: "Admin preview",
        fields: [],
    }),
    execute: async () => ({ success: true }),
    verify: async (output) => output,
    summarize: () => "Admin operation completed",
});

const writeCapability = defineCapability({
    name: "tasks.write",
    version: 1,
    module: "tasks",
    description: "Write tasks",
    risk: "REVERSIBLE_WRITE",
    inputSchema: z.object({ title: z.string() }),
    outputSchema: z.object({ id: z.string() }),
    available: async () => true,
    authorize: async () => {},
    preview: async () => ({
        title: "Write preview",
        fields: [],
    }),
    execute: async () => ({ id: "task-1" }),
    verify: async (output) => output,
    summarize: () => "Task written",
});

describe("CapabilityRegistry", () => {
    let registry: CapabilityRegistry;

    beforeEach(() => {
        registry = new CapabilityRegistry();
    });

    describe("register", () => {
        it("registers capabilities with name and version", () => {
            registry.register(readCapability);
            const resolved = registry.resolve("tasks.read", 1);
            expect(resolved).toBe(readCapability);
        });

        it("rejects duplicate name and version registrations", () => {
            registry.register(readCapability);
            expect(() => registry.register(readCapability)).toThrow(
                "tasks.read@1 already registered"
            );
        });

        it("allows same name with different versions", () => {
            const v2Capability = {
                ...readCapability,
                version: 2,
            } as SabahCapability<unknown, unknown>;

            registry.register(readCapability);
            registry.register(v2Capability);

            expect(registry.resolve("tasks.read", 1)).toBe(readCapability);
            expect(registry.resolve("tasks.read", 2)).toBe(v2Capability);
        });
    });

    describe("resolve", () => {
        beforeEach(() => {
            registry.register(readCapability);
            registry.register(
                {
                    ...readCapability,
                    version: 2,
                } as SabahCapability<unknown, unknown>
            );
            registry.register(
                {
                    ...readCapability,
                    version: 3,
                } as SabahCapability<unknown, unknown>
            );
        });

        it("resolves exact version when specified", () => {
            const resolved = registry.resolve("tasks.read", 1);
            expect(resolved.version).toBe(1);
        });

        it("resolves highest version when no version specified", () => {
            const resolved = registry.resolve("tasks.read");
            expect(resolved.version).toBe(3);
        });

        it("throws for non-existent capability", () => {
            expect(() => registry.resolve("non.existent")).toThrow();
        });

        it("throws for non-existent version", () => {
            expect(() => registry.resolve("tasks.read", 999)).toThrow();
        });
    });

    describe("search", () => {
        beforeEach(() => {
            registry.register(readCapability);
            registry.register(writeCapability);
            registry.register(adminOnlyCapability);
        });

        it("matches by name", async () => {
            const results = await registry.search("read", adminActor);
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("tasks.read");
        });

        it("matches by module", async () => {
            const results = await registry.search("tasks", adminActor);
            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.module).toContain("tasks");
            });
        });

        it("matches by description", async () => {
            const results = await registry.search("admin", adminActor);
            expect(results.length).toBeGreaterThan(0);
            results.forEach((result) => {
                expect(result.description.toLowerCase()).toContain("admin");
            });
        });

        it("does not return unavailable capabilities", async () => {
            const results = await registry.search("task", viewerActor);
            expect(results.map((item) => item.name)).not.toContain(
                "tasks.adminOnly"
            );
        });

        it("returns metadata only, never executor functions", async () => {
            const results = await registry.search("task", adminActor);
            results.forEach((result: CapabilitySummary) => {
                expect(result).toHaveProperty("name");
                expect(result).toHaveProperty("version");
                expect(result).toHaveProperty("module");
                expect(result).toHaveProperty("description");
                expect(result).toHaveProperty("risk");

                // Executor functions should NOT be present
                expect(result).not.toHaveProperty("available");
                expect(result).not.toHaveProperty("authorize");
                expect(result).not.toHaveProperty("preview");
                expect(result).not.toHaveProperty("execute");
                expect(result).not.toHaveProperty("verify");
                expect(result).not.toHaveProperty("compensate");
                expect(result).not.toHaveProperty("summarize");
            });
        });

        it("returns at most 20 entries", async () => {
            // Register many capabilities
            for (let i = 0; i < 30; i++) {
                registry.register({
                    ...readCapability,
                    name: `capability.${i}`,
                    version: 1,
                } as SabahCapability<unknown, unknown>);
            }

            const results = await registry.search("capability", adminActor);
            expect(results.length).toBeLessThanOrEqual(20);
        });

        it("normalizes query text before matching", async () => {
            // Case insensitive matching
            const upperCase = await registry.search("READ", adminActor);
            const lowerCase = await registry.search("read", adminActor);
            expect(upperCase).toEqual(lowerCase);
        });
    });

    describe("describe", () => {
        beforeEach(() => {
            registry.register(readCapability);
            registry.register(writeCapability);
            registry.register(adminOnlyCapability);
        });

        it("returns descriptions for available capabilities", async () => {
            const results = await registry.describe(
                [{ name: "tasks.read", version: 1 }],
                adminActor
            );

            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("tasks.read");
            expect(results[0].version).toBe(1);
            expect(results[0].inputJsonSchema).toBeDefined();
            expect(results[0].outputJsonSchema).toBeDefined();
        });

        it("does not return descriptions for unavailable capabilities", async () => {
            const results = await registry.describe(
                [{ name: "tasks.adminOnly", version: 1 }],
                viewerActor
            );

            expect(results).toHaveLength(0);
        });

        it("includes JSON Schema generated from Zod schemas", async () => {
            const results = await registry.describe(
                [{ name: "tasks.read", version: 1 }],
                adminActor
            );

            expect(results[0].inputJsonSchema).toHaveProperty("type");
            expect(results[0].inputJsonSchema).toHaveProperty("properties");
            expect(results[0].outputJsonSchema).toHaveProperty("type");
            expect(results[0].outputJsonSchema).toHaveProperty("properties");
        });

        it("includes risk metadata in descriptions", async () => {
            const results = await registry.describe(
                [{ name: "tasks.adminOnly", version: 1 }],
                adminActor
            );

            expect(results[0].risk).toBe("SENSITIVE_WRITE");
        });

        it("never returns implementation functions in descriptions", async () => {
            const results = await registry.describe(
                [{ name: "tasks.read", version: 1 }],
                adminActor
            );

            results.forEach((result: CapabilityDescription) => {
                expect(result).toHaveProperty("name");
                expect(result).toHaveProperty("version");
                expect(result).toHaveProperty("inputJsonSchema");
                expect(result).toHaveProperty("outputJsonSchema");

                // Implementation functions should NOT be present
                expect(result).not.toHaveProperty("available");
                expect(result).not.toHaveProperty("authorize");
                expect(result).not.toHaveProperty("preview");
                expect(result).not.toHaveProperty("execute");
                expect(result).not.toHaveProperty("verify");
                expect(result).not.toHaveProperty("compensate");
                expect(result).not.toHaveProperty("summarize");
            });
        });

        it("handles missing capabilities gracefully", async () => {
            const results = await registry.describe(
                [{ name: "non.existent", version: 1 }],
                adminActor
            );

            expect(results).toHaveLength(0);
        });

        it("resolves highest version when version omitted", async () => {
            registry.register({
                ...readCapability,
                name: "tasks.multiVersion",
                version: 1,
            } as SabahCapability<unknown, unknown>);
            registry.register({
                ...readCapability,
                name: "tasks.multiVersion",
                version: 2,
            } as SabahCapability<unknown, unknown>);

            const results = await registry.describe(
                [{ name: "tasks.multiVersion" }],
                adminActor
            );

            expect(results).toHaveLength(1);
            expect(results[0].version).toBe(2);
        });

        it("returns descriptions for multiple capabilities", async () => {
            const results = await registry.describe(
                [
                    { name: "tasks.read", version: 1 },
                    { name: "tasks.write", version: 1 },
                ],
                adminActor
            );

            expect(results).toHaveLength(2);
            expect(results.map((r) => r.name)).toEqual([
                "tasks.read",
                "tasks.write",
            ]);
        });
    });
});