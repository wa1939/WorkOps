"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { isCompressionTargetSupported } from "@/lib/sabah/providers/model-support";

export type ProviderRow = {
    id: string;
    providerKey: string;
    keyVersion: number;
    isEnabled: boolean;
    maskedHint: string;
    createdAt: string;
    updatedAt: string;
    source: "db" | "env" | "placeholder";
    mutable: boolean;
};

export type FallbackTarget = { providerKey: string; model: string };

export type RoleAssignment = {
    role: string;
    providerKey: string;
    model: string;
    fallbacks?: ReadonlyArray<FallbackTarget>;
};

export type ModelSettingsApi = {
    listProviders(): Promise<ProviderRow[]>;
    listAssignments(): Promise<RoleAssignment[]>;
    saveCredential(providerKey: string, newKey: string): Promise<{ ok: boolean }>;
    testCredential(providerKey: string): Promise<{ ok: boolean; latencyMs?: number }>;
    /** Null primary values remove the saved assignment. */
    assignRole(
        role: string,
        providerKey: string | null,
        model: string | null,
        fallbacks?: FallbackTarget[] | null,
    ): Promise<{ ok: boolean }>;
    rollback(providerKey: string): Promise<{ ok: boolean }>;
};

const MODEL_ROLES = ["CHAT", "COMPRESSION"] as const;
const MAX_FALLBACKS = 4;

type FallbackMode = "automatic" | "explicit" | "disabled";
type RoleDraft = {
    primary: string;
    fallbackMode: FallbackMode;
    fallbacks: string[];
};

// Selectable models per provider (mirrors the Hermes catalog for GLM).
const PROVIDER_MODELS: Record<string, readonly string[]> = {
    zai: ["glm-5", "glm-5.3", "glm-5.3-flash", "glm-4.7", "glm-4.5", "glm-4.5-flash", "glm-4.5-air", "GLM-4.5-Flash"],
    nuha: ["Nuha-2.1"],
    openai: ["gpt-4o-mini"],
    anthropic: ["claude-3-5-sonnet-20241022"],
};
const MODEL_CATALOG = (providerKey: string): readonly string[] => PROVIDER_MODELS[providerKey] ?? ["default"];
const ROLE_LABEL: Record<string, string> = {
    CHAT: "Chat",
    PLANNER: "Planner",
    CRITIC: "Critic",
    COMPRESSION: "Compression",
    VISION: "Vision",
    OCR: "OCR",
    ASR: "Speech-to-text",
    EMBEDDING: "Embeddings",
};

function errorText(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim()) return error.message;
    return fallback;
}

function targetValue(providerKey: string, model: string): string {
    return `${providerKey}:${model}`;
}

function splitTarget(value: string): { providerKey: string; model: string } | null {
    const separator = value.indexOf(":");
    if (separator <= 0 || separator === value.length - 1) return null;
    return { providerKey: value.slice(0, separator), model: value.slice(separator + 1) };
}

function draftForAssignment(current: RoleAssignment | undefined): RoleDraft {
    const fallbacks = current?.fallbacks?.map((fallback) => targetValue(fallback.providerKey, fallback.model)) ?? [];
    return {
        primary: current ? targetValue(current.providerKey, current.model) : "",
        fallbackMode: current?.fallbacks === undefined
            ? "automatic"
            : fallbacks.length === 0
                ? "disabled"
                : "explicit",
        fallbacks,
    };
}

export function AiModelSettings({ api, isAdmin = true }: { api: ModelSettingsApi; isAdmin?: boolean }) {
    const [providers, setProviders] = useState<ProviderRow[]>([]);
    const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
    const [newKeys, setNewKeys] = useState<Record<string, string>>({});
    const [testStatus, setTestStatus] = useState<Record<string, string>>({});
    const [confirmRollback, setConfirmRollback] = useState<string | null>(null);
    const [providerError, setProviderError] = useState<string | null>(null);
    const [assignmentError, setAssignmentError] = useState<string | null>(null);
    const [mutationError, setMutationError] = useState<string | null>(null);
    const [roleDrafts, setRoleDrafts] = useState<Record<string, RoleDraft>>({});

    const loadProviders = useCallback(async () => {
        setProviderError(null);
        try {
            setProviders(await api.listProviders());
        } catch (error) {
            setProviderError(errorText(error, "Failed to load provider settings."));
        }
    }, [api]);

    const loadAssignments = useCallback(async () => {
        setAssignmentError(null);
        try {
            setAssignments(await api.listAssignments());
        } catch (error) {
            setAssignmentError(errorText(error, "Failed to load model assignments."));
        }
    }, [api]);

    useEffect(() => {
        void Promise.all([loadProviders(), loadAssignments()]);
    }, [loadAssignments, loadProviders]);

    const providerOptions = useMemo(
        () => Array.from(new Set(
            providers
                .filter((provider) => provider.isEnabled && (provider.providerKey === "zai" || provider.providerKey === "nuha"))
                .map((provider) => provider.providerKey)
        )),
        [providers]
    );

    const modelOptions = (role: string): string[] => providerOptions.flatMap((providerKey) =>
        MODEL_CATALOG(providerKey)
            .filter((model) => role !== "COMPRESSION" || isCompressionTargetSupported(providerKey, model))
            .map((model) => targetValue(providerKey, model))
    );

    const setRoleDraft = (role: string, current: RoleAssignment | undefined, update: Partial<RoleDraft>) => {
        setRoleDrafts((previous) => ({
            ...previous,
            [role]: { ...(previous[role] ?? draftForAssignment(current)), ...update },
        }));
    };

    if (!isAdmin) {
        return null;
    }

    const save = async (providerKey: string) => {
        const newKey = newKeys[providerKey] ?? "";
        // Empty means preserve the current credential — never send a clear.
        if (newKey === "") return;
        setMutationError(null);
        try {
            await api.saveCredential(providerKey, newKey);
            setNewKeys((previous) => ({ ...previous, [providerKey]: "" }));
            await loadProviders();
        } catch (error) {
            setMutationError(errorText(error, `Unable to save the ${providerKey} credential.`));
        }
    };

    const test = async (providerKey: string) => {
        setMutationError(null);
        setTestStatus((previous) => ({ ...previous, [providerKey]: "Testing…" }));
        try {
            const result = await api.testCredential(providerKey);
            setTestStatus((previous) => ({
                ...previous,
                [providerKey]: result.ok ? `Connected (${result.latencyMs ?? "?"}ms)` : "Failed",
            }));
        } catch (error) {
            setTestStatus((previous) => ({ ...previous, [providerKey]: "Failed" }));
            setMutationError(errorText(error, `Unable to test the ${providerKey} credential.`));
        }
    };

    const rollback = async (providerKey: string) => {
        if (confirmRollback !== providerKey) {
            setConfirmRollback(providerKey);
            return;
        }
        setMutationError(null);
        try {
            await api.rollback(providerKey);
            setConfirmRollback(null);
            await loadProviders();
        } catch (error) {
            setMutationError(errorText(error, `Unable to roll back the ${providerKey} credential.`));
        }
    };

    const saveRole = async (role: string, draft: RoleDraft) => {
        setMutationError(null);
        try {
            const primary = splitTarget(draft.primary);
            if (!primary) {
                await api.assignRole(role, null, null, undefined);
            } else {
                const fallbacks = draft.fallbackMode === "automatic"
                    ? null
                    : draft.fallbackMode === "disabled"
                        ? []
                        : draft.fallbacks
                            .map(splitTarget)
                            .filter((target): target is { providerKey: string; model: string } => target !== null)
                            .map((target) => ({ providerKey: target.providerKey, model: target.model }));
                await api.assignRole(role, primary.providerKey, primary.model, fallbacks);
            }
            await loadAssignments();
            setRoleDrafts((previous) => {
                const next = { ...previous };
                delete next[role];
                return next;
            });
        } catch (error) {
            setMutationError(errorText(error, `Unable to save the ${role} assignment.`));
        }
    };

    return (
        <section aria-label="Sabah model settings" className="space-y-6">
            {providerError && (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    <span>{providerError}</span>
                    <button
                        type="button"
                        onClick={() => void loadProviders()}
                        className="ml-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    >
                        Retry providers
                    </button>
                </div>
            )}
            {assignmentError && (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    <span>{assignmentError}</span>
                    <button
                        type="button"
                        onClick={() => void loadAssignments()}
                        className="ml-2 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                    >
                        Retry assignments
                    </button>
                </div>
            )}
            {mutationError && (
                <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    {mutationError}
                </div>
            )}
            <div>
                <h2 className="text-base font-semibold">Providers</h2>
                <p className="text-xs text-muted-foreground">
                    Credentials are encrypted at rest and shown masked. Leave the key empty to keep the current value.
                </p>
                <div className="mt-2 space-y-3">
                    {providers.map((provider) => (
                        <div key={provider.id} className="rounded-xl border border-border p-3">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold">{provider.providerKey}</span>
                                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">key v{provider.keyVersion}</span>
                                {provider.source === "env" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">environment-backed</span>}
                                {provider.source === "placeholder" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">not configured</span>}
                                {(!provider.mutable || provider.source === "env") && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">read-only</span>}
                                {!provider.isEnabled && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">disabled</span>}
                                <code className="text-xs text-muted-foreground">{provider.maskedHint}</code>
                            </div>
                            {provider.mutable !== false && provider.source !== "env" && <div className="mt-2 flex flex-wrap items-center gap-2">
                                <label htmlFor={`key-${provider.providerKey}`} className="sr-only">
                                    API key for {provider.providerKey}
                                </label>
                                <input
                                    id={`key-${provider.providerKey}`}
                                    type="password"
                                    autoComplete="new-password"
                                    value={newKeys[provider.providerKey] ?? ""}
                                    onChange={(event) => setNewKeys((previous) => ({ ...previous, [provider.providerKey]: event.target.value }))}
                                    placeholder="New key (empty = keep current)"
                                    className="w-64 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                />
                                <button
                                    type="button"
                                    onClick={() => void save(provider.providerKey)}
                                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                >
                                    Save {provider.providerKey} credential
                                </button>
                                {provider.source !== "placeholder" && provider.isEnabled && <>
                                    <button
                                        type="button"
                                        onClick={() => void test(provider.providerKey)}
                                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                    >
                                        Test {provider.providerKey} connection
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void rollback(provider.providerKey)}
                                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                    >
                                        {confirmRollback === provider.providerKey ? "Confirm rollback" : `Rollback ${provider.providerKey} to last-known-good`}
                                    </button>
                                    {testStatus[provider.providerKey] && (
                                        <span role="status" className="text-xs text-muted-foreground">
                                            {testStatus[provider.providerKey]}
                                        </span>
                                    )}
                                </>}
                            </div>}
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <h2 className="text-base font-semibold">Role assignments</h2>
                <p className="text-xs text-muted-foreground">
                    Each Sabah task type uses its assigned model. Fallback can be automatic, disabled, or an ordered list of explicit targets.
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {MODEL_ROLES.map((role) => {
                        const current = assignments.find((assignment) => assignment.role === role);
                        const draft = roleDrafts[role] ?? draftForAssignment(current);
                        const options = modelOptions(role);
                        const fallbackOptions = draft.fallbacks.reduce((available, value) => {
                            if (value !== "" && !available.includes(value)) available.push(value);
                            return available;
                        }, [...options]);

                        return (
                            <div key={role} className="rounded-lg border border-border p-3">
                                <div className="flex items-center gap-2">
                                    <label htmlFor={`role-${role}`} className="w-32 shrink-0 text-sm">
                                        {ROLE_LABEL[role]}
                                    </label>
                                    <select
                                        id={`role-${role}`}
                                        aria-label={`Model for ${role}`}
                                        value={draft.primary}
                                        onChange={(event) => setRoleDraft(role, current, { primary: event.target.value })}
                                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                    >
                                        <option value="">Unassigned (automatic fallback)</option>
                                        {draft.primary !== "" && !options.includes(draft.primary) && (
                                            <option value={draft.primary}>{draft.primary.replace(":", " · ")}</option>
                                        )}
                                        {options.map((value) => {
                                            const target = splitTarget(value);
                                            return target ? <option key={value} value={value}>{target.providerKey} · {target.model}</option> : null;
                                        })}
                                    </select>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                    <label htmlFor={`fallback-mode-${role}`} className="w-32 shrink-0 text-xs text-muted-foreground">
                                        Fallback mode
                                    </label>
                                    <select
                                        id={`fallback-mode-${role}`}
                                        aria-label={`Fallback mode for ${role}`}
                                        value={draft.fallbackMode}
                                        onChange={(event) => {
                                            const mode = event.target.value as FallbackMode;
                                            setRoleDraft(role, current, {
                                                fallbackMode: mode,
                                                fallbacks: mode === "explicit" && draft.fallbacks.length === 0 ? [""] : draft.fallbacks,
                                            });
                                        }}
                                        className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                    >
                                        <option value="automatic">Automatic provider fallback</option>
                                        <option value="explicit">Explicit ordered list</option>
                                        <option value="disabled">Disabled</option>
                                    </select>
                                </div>
                                {draft.fallbackMode === "automatic" && (
                                    <p className="mt-1 text-xs text-muted-foreground">Automatic provider order is used.</p>
                                )}
                                {draft.fallbackMode === "disabled" && (
                                    <p className="mt-1 text-xs text-muted-foreground">Fallback attempts are disabled.</p>
                                )}
                                {draft.fallbackMode === "explicit" && (
                                    <div className="mt-2 space-y-2">
                                        <p className="text-xs text-muted-foreground">Explicit targets only, tried in the order shown.</p>
                                        {draft.fallbacks.map((value, index) => (
                                            <div key={`${role}-fallback-${index}`} className="flex items-center gap-2">
                                                <label htmlFor={`fallback-${role}-${index}`} className="w-32 shrink-0 text-xs text-muted-foreground">
                                                    Fallback {index + 1}
                                                </label>
                                                <select
                                                    id={`fallback-${role}-${index}`}
                                                    aria-label={`Fallback ${index + 1} model for ${role}`}
                                                    value={value}
                                                    onChange={(event) => {
                                                        const fallbacks = [...draft.fallbacks];
                                                        fallbacks[index] = event.target.value;
                                                        setRoleDraft(role, current, { fallbacks });
                                                    }}
                                                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                                >
                                                    <option value="">Select fallback target</option>
                                                    {fallbackOptions.map((option) => {
                                                        const target = splitTarget(option);
                                                        return target ? <option key={option} value={option}>{target.providerKey} · {target.model}</option> : null;
                                                    })}
                                                </select>
                                                <button
                                                    type="button"
                                                    aria-label={`Remove fallback ${index + 1} for ${role}`}
                                                    onClick={() => setRoleDraft(role, current, { fallbacks: draft.fallbacks.filter((_, fallbackIndex) => fallbackIndex !== index) })}
                                                    className="rounded-lg border border-border px-2 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                        {draft.fallbacks.length < MAX_FALLBACKS && (
                                            <button
                                                type="button"
                                                onClick={() => setRoleDraft(role, current, { fallbacks: [...draft.fallbacks, ""] })}
                                                className="rounded-lg border border-border px-2 py-1.5 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                            >
                                                Add fallback
                                            </button>
                                        )}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => void saveRole(role, draft)}
                                    className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                                >
                                    Save {role} assignment
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div>
                <h2 className="text-base font-semibold">Data processing policy</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Local-first: OCR and speech run on-device. Cloud providers process only what
                  you send through Sabah. Multimodal cloud fallback requires explicit consent
                  per document.
                </p>
            </div>
        </section>
    );
}
