import { z } from "zod";

export const evidenceSourceSchema = z.object({
    id: z.string().trim().min(1), checksum: z.string().regex(/^sha256:[A-Za-z0-9_-]+$/), freshness: z.string().datetime(),
    classification: z.literal("authorized"), snippet: z.string().min(1).max(2000),
}).strict();
export const evidencePackSchema = z.object({ sources: z.array(evidenceSourceSchema).min(1).max(50), authorizedSourceIds: z.array(z.string().trim().min(1)).max(50) }).strict();
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;
export type EvidencePack = z.infer<typeof evidencePackSchema>;

export const specialistRequestSchema = z.object({
    workflowId: z.string().trim().min(1), intent: z.string().trim().min(1).max(4000), moduleCount: z.number().int().min(1), itemCount: z.number().int().min(1),
    ambiguity: z.boolean(), confidence: z.number().min(0).max(1), sensitive: z.boolean(), evidence: evidencePackSchema,
}).strict();
export type SpecialistRequest = z.infer<typeof specialistRequestSchema>;

export type ApprovedStep = { capability: string };
export type SpecialistModelOutput = { summary: string; sourceIds: string[]; disagreements: string[] };
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type VerificationTarget = { operationId: string; expectedResult: JsonValue };
export type SpecialistToolContext = {
    signal: AbortSignal;
    read: (service: string) => Promise<unknown>;
    execute: (capability: string, input: JsonValue) => Promise<unknown>;
};
export type SpecialistFinding = SpecialistModelOutput & { roleName: string; canApprove: boolean; canExecute: boolean; writes: number };
