import { z } from "zod";
import { evidencePackSchema, specialistRequestSchema, type SpecialistModelOutput } from "./contracts";

export const SPECIALIST_ROLE_NAMES = ["Retriever", "Planner", "Duplicate Analyst", "Team/KPI Analyst", "Critic", "Executor", "Verifier"] as const;
export type SpecialistRoleName = (typeof SPECIALIST_ROLE_NAMES)[number];
const outputSchema: z.ZodType<SpecialistModelOutput> = z.object({ summary: z.string().max(2000), sourceIds: z.array(z.string()).max(50), disagreements: z.array(z.string().max(500)).max(20) }).strict();
export type SpecialistRole = {
    name: SpecialistRoleName; providerRole: "retriever" | "planner" | "duplicate-analyst" | "team-kpi-analyst" | "critic" | "executor" | "verifier";
    modelRole: "CHAT" | "PLANNER" | "CRITIC"; inputSchema: typeof specialistRequestSchema; outputSchema: typeof outputSchema;
    allowedReadServices: readonly string[]; allowedCapabilities: readonly string[]; timeoutMs: number; maxOutputChars: number; canExecute: boolean; canApprove: boolean;
};
const role = (name: SpecialistRoleName, providerRole: SpecialistRole["providerRole"], modelRole: SpecialistRole["modelRole"], allowedReadServices: readonly string[], allowedCapabilities: readonly string[], canExecute = false, canApprove = false): SpecialistRole => ({
    name, providerRole, modelRole, inputSchema: specialistRequestSchema, outputSchema, allowedReadServices, allowedCapabilities, timeoutMs: 30_000, maxOutputChars: 2_000, canExecute, canApprove,
});
export const SPECIALIST_ROLES: readonly SpecialistRole[] = [
    role("Retriever", "retriever", "CHAT", ["authorized-source-pack"], []), role("Planner", "planner", "PLANNER", ["authorized-source-pack", "workflow-context"], []),
    role("Duplicate Analyst", "duplicate-analyst", "CHAT", ["authorized-source-pack", "duplicate-index"], []), role("Team/KPI Analyst", "team-kpi-analyst", "CHAT", ["authorized-source-pack", "team-kpi-read"], []),
    role("Critic", "critic", "CRITIC", ["authorized-source-pack", "workflow-context"], []), role("Executor", "executor", "PLANNER", ["authorized-source-pack", "workflow-context"], ["tasks.update"], true, false),
    role("Verifier", "verifier", "CHAT", ["authorized-source-pack", "independent-read-back"], []),
];
export function roleByName(name: string): SpecialistRole | undefined { return SPECIALIST_ROLES.find((candidate) => candidate.name === name); }
export { evidencePackSchema };
