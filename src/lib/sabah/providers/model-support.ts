import type { GLMModel } from "@/lib/glm";

export const ZAI_COMPRESSION_MODELS: readonly GLMModel[] = [
    "glm-5",
    "glm-4.5",
    "glm-4.5-flash",
    "glm-4.5-air",
    "GLM-4.5-Flash",
];

export function isCompressionTargetSupported(providerKey: unknown, modelName: unknown): providerKey is "zai" | "nuha" {
    if (typeof providerKey !== "string" || typeof modelName !== "string" || !modelName.trim()) return false;
    if (providerKey === "nuha") return true;
    return providerKey === "zai" && ZAI_COMPRESSION_MODELS.includes(modelName as GLMModel);
}
