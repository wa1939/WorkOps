"use client";

import React, { useMemo } from "react";
import { AiModelSettings, type ModelSettingsApi, type ProviderRow, type RoleAssignment } from "@/components/admin/ai-model-settings";

async function json<T>(input: string, init?: RequestInit): Promise<T> {
    const response = await fetch(input, init);
    if (!response.ok) {
        let message = `Request failed: ${response.status}`;
        try {
            const body = await response.json() as { error?: unknown };
            if (typeof body.error === "string" && body.error.trim()) message = body.error;
        } catch {
            // Keep the status fallback when the server did not return JSON.
        }
        throw new Error(message);
    }
    return (await response.json()) as T;
}

export function SabahModelSettingsSection() {
    const api = useMemo<ModelSettingsApi>(() => ({
        async listProviders() {
            const body = await json<{ providers: ProviderRow[] }>("/api/ai/admin/providers");
            return body.providers;
        },
        async listAssignments() {
            const body = await json<{ assignments: RoleAssignment[] }>("/api/ai/admin/model-assignments");
            return body.assignments;
        },
        async saveCredential(providerKey, newKey) {
            // providerKey is unique server-side: rotate the existing row via the
            // item route, create only when the provider has no credential yet.
            const providers = await json<{ providers: ProviderRow[] }>("/api/ai/admin/providers");
            const provider = providers.providers.find((p) => p.providerKey === providerKey);
            if (provider && (provider.mutable === false || provider.source === "env")) return { ok: false };
            if (provider && provider.source !== "placeholder") {
                return json(`/api/ai/admin/providers/${provider.id}`, {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ newCredential: newKey }),
                });
            }
            return json("/api/ai/admin/providers", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ providerKey, credential: newKey }),
            });
        },
        async testCredential(providerKey) {
            const providers = await json<{ providers: ProviderRow[] }>("/api/ai/admin/providers");
            const provider = providers.providers.find((p) => p.providerKey === providerKey);
            if (provider && (provider.mutable === false || provider.source === "env")) return { ok: false };
            if (!provider) {
                return { ok: false };
            }
            // The test route reports { success, latencyMs }; the UI reads ok.
            const result = await json<{ success?: boolean; latencyMs?: number }>(`/api/ai/admin/providers/${provider.id}/test`, { method: "POST" });
            return { ok: result.success === true, latencyMs: result.latencyMs };
        },
        assignRole(role, providerKey, model, fallbacks) {
            // The API persists the model under modelName.
            return json("/api/ai/admin/model-assignments", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    role,
                    providerKey,
                    modelName: model,
                    ...(fallbacks === undefined
                        ? {}
                        : {
                            fallbacks: fallbacks === null
                                ? null
                                : fallbacks.map((fallback) => ({
                                    providerKey: fallback.providerKey,
                                    modelName: fallback.model,
                                })),
                        }),
                }),
            });
        },
        async rollback(providerKey) {
            try {
                const providers = await json<{ providers: ProviderRow[] }>("/api/ai/admin/providers");
                const provider = providers.providers.find((p) => p.providerKey === providerKey);
                if (provider && (provider.mutable === false || provider.source === "env")) return { ok: false };
                if (!provider) {
                    return { ok: false };
                }
                return await json(`/api/ai/admin/providers/${provider.id}`, {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ action: "rollback" }),
                });
            } catch {
                // Rollback is unsupported server-side (single-row credential
                // storage); report failure instead of throwing in the handler.
                return { ok: false };
            }
        },
    }), []);

    return <AiModelSettings api={api} />;
}
