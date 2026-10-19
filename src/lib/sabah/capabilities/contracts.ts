import { z } from "zod";
import { assertCapabilityAllowed } from "../security/hard-boundaries";

export const CAPABILITY_RISKS = [
    "READ",
    "DRAFT",
    "REVERSIBLE_WRITE",
    "BULK_WRITE",
    "SENSITIVE_WRITE",
    "BLOCKED",
] as const;

export type CapabilityRisk = (typeof CAPABILITY_RISKS)[number];
export type ApprovalMode = "SMART" | "MANUAL" | "FAST";

export type SabahActor = {
    id: string;
    role: "ADMIN" | "LEAD" | "MEMBER" | "VIEWER";
    departmentIds: string[];
};

export type CapabilityContext = {
    actor: SabahActor;
    requestId: string;
    /** Persisted workflow-step primary key, distinct from request correlation. */
    stepId?: string;
    conversationId: string | null;
    workflowId: string | null;
    now: Date;
    signal?: AbortSignal;
    /** Parsed request input made available only to post-write verification. */
    input?: unknown;
    idempotencyKey?: string;
    duplicateDb?: import("@/lib/sabah/intelligence/duplicates").DuplicateDb;
};

export type CapabilityPreview = {
    title: string;
    fields: Array<{
        path: string;
        current?: unknown;
        proposed?: unknown;
        source?: string;
    }>;
    warnings?: string[];
    duplicateChoices?: Array<{
        action: "USE_EXISTING" | "UPDATE_EXISTING" | "LINK" | "MERGE" | "CREATE_SEPARATELY";
        entityType: "PROJECT" | "TASK";
        entityId: string;
        label: string;
        requiresReason: boolean;
    }>;
};

export type CapabilityResult<T> = {
    value: T;
    entityLinks: Array<{
        type: string;
        id: string;
        href: string;
        label: string;
    }>;
    reversible: boolean;
};

export type SabahCapability<I, O> = {
    name: string;
    version: number;
    module: string;
    description: string;
    risk: CapabilityRisk | ((input: I, context: CapabilityContext) => CapabilityRisk);
    requiresExplicitApproval?: boolean;
    inputSchema: z.ZodType<I>;
    outputSchema: z.ZodType<O>;
    available(actor: SabahActor): Promise<boolean>;
    authorize(input: I, context: CapabilityContext): Promise<void>;
    preview(input: I, context: CapabilityContext): Promise<CapabilityPreview>;
    execute(input: I, context: CapabilityContext): Promise<O>;
    verify(output: O, context: CapabilityContext): Promise<O>;
    compensate?(output: O, context: CapabilityContext): Promise<void>;
    summarize(output: O): string;
};

const REQUIRED_METADATA = ["name", "module", "description"] as const;
const REQUIRED_OPERATIONS = [
    "available",
    "authorize",
    "preview",
    "execute",
    "verify",
    "summarize",
] as const;

export function defineCapability<I, O>(definition: SabahCapability<I, O>): SabahCapability<I, O> {
    const candidate = definition as unknown as Record<string, unknown>;

    assertCapabilityAllowed(definition.name);

    for (const field of REQUIRED_METADATA) {
        if (typeof candidate[field] !== "string" || candidate[field].trim().length === 0) {
            throw new Error(`Capability ${field} must be non-empty`);
        }
    }

    for (const operation of REQUIRED_OPERATIONS) {
        if (typeof candidate[operation] !== "function") {
            throw new Error(`Capability ${String(candidate.name)} must define ${operation}`);
        }
    }

    return definition;
}
