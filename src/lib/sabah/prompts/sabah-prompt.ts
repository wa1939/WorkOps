import { capabilityRegistry } from "../capabilities/registry";
import type { SabahActor } from "../capabilities/contracts";
import type { SabahFlags } from "../flags";

const MAX_CAPABILITIES_IN_PROMPT = 20;
const ESTIMATED_TOKEN_BUDGET = 8000; // Rough budget for capability section

export function buildPersonaSection(): string {
    return `You are **Sabah** (صباح) — the WorkOps team assistant. Sabah means "morning" in Arabic — a friendly persona, warm but concise. You help team members manage their tasks, projects, and KPIs. When asked who you are, introduce yourself as Sabah.`;
}

export function buildPolicySection(actor: SabahActor, flags: SabahFlags): string {
    const sections: string[] = [];

    sections.push("## Behavior Guidelines");

    sections.push("- Respond in the same language the user writes in (Arabic or English). Keep replies short and direct.");
    sections.push("- Use tools to take action. Do not just describe what you would do — execute.");
    sections.push("- If a tool result indicates an error, explain it clearly to the user.");

    if (flags.platform) {
        sections.push("- You have access to a capability registry. Use `listCapabilities` to discover available tools, then `getCapabilityDetails` to see their schemas.");
        sections.push("- All tool calls go through the Sabah platform capability system, which provides safety checks and authorization.");
    }

    sections.push("- You cannot delete anything. You have no delete tool. If asked to delete, explain that deletion is not supported through the AI assistant.");
    sections.push("- You cannot change user roles or access. You have no such tool.");

    sections.push("## Authorization");
    sections.push(`You are acting as: ${actor.role} (ID: ${actor.id})`);
    sections.push("You may only access capabilities available to your role. Restricted capabilities will return an error if unavailable.");

    return sections.join("\n");
}

export async function buildCapabilitySection(actor: SabahActor): Promise<string> {
    const capabilities = await capabilityRegistry.search("", actor);

    if (capabilities.length === 0) {
        return "## Available Capabilities\n\nNo capabilities are available to your current role.";
    }

    // Truncate if too many to fit in token budget
    const displayedCapabilities = capabilities.slice(0, MAX_CAPABILITIES_IN_PROMPT);

    const lines: string[] = ["## Available Capabilities"];
    lines.push("");
    lines.push(`Use \`listCapabilities\` to browse capabilities, and \`getCapabilityDetails\` to see full schemas.`);
    lines.push("");

    // Group by module for better organization
    const byModule = new Map<string, typeof capabilities>();
    for (const cap of displayedCapabilities) {
        if (!byModule.has(cap.module)) {
            byModule.set(cap.module, []);
        }
        byModule.get(cap.module)!.push(cap);
    }

    for (const [module, caps] of Array.from(byModule.entries()).sort()) {
        lines.push(`### ${module}`);
        lines.push("");

        for (const cap of caps) {
            const riskBadge = cap.risk === "DYNAMIC" ? "[DYNAMIC]" : `[${cap.risk}]`;
            lines.push(`- **${cap.name}** (v${cap.version}) ${riskBadge}: ${cap.description}`);
        }
        lines.push("");
    }

    if (capabilities.length > MAX_CAPABILITIES_IN_PROMPT) {
        const remaining = capabilities.length - MAX_CAPABILITIES_IN_PROMPT;
        lines.push(`*... and ${remaining} more. Use \`listCapabilities\` with pagination to see all.*`);
    }

    return lines.join("\n");
}

export async function composeSystemPrompt(actor: SabahActor): Promise<string> {
    const flags: SabahFlags = {
        platform: process.env.SABAH_PLATFORM_ENABLED === "true",
        writes: process.env.SABAH_WRITES_ENABLED === "true",
        memory: process.env.SABAH_MEMORY_ENABLED === "true",
        multimodal: process.env.SABAH_MULTIMODAL_ENABLED === "true",
        monitors: process.env.SABAH_MONITORS_ENABLED === "true",
    };

    const persona = buildPersonaSection();
    const policy = buildPolicySection(actor, flags);
    const capabilities = await buildCapabilitySection(actor);

    const sections: string[] = [];

    sections.push(persona);
    sections.push("");
    sections.push(policy);
    sections.push("");
    sections.push(capabilities);

    const fullPrompt = sections.join("\n");

    // Token budget check (rough estimate: 1 token ≈ 4 characters)
    const estimatedTokens = fullPrompt.length / 4;

    if (estimatedTokens > ESTIMATED_TOKEN_BUDGET) {
        console.warn(`System prompt exceeds token budget: ${estimatedTokens} tokens (budget: ${ESTIMATED_TOKEN_BUDGET})`);
    }

    return fullPrompt;
}
