import { prisma } from "@/lib/prisma";
import { configuredAiTarget } from "./provider-config";
import type { AiProvider, GLMModel } from "@/lib/glm";
import {
    resolveModelForRole,
    isSupportedModelTarget,
    MAX_MODEL_FALLBACKS,
    type ModelAssignment,
    type ModelAssignmentDb,
    type ModelTarget,
} from "@/lib/sabah/providers/roles";
import {
    resolveRuntimeProviderCredentials,
    type RuntimeProviderCredentials,
} from "@/lib/sabah/providers/admin-service";

/** Default operational target shared by copilot and background estimation. */
export const DEFAULT_OPERATIONAL_MODEL: Readonly<ModelTarget> = {
    providerKey: "zai",
    modelName: "glm-5.3-flash",
};

/**
 * Bounded automatic order: one lower-cost/supported GLM alternative, then Nuha.
 * The adapter drops targets without a configured credential; this list never
 * invents credentials or probes arbitrary endpoints.
 */
export const DEFAULT_OPERATIONAL_FALLBACKS: ReadonlyArray<ModelTarget> = [
    { providerKey: "zai", modelName: "glm-4.5-flash" },
    { providerKey: "nuha", modelName: "Nuha-2.1" },
];

export interface OperationalAiTarget {
    provider: AiProvider;
    model: GLMModel;
    fallbacks: ReadonlyArray<ModelTarget>;
    credentials: RuntimeProviderCredentials;
}

export type OperationalAiDatabase = ModelAssignmentDb & {
    aiProviderCredential: NonNullable<Parameters<typeof resolveRuntimeProviderCredentials>[0]>["aiProviderCredential"];
};


function isSupportedOperationalTarget(providerKey: string, modelName: string): boolean {
    return isSupportedModelTarget("CHAT", providerKey, modelName);
}

function automaticFallbacks(provider: AiProvider): ReadonlyArray<ModelTarget> {
    if (provider !== "zai" && provider !== "nuha") return [];
    // Nuha is the ultimate fallback for the default GLM-first route. If an
    // administrator explicitly makes Nuha primary, retain a bounded GLM escape
    // hatch rather than recursively selecting Nuha again.
    return provider === "nuha" ? [DEFAULT_OPERATIONAL_MODEL] : DEFAULT_OPERATIONAL_FALLBACKS;
}

function validateConfiguredFallbacks(value: unknown): ReadonlyArray<ModelTarget> | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > MAX_MODEL_FALLBACKS) {
        throw new Error("Configured CHAT fallbacks are invalid");
    }
    const seen = new Set<string>();
    return value.map((candidate, index) => {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
            throw new Error(`Configured CHAT fallback ${index + 1} is invalid`);
        }
        const target = candidate as { providerKey?: unknown; modelName?: unknown };
        const providerKey = target.providerKey;
        const modelName = target.modelName;
        if (typeof providerKey !== "string" || typeof modelName !== "string" || !isSupportedModelTarget("CHAT", providerKey, modelName)) {
            throw new Error(`Configured CHAT fallback ${index + 1} is unsupported`);
        }
        const identity = `${providerKey}:${modelName}`;
        if (seen.has(identity)) throw new Error(`Configured CHAT fallback ${identity} is duplicated`);
        seen.add(identity);
        return { providerKey, modelName };
    });
}

/**
 * Build the executable target from a validated assignment and runtime-only
 * credentials. This is the shared interface for HTTP copilot and background
 * operational AI callers.
 */
export function buildOperationalAiTarget(
    assignment: ModelAssignment | null,
    credentials: RuntimeProviderCredentials = {},
): OperationalAiTarget {
    const defaultTarget = assignment ? DEFAULT_OPERATIONAL_MODEL : configuredAiTarget() ?? DEFAULT_OPERATIONAL_MODEL;
    const providerKey = assignment?.providerKey ?? defaultTarget.providerKey;
    const modelName = assignment?.modelName ?? defaultTarget.modelName;

    if (!isSupportedOperationalTarget(providerKey, modelName)) {
        throw new Error(`Configured CHAT provider or model is unsupported: ${providerKey}/${modelName}`);
    }

    const provider = providerKey as AiProvider;
    const configuredFallbacks = validateConfiguredFallbacks(assignment?.config.fallbacks);
    const fallbacks = configuredFallbacks === undefined
        ? automaticFallbacks(provider)
        : configuredFallbacks as ReadonlyArray<ModelTarget>;

    return {
        provider,
        model: modelName as GLMModel,
        fallbacks,
        credentials,
    };
}

/** Resolve the persisted CHAT assignment and encrypted runtime credentials together. */
export async function resolveOperationalAiTarget(
    db: OperationalAiDatabase = prisma as unknown as OperationalAiDatabase,
): Promise<OperationalAiTarget> {
    const assignment = await resolveModelForRole("CHAT", db, { defaultTarget: configuredAiTarget() ?? DEFAULT_OPERATIONAL_MODEL });
    let credentials: RuntimeProviderCredentials = {};
    try {
        credentials = await resolveRuntimeProviderCredentials(db);
    } catch {
        // Stored credentials are optional; callGLM still checks the approved
        // environment credential path. Admin surfaces report storage failures
        // explicitly when a write is attempted.
    }
    return buildOperationalAiTarget(assignment, credentials);
}
