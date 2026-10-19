import { z } from "zod";
import { capabilityRegistry } from "../capabilities/registry";
import { memoryProposeSchema, playbookProposeSchema, createLearningCapabilities, getLearningDependencies, learningContext } from "@/lib/sabah/capabilities/modules/learning";
import type { SabahActor } from "../capabilities/contracts";

export type ToolResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string };

// Meta-tool input schemas (Zod-validated)
export const ListCapabilitiesInputSchema = z.object({
    query: z.string().optional().describe("Optional search query to filter capabilities"),
    module: z.string().nullable().optional().describe("Optional module filter (null for all modules)"),
    limit: z.number().min(1).max(100).default(20).describe("Max results to return (1-100)"),
    offset: z.number().min(0).default(0).describe("Pagination offset"),
});

export const GetCapabilityDetailsInputSchema = z.object({
    name: z.string().min(1).describe("Capability name"),
    version: z.number().int().positive().optional().describe("Capability version (defaults to highest)"),
});

export const ProposeMemoryOrPlaybookUpdateInputSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("memory"), proposal: memoryProposeSchema }).strict(),
    z.object({ kind: z.literal("playbook"), proposal: playbookProposeSchema }).strict(),
]);

export type ListCapabilitiesInput = z.infer<typeof ListCapabilitiesInputSchema>;
export type GetCapabilityDetailsInput = z.infer<typeof GetCapabilityDetailsInputSchema>;

// Output types
export type CapabilitySummary = {
    name: string;
    version: number;
    module: string;
    description: string;
    risk: string;
};

export type CapabilityDetails = CapabilitySummary & {
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
};

export type PaginatedCapabilities = {
    items: CapabilitySummary[];
    total: number;
    hasMore: boolean;
};

// Meta-tool handlers
export async function listCapabilities(
    actor: SabahActor,
    args: ListCapabilitiesInput
): Promise<ToolResult<PaginatedCapabilities>> {
    try {
        const parsed = ListCapabilitiesInputSchema.parse(args);

        // Get all available capabilities for this actor
        let allCapabilities: Array<{ name: string; version: number; module: string; description: string; risk: string }> = [];

        // Use registry search with empty query to get all available capabilities
        const searchResults = await capabilityRegistry.searchAll("", actor);

        // Convert to our internal format
        allCapabilities = searchResults.map((cap) => ({
            name: cap.name,
            version: cap.version,
            module: cap.module,
            description: cap.description,
            risk: cap.risk,
        }));

        // Apply module filter if provided
        if (parsed.module !== null && parsed.module !== undefined) {
            allCapabilities = allCapabilities.filter((cap) => cap.module === parsed.module);
        }

        // Apply query filter if provided
        if (parsed.query && parsed.query.trim().length > 0) {
            const queryLower = parsed.query.toLowerCase().trim();
            allCapabilities = allCapabilities.filter((cap) => {
                return (
                    cap.name.toLowerCase().includes(queryLower) ||
                    cap.module.toLowerCase().includes(queryLower) ||
                    cap.description.toLowerCase().includes(queryLower)
                );
            });
        }

        // Get total before pagination
        const total = allCapabilities.length;

        // Apply pagination
        const items = allCapabilities.slice(parsed.offset, parsed.offset + parsed.limit);

        return {
            ok: true,
            data: {
                items,
                total,
                hasMore: parsed.offset + items.length < total,
            },
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

export async function proposeMemoryOrPlaybookUpdate(
    _actor: SabahActor,
    args: z.input<typeof ProposeMemoryOrPlaybookUpdateInputSchema>,
): Promise<ToolResult<{ kind: "memory" | "playbook"; proposal: Record<string, unknown>; requiresHumanApproval: true }>> {
    try {
        const parsed = ProposeMemoryOrPlaybookUpdateInputSchema.parse(args);
        const capability = createLearningCapabilities(getLearningDependencies()).proposeMemoryOrPlaybookUpdate;
        const input = capability.inputSchema.parse(parsed);
        if (!await capability.available(_actor)) return { ok: false, error: "Learning proposal capability is unavailable." };
        await capability.authorize(input, learningContext(_actor, "meta-proposal"));
        const proposal = await capability.execute(input, learningContext(_actor, "meta-proposal"));
        return { ok: true, data: proposal };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Invalid proposal" };
    }
}

export async function getCapabilityDetails(
    actor: SabahActor,
    args: GetCapabilityDetailsInput
): Promise<ToolResult<CapabilityDetails>> {
    try {
        const parsed = GetCapabilityDetailsInputSchema.parse(args);

        // First check if capability exists (regardless of availability)
        try {
            capabilityRegistry.resolve(parsed.name, parsed.version);
        } catch (error) {
            // Capability doesn't exist
            const versionStr = parsed.version ? `@${parsed.version}` : "";
            return {
                ok: false,
                error: `Capability '${parsed.name}${versionStr}' not found`,
            };
        }

        // Now check availability and get full details
        const descriptions = await capabilityRegistry.describe(
            [{ name: parsed.name, version: parsed.version }],
            actor
        );

        if (descriptions.length === 0) {
            // Capability exists but not available to this actor
            const versionStr = parsed.version ? `@${parsed.version}` : "";
            return {
                ok: false,
                error: `Capability '${parsed.name}${versionStr}' not available to you`,
            };
        }

        const desc = descriptions[0];

        return {
            ok: true,
            data: {
                name: desc.name,
                version: desc.version,
                module: desc.module,
                description: desc.description,
                risk: desc.risk,
                inputSchema: desc.inputJsonSchema,
                outputSchema: desc.outputJsonSchema,
            },
        };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
