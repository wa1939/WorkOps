/** Server-owned provider configuration. Never accept endpoint overrides from chat input. */
export const AI_PROVIDERS = ["zai", "nuha", "openai", "anthropic", "openai-compatible"] as const;
export type AiProviderId = typeof AI_PROVIDERS[number];

export function isAiProvider(value: unknown): value is AiProviderId {
    return typeof value === "string" && AI_PROVIDERS.includes(value as AiProviderId);
}

export function isModelName(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 200
        && value === value.trim() && !/[\s\u0000-\u001f\u007f]/.test(value);
}

export function configuredAiTarget(): { providerKey: AiProviderId; modelName: string } | undefined {
    const provider = process.env.AI_PROVIDER?.trim();
    if (!provider) return undefined;
    if (!isAiProvider(provider)) throw new Error("AI_PROVIDER is unsupported");
    const modelName = process.env.AI_MODEL?.trim();
    if (!isModelName(modelName)) throw new Error("AI_MODEL must specify the selected provider's model identifier");
    return { providerKey: provider, modelName };
}

export function compatibleBaseUrl(provider: "openai" | "openai-compatible"): string {
    if (provider === "openai") return "https://api.openai.com/v1";
    const value = process.env.AI_BASE_URL?.trim().replace(/\/+$/, "");
    if (!value) throw new Error("AI_BASE_URL is required for an OpenAI-compatible provider");
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new Error("AI_BASE_URL is invalid"); }
    if (parsed.username || parsed.password || parsed.search || parsed.hash
        || !(parsed.protocol === "https:" || (parsed.protocol === "http:" && process.env.AI_ALLOW_HTTP === "1"))) {
        throw new Error("AI_BASE_URL must use HTTPS without credentials, query or fragment; local HTTP requires operator opt-in AI_ALLOW_HTTP=1");
    }
    return value;
}

export function environmentCredential(provider: AiProviderId): string | undefined {
    const selected = process.env.AI_PROVIDER?.trim();
    if (selected === provider && process.env.AI_API_KEY) return process.env.AI_API_KEY;
    if (provider === "openai") return process.env.OPENAI_API_KEY;
    if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
    if (provider === "zai") return process.env.GLM_API_KEY;
    if (provider === "nuha") return process.env.NUHA_API_KEY;
    return process.env.OPENAI_COMPATIBLE_API_KEY;
}

export function hasConfiguredAi(credentials: Partial<Record<AiProviderId, string>> = {}): boolean {
    // This is an availability preflight, not model selection. A saved CHAT
    // assignment may intentionally override the deployment's default provider.
    if (AI_PROVIDERS.some(provider => Boolean(credentials[provider]))) return true;
    const selected = process.env.AI_PROVIDER?.trim();
    if (selected) return isAiProvider(selected) && Boolean(credentials[selected] || environmentCredential(selected));
    return Boolean(process.env.GLM_API_KEY || process.env.NUHA_API_KEY);
}

/**
 * Availability preflight for a resolved saved assignment. The assignment is
 * serviceable when it — or one of its validated fallback targets — has a
 * stored or environment credential, even when the deployment default provider
 * is unconfigured. This mirrors the runtime: uncredentialed explicit targets
 * are dropped, and a request only fails when no target holds a credential.
 */
export function assignmentHasCredential(
    assignment: { providerKey: unknown; modelName?: unknown; config?: { fallbacks?: unknown } } | null | undefined,
    credentials: Partial<Record<AiProviderId, string>> = {},
): boolean {
    if (!assignment || !isAiProvider(assignment.providerKey)) return false;
    const providers: AiProviderId[] = [assignment.providerKey];
    const fallbacks = assignment.config?.fallbacks;
    if (Array.isArray(fallbacks)) {
        for (const candidate of fallbacks) {
            const providerKey = (candidate as { providerKey?: unknown } | null)?.providerKey;
            if (isAiProvider(providerKey) && !providers.includes(providerKey)) providers.push(providerKey);
        }
    }
    return providers.some((provider) => Boolean(credentials[provider] || environmentCredential(provider)));
}
