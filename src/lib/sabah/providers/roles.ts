import { configuredAiTarget, isModelName, type AiProviderId } from "@/lib/ai/provider-config";

export type AiModelRole = "CHAT" | "PLANNER" | "CRITIC" | "COMPRESSION" | "VISION" | "OCR" | "ASR" | "EMBEDDING";

export type ModelAssignmentDb = {
    aiModelAssignment: {
        findUnique: (args: { where: { role: AiModelRole } }) => Promise<{ providerKey: string; modelName: string; configJson: string | null } | null>;
    };
};

export type ModelTarget = {
    providerKey: AiProviderId;
    modelName: string;
};

/**
 * Fallback update supplied by the admin API.
 *
 * `undefined` leaves the persisted fallback setting untouched; `null` removes
 * only the persisted fallbacks property; an array replaces it (including an
 * empty array, which explicitly disables fallback attempts).
 */
export type ModelFallbackUpdate = ReadonlyArray<ModelTarget> | null;

export interface ModelAssignment {
    providerKey: string;
    modelName: string;
    config: Record<string, unknown>;
}

export const MAX_MODEL_FALLBACKS = 4;

// These are the provider/model pairs that the current runtime can execute.
// Keep this list independent of credentials: an admin may configure a target
// before its credential is available, but never an unsupported target.
const CHAT_MODEL_TARGETS: Readonly<Record<string, readonly string[]>> = {
    zai: ["glm-5", "glm-5.3", "glm-5.3-flash", "glm-4.7", "glm-4.5", "glm-4.5-flash", "glm-4.5-air", "GLM-4.5-Flash"],
    nuha: ["Nuha-2.1"],
};
const COMPRESSION_MODEL_TARGETS: Readonly<Record<string, readonly string[]>> = {
    zai: ["glm-5", "glm-4.5", "glm-4.5-flash", "glm-4.5-air", "GLM-4.5-Flash"],
    nuha: ["Nuha-2.1"],
};

export class InvalidModelAssignmentConfigError extends Error {
    public readonly status = 400;

    constructor(message: string) {
        super(message);
        this.name = "InvalidModelAssignmentConfigError";
    }
}

export function isSupportedModelTarget(role: AiModelRole, providerKey: unknown, modelName: unknown): providerKey is AiProviderId {
    if (typeof providerKey !== "string" || typeof modelName !== "string" || modelName.length === 0) return false;
    if ((role === "CHAT" || role === "COMPRESSION") && (providerKey === "openai" || providerKey === "anthropic" || providerKey === "openai-compatible")) return isModelName(modelName);
    const targets = role === "CHAT"
        ? CHAT_MODEL_TARGETS
        : role === "COMPRESSION"
            ? COMPRESSION_MODEL_TARGETS
            : undefined;
    return targets?.[providerKey]?.includes(modelName) ?? false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function parseConfigJson(role: AiModelRole, configJson: string | null | undefined): Record<string, unknown> {
    if (configJson === null || configJson === undefined) return {};
    if (typeof configJson !== "string") {
        throw new InvalidModelAssignmentConfigError(`${role} assignment config must be a JSON object`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(configJson);
    } catch {
        throw new InvalidModelAssignmentConfigError(`${role} assignment config is not valid JSON`);
    }
    if (!isPlainObject(parsed)) {
        throw new InvalidModelAssignmentConfigError(`${role} assignment config must be a JSON object`);
    }
    return parsed;
}

/**
 * Parse and validate the persisted config without changing legacy settings.
 *
 * `fallbacks` is intentionally tri-state:
 * - omitted: preserve the legacy automatic provider fallback;
 * - []: disable fallback attempts;
 * - non-empty array: try only these configured targets, in order.
 */
export function parseModelAssignmentConfig(
    role: AiModelRole,
    configJson: string | null | undefined,
): Record<string, unknown> {
    const config = parseConfigJson(role, configJson);
    if (config.fallbacks === undefined) return config;
    if (!Array.isArray(config.fallbacks)) {
        throw new InvalidModelAssignmentConfigError(`${role} assignment fallbacks must be an array`);
    }
    if (config.fallbacks.length > MAX_MODEL_FALLBACKS) {
        throw new InvalidModelAssignmentConfigError(`${role} assignment has too many fallback targets`);
    }

    const seen = new Set<string>();
    const fallbacks = config.fallbacks.map((candidate, index): ModelTarget => {
        if (!isPlainObject(candidate) || typeof candidate.providerKey !== "string" || typeof candidate.modelName !== "string") {
            throw new InvalidModelAssignmentConfigError(`${role} fallback ${index + 1} must contain providerKey and modelName`);
        }
        if (!isSupportedModelTarget(role, candidate.providerKey, candidate.modelName)) {
            throw new InvalidModelAssignmentConfigError(`${role} fallback target ${candidate.providerKey}/${candidate.modelName} is unsupported`);
        }
        const identity = `${candidate.providerKey}:${candidate.modelName}`;
        if (seen.has(identity)) {
            throw new InvalidModelAssignmentConfigError(`${role} fallback target ${identity} is duplicated`);
        }
        seen.add(identity);
        return { providerKey: candidate.providerKey, modelName: candidate.modelName };
    });

    return { ...config, fallbacks };
}

export function parseModelFallbacks(
    role: AiModelRole,
    configJson: string | null | undefined,
): ReadonlyArray<ModelTarget> | undefined {
    const config = parseModelAssignmentConfig(role, configJson);
    return config.fallbacks as ReadonlyArray<ModelTarget> | undefined;
}

// Kept as the descriptive name used by the admin service and runtime callers.
export const getConfiguredFallbacks = parseModelFallbacks;

// Safe hardcoded fallbacks for each role (used when DB and env vars are missing)
const SAFE_FALLBACKS: Record<AiModelRole, { providerKey: string; modelName: string }> = {
    CHAT: { providerKey: "zai", modelName: "glm-4.5-flash" },
    PLANNER: { providerKey: "zai", modelName: "glm-4.5-flash" },
    CRITIC: { providerKey: "zai", modelName: "glm-4.5-flash" },
    COMPRESSION: { providerKey: "zai", modelName: "glm-4.5-flash" },
    // GLM-5.3-Flash is the documented native multimodal model.
    VISION: { providerKey: "zai", modelName: "glm-5.3-flash" },
    OCR: { providerKey: "zai", modelName: "glm-5.3-flash" },
    ASR: { providerKey: "zai", modelName: "glm-4.5-audio" },
    EMBEDDING: { providerKey: "zai", modelName: "glm-4.5-embed" },
};

/**
 * Resolve model assignment for a given role.
 *
 * Fallback order:
 * 1. Database assignment (AiModelAssignment table)
 * 2. Hardcoded adapter-safe default (model metadata only; credentials are
 *    resolved separately at runtime from stored credentials or environment)
 *
 * An existing assignment's `configJson.fallbacks` is validated and returned
 * unchanged in `config`; the runtime owns executing those targets.
 */
export async function resolveModelForRole(
    role: AiModelRole,
    prisma: ModelAssignmentDb,
    options: { defaultTarget?: Readonly<ModelTarget> } = {},
): Promise<ModelAssignment> {
    const dbAssignment = await prisma.aiModelAssignment.findUnique({
        where: { role },
    });

    if (dbAssignment) {
        if ((role === "CHAT" || role === "COMPRESSION") && !isSupportedModelTarget(role, dbAssignment.providerKey, dbAssignment.modelName)) {
            throw new InvalidModelAssignmentConfigError(`${role} target ${dbAssignment.providerKey}/${dbAssignment.modelName} is unsupported`);
        }
        return {
            providerKey: dbAssignment.providerKey,
            modelName: dbAssignment.modelName,
            config: parseModelAssignmentConfig(role, dbAssignment.configJson),
        };
    }

    const safeDefault = options.defaultTarget ?? ((role === "CHAT" || role === "COMPRESSION") ? configuredAiTarget() : undefined) ?? SAFE_FALLBACKS[role];
    return {
        providerKey: safeDefault.providerKey,
        modelName: safeDefault.modelName,
        config: {},
    };
}
