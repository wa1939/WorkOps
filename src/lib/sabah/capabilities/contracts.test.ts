import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability } from "./contracts";

const baseCapability = () => ({
    name: "tasks.create",
    version: 1,
    module: "tasks",
    description: "Create a task",
    risk: "REVERSIBLE_WRITE" as const,
    inputSchema: z.object({ title: z.string() }),
    outputSchema: z.object({ id: z.string() }),
    available: async () => true,
    authorize: async () => undefined,
    preview: async ({ title }: { title: string }) => ({ title, fields: [] }),
    execute: async () => ({ id: "task-1" }),
    verify: async (output: { id: string }) => output,
    summarize: ({ id }: { id: string }) => `Created ${id}`,
});

describe("defineCapability", () => {
    it("rejects a capability without a verifier", () => {
        expect(() => defineCapability({
            name: "tasks.create",
            version: 1,
            module: "tasks",
            description: "Create a task",
            risk: "REVERSIBLE_WRITE",
            inputSchema: z.object({ title: z.string() }),
            outputSchema: z.object({ id: z.string() }),
            available: async () => true,
            authorize: async () => undefined,
            preview: async ({ title }: { title: string }) => ({ title, fields: [] }),
            execute: async () => ({ id: "task-1" }),
            summarize: ({ id }: { id: string }) => `Created ${id}`,
        } as never)).toThrow(/verify/i);
    });

    it.each(["available", "authorize", "preview", "execute", "verify", "summarize"])(
        "rejects a capability without %s",
        (requiredField) => {
            const definition = baseCapability() as Record<string, unknown>;
            delete definition[requiredField];

            expect(() => defineCapability(definition as never)).toThrow(new RegExp(requiredField));
        },
    );

    it.each(["name", "module", "description"])("rejects empty %s metadata", (metadataField) => {
        const definition = { ...baseCapability(), [metadataField]: "   " };

        expect(() => defineCapability(definition as never)).toThrow(new RegExp(metadataField));
    });

    it("returns a complete capability definition unchanged", () => {
        const definition = baseCapability();

        expect(defineCapability(definition)).toBe(definition);
    });
});
