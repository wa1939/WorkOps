import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { callGLM, DEFAULT_GLM_MODEL, NUHA_MODEL } from "@/lib/glm";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { encryptCredential, decryptCredential } from "./crypto";
import {
    getConfiguredFallbacks,
    isSupportedModelTarget,
    parseModelAssignmentConfig,
    type AiModelRole,
    type ModelFallbackUpdate,
    type ModelTarget,
} from "./roles";

export interface SabahActor {
    id: string;
    role: "ADMIN" | "LEAD" | "MEMBER" | "VIEWER";
    departmentIds: string[];
}

/**
 * Masked credential for API responses (never contains plaintext).
 */
export interface MaskedCredential {
    id: string;
    providerKey: string;
    keyVersion: number;
    isEnabled: boolean;
    maskedHint: string;
    createdAt: string;
    updatedAt: string;
    source: "db" | "env";
    mutable: boolean;
}

/**
 * Create input.
 */
export interface CreateCredentialInput {
    providerKey: string;
    credential: string;
}

/**
 * Rotate input.
 */
export interface RotateCredentialInput {
    newCredential: string;
}

/**
 * Test result.
 */
export interface TestResult {
    success: boolean;
    latencyMs?: number;
    model?: string;
    error?: string;
}

export class ProviderCredentialNotConfiguredError extends Error {
    public readonly status = 409;
    public readonly code = "CREDENTIAL_NOT_CONFIGURED";

    constructor() {
        super("Provider credential is not configured; save a credential before testing");
        this.name = "ProviderCredentialNotConfiguredError";
    }
}

export type RuntimeProviderCredentials = Partial<Record<"zai" | "nuha", string>>;

/** Internal runtime-only credential resolution. Plaintext never crosses an API boundary. */
export async function resolveRuntimeProviderCredentials(
    db: Pick<PrismaClient, "aiProviderCredential"> = prisma,
): Promise<RuntimeProviderCredentials> {
    const rows = await db.aiProviderCredential.findMany({
        where: { isEnabled: true, providerKey: { in: ["zai", "nuha"] } },
        select: { providerKey: true, encryptedValue: true, iv: true, authTag: true, keyVersion: true },
    });
    const credentials: RuntimeProviderCredentials = {};
    for (const row of rows) {
        if (row.providerKey !== "zai" && row.providerKey !== "nuha") continue;
        try {
            credentials[row.providerKey] = decryptCredential({ encryptedValue: row.encryptedValue, iv: row.iv, authTag: row.authTag, keyVersion: row.keyVersion });
        } catch {
            // A broken stored row is unavailable; environment fallback may still be valid.
        }
    }
    return credentials;
}

/**
 * Assignment input.
 */
export interface AssignRoleInput {
    role: string;
    providerKey: string;
    modelName: string;
    /** Omitted preserves the stored setting; null clears only fallbacks; [] disables it. */
    fallbacks?: ModelFallbackUpdate;
    /** Internal callers may provide existing non-fallback settings to preserve. */
    configJson?: string;
}

export type ListedModelAssignment = {
    id: string;
    role: string;
    providerKey: string;
    modelName: string;
    fallbacks?: ReadonlyArray<ModelTarget>;
    createdAt: string;
    updatedAt: string;
};

export class UnsupportedModelAssignmentError extends Error {
    public readonly status = 400;
    constructor(role: string, providerKey: string, modelName: string) {
        super(`${role} target ${providerKey}/${modelName} is unsupported`);
        this.name = "UnsupportedModelAssignmentError";
    }
}

export class UnsupportedChatProviderError extends UnsupportedModelAssignmentError {
    constructor(providerKey: string) {
        super("CHAT", providerKey, "");
        this.message = `CHAT provider ${providerKey} is unsupported`;
        this.name = "UnsupportedChatProviderError";
    }
}

export class CredentialWriteUnavailableError extends Error {
    public readonly status = 503;
    public readonly code = "CREDENTIAL_WRITE_UNAVAILABLE";

    constructor() {
        super("Credential writes are unavailable; configure SABAH_CREDENTIAL_KEY as a base64-encoded 32-byte key");
        this.name = "CredentialWriteUnavailableError";
    }
}

function encryptForStorage(plaintext: string) {
    try {
        return encryptCredential(plaintext);
    } catch (error) {
        if (error instanceof Error && /SABAH_CREDENTIAL_KEY|Master key must be 32 bytes/.test(error.message)) {
            throw new CredentialWriteUnavailableError();
        }
        throw error;
    }
}

/**
 * Ensure actor is ADMIN; otherwise throw.
 */
async function requireAdmin(actor: SabahActor): Promise<void> {
    if (actor.role !== "ADMIN") {
        throw new SabahForbiddenError();
    }
}

/**
 * Mask a credential: first 3 + last 4 chars, rest dots.
 */
function maskCredential(plaintext: string): string {
    if (plaintext.length <= 7) {
        return "•••••••";
    }
    return `${plaintext.slice(0, 3)}${"•".repeat(plaintext.length - 7)}${plaintext.slice(-4)}`;
}

/**
 * List all provider credentials (ADMIN-only). Returns masked metadata only.
 */
export async function listProviderCredentials(
    actor: SabahActor,
    db: PrismaClient = prisma
): Promise<MaskedCredential[]> {
    await requireAdmin(actor);

    const credentials = await db.aiProviderCredential.findMany({
        orderBy: { createdAt: "desc" },
        // Keep this projection compatible with databases that have not yet
        // received optional rotation-history columns. It also prevents
        // encrypted values from crossing the metadata boundary.
        select: {
            id: true,
            providerKey: true,
            keyVersion: true,
            isEnabled: true,
            createdAt: true,
            updatedAt: true,
        },
    });

    return credentials.map((cred) => ({
        id: cred.id,
        providerKey: cred.providerKey,
        keyVersion: cred.keyVersion,
        isEnabled: cred.isEnabled,
        maskedHint: `${cred.providerKey.slice(0, 3)}•••••••key`,
        createdAt: cred.createdAt.toISOString(),
        updatedAt: cred.updatedAt.toISOString(),
        source: "db" as const,
        mutable: true as const,
    }));
}

/**
 * Create a new provider credential (ADMIN-only). Encrypts and stores.
 */
export async function createProviderCredential(
    actor: SabahActor,
    input: CreateCredentialInput,
    db: PrismaClient = prisma
): Promise<MaskedCredential> {
    await requireAdmin(actor);

    const encrypted = encryptForStorage(input.credential);

    const credential = await db.aiProviderCredential.create({
        data: {
            providerKey: input.providerKey,
            encryptedValue: encrypted.encryptedValue,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            keyVersion: encrypted.keyVersion,
            isEnabled: true,
            createdBy: actor.id,
        },
    });

    return {
        id: credential.id,
        providerKey: credential.providerKey,
        keyVersion: credential.keyVersion,
        isEnabled: credential.isEnabled,
        maskedHint: maskCredential(input.credential),
        createdAt: credential.createdAt.toISOString(),
        updatedAt: credential.updatedAt.toISOString(),
        source: "db",
        mutable: true,
    };
}

/**
 * Rotate a provider credential (ADMIN-only).
 *
 * AiProviderCredential.providerKey is unique, so rotation replaces the value
 * in place on the single row. keyVersion stores the crypto master-key version
 * returned by encryptCredential — decryptCredential needs it to decrypt.
 */
export async function rotateProviderCredential(
    actor: SabahActor,
    id: string,
    input: RotateCredentialInput,
    db: PrismaClient = prisma
): Promise<MaskedCredential> {
    await requireAdmin(actor);

    const existing = await db.aiProviderCredential.findUnique({
        where: { id },
    });

    if (!existing) {
        throw new Error("Credential not found");
    }

    const encrypted = encryptForStorage(input.newCredential);

    // Compare-and-swap on updatedAt so an overlapping rotate/rollback cannot
    // silently discard the value the other request just installed.
    let rotated;
    try {
        rotated = await db.aiProviderCredential.update({
            where: { id, updatedAt: existing.updatedAt },
            data: {
                encryptedValue: encrypted.encryptedValue,
                iv: encrypted.iv,
                authTag: encrypted.authTag,
                keyVersion: encrypted.keyVersion,
                // Retain the outgoing value as one-level history for rollback.
                previousEncryptedValue: existing.encryptedValue,
                previousIv: existing.iv,
                previousAuthTag: existing.authTag,
                previousKeyVersion: existing.keyVersion,
                isEnabled: true,
                createdBy: actor.id,
            },
        });
    } catch (error) {
        if (isRecordNotFound(error)) throw new CredentialConflictError();
        throw error;
    }

    return {
        id: rotated.id,
        providerKey: rotated.providerKey,
        keyVersion: rotated.keyVersion,
        isEnabled: rotated.isEnabled,
        maskedHint: maskCredential(input.newCredential),
        createdAt: rotated.createdAt.toISOString(),
        updatedAt: rotated.updatedAt.toISOString(),
        source: "db",
        mutable: true,
    };
}

export class CredentialConflictError extends Error {
    public readonly status = 409;
    constructor() {
        super("Credential was modified concurrently; reload and retry");
        this.name = "CredentialConflictError";
    }
}

function isRecordNotFound(error: unknown): boolean {
    return !!error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2025";
}

export class NoPreviousCredentialError extends Error {
    public readonly status = 409;
    constructor() {
        super("No previous credential version is stored; save a new credential instead");
        this.name = "NoPreviousCredentialError";
    }
}

/**
 * Roll back a provider credential to its retained previous version
 * (ADMIN-only). The current value becomes the new history entry so an
 * accidental rollback can itself be rolled back.
 */
export async function rollbackProviderCredential(
    actor: SabahActor,
    id: string,
    db: PrismaClient = prisma
): Promise<MaskedCredential> {
    await requireAdmin(actor);

    const existing = await db.aiProviderCredential.findUnique({ where: { id } });
    if (!existing) {
        throw new Error("Credential not found");
    }
    if (!existing.previousEncryptedValue || !existing.previousIv || !existing.previousAuthTag || existing.previousKeyVersion === null) {
        throw new NoPreviousCredentialError();
    }

    // Same compare-and-swap as rotation: the swap only lands on the exact
    // version this request read.
    let restored;
    try {
        restored = await db.aiProviderCredential.update({
            where: { id, updatedAt: existing.updatedAt },
            data: {
                encryptedValue: existing.previousEncryptedValue,
                iv: existing.previousIv,
                authTag: existing.previousAuthTag,
                keyVersion: existing.previousKeyVersion,
                previousEncryptedValue: existing.encryptedValue,
                previousIv: existing.iv,
                previousAuthTag: existing.authTag,
                previousKeyVersion: existing.keyVersion,
                isEnabled: true,
                createdBy: actor.id,
            },
        });
    } catch (error) {
        if (isRecordNotFound(error)) throw new CredentialConflictError();
        throw error;
    }

    return {
        id: restored.id,
        providerKey: restored.providerKey,
        keyVersion: restored.keyVersion,
        isEnabled: restored.isEnabled,
        maskedHint: "restored previous version",
        createdAt: restored.createdAt.toISOString(),
        updatedAt: restored.updatedAt.toISOString(),
        source: "db",
        mutable: true,
    };
}

/**
 * List model role assignments (ADMIN-only).
 */
export async function listModelAssignments(
    actor: SabahActor,
    db: PrismaClient = prisma
): Promise<ListedModelAssignment[]> {
    await requireAdmin(actor);

    const assignments = await db.aiModelAssignment.findMany({
        orderBy: { role: "asc" },
        select: {
            id: true,
            role: true,
            providerKey: true,
            modelName: true,
            configJson: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    return assignments.map((assignment) => {
        const fallbacks = getConfiguredFallbacks(assignment.role as AiModelRole, assignment.configJson);
        return {
            id: assignment.id,
            role: assignment.role,
            providerKey: assignment.providerKey,
            modelName: assignment.modelName,
            ...(fallbacks === undefined ? {} : { fallbacks }),
            createdAt: assignment.createdAt.toISOString(),
            updatedAt: assignment.updatedAt.toISOString(),
        };
    });
}

/**
 * Test a provider credential (ADMIN-only). Decrypts, makes a bounded test call, returns metadata only.
 */
export async function testProviderCredential(
    actor: SabahActor,
    id: string,
    db: PrismaClient = prisma
): Promise<TestResult> {
    await requireAdmin(actor);

    const credential = await db.aiProviderCredential.findUnique({
        where: { id },
    });

    if (!credential) {
        throw new ProviderCredentialNotConfiguredError();
    }

    if (!credential.isEnabled) {
        return { success: false, error: "Credential is disabled" };
    }

    const decrypted = decryptCredential({
        encryptedValue: credential.encryptedValue,
        iv: credential.iv,
        authTag: credential.authTag,
        keyVersion: credential.keyVersion,
    });

    const start = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);
    try {
        let success = false;
        let model: string | undefined;

        if (credential.providerKey === "openai") {
            const response = await fetch("https://api.openai.com/v1/models", {
                method: "GET",
                headers: { Authorization: `Bearer ${decrypted}` },
                signal: controller.signal,
            });

            if (response.ok) {
                success = true;
            } else {
                return { success: false, error: `API error: ${response.status}` };
            }
        } else if (credential.providerKey === "anthropic") {
            const response = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "x-api-key": decrypted,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: "claude-3-5-sonnet-20241022",
                    max_tokens: 1,
                    messages: [{ role: "user", content: "Hi" }],
                }),
                signal: controller.signal,
            });

            if (response.ok) {
                success = true;
                model = "claude-3-5-sonnet-20241022";
            } else {
                return { success: false, error: `API error: ${response.status}` };
            }
        } else if (credential.providerKey === "zai" || credential.providerKey === "nuha") {
            // Exercise the same bounded adapter used by operational runtime
            // calls. Explicit fallbacks: [] keeps a credential test from
            // silently succeeding through another provider.
            const provider = credential.providerKey;
            const testModel = provider === "zai" ? DEFAULT_GLM_MODEL : NUHA_MODEL;
            await callGLM({
                provider,
                model: testModel,
                credentials: { [provider]: decrypted },
                fallbacks: [],
                messages: [{ role: "user", content: "ping" }],
                temperature: 0,
                max_tokens: 1,
                signal: controller.signal,
            });
            success = true;
            model = testModel;
        } else {
            return { success: false, error: `Unsupported provider: ${credential.providerKey}` };
        }

        const latencyMs = Date.now() - start;

        return { success, latencyMs, model };
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
            return { success: false, error: "Test timeout after 10s" };
        }
        // Provider/transport errors may reflect credentials or request bodies.
        // Never serialize their message through the admin API.
        return { success: false, error: "Provider test failed. Check credentials and provider availability." };
    } finally {
        clearTimeout(timeoutId);
    }
}

/**
 * Assign a model role (ADMIN-only). Upserts AiModelAssignment.
 */
export async function assignModelRole(
    actor: SabahActor,
    input: AssignRoleInput,
    db: PrismaClient = prisma
): Promise<ListedModelAssignment> {
    await requireAdmin(actor);
    if (input.role !== "CHAT" && input.role !== "COMPRESSION") {
        throw new UnsupportedModelAssignmentError(input.role, input.providerKey, input.modelName);
    }
    if (!isSupportedModelTarget(input.role, input.providerKey, input.modelName)) {
        if (input.role === "CHAT" && input.providerKey !== "zai" && input.providerKey !== "nuha") {
            throw new UnsupportedChatProviderError(input.providerKey);
        }
        throw new UnsupportedModelAssignmentError(input.role, input.providerKey, input.modelName);
    }

    let configJson = input.configJson;
    if (input.fallbacks !== undefined) {
        const existing = await db.aiModelAssignment.findUnique({
            where: { role: input.role as any },
            select: { configJson: true },
        });
        const existingConfig = parseModelAssignmentConfig(input.role, input.configJson ?? existing?.configJson);

        if (input.fallbacks === null) {
            const { fallbacks: _removedFallbacks, ...configWithoutFallbacks } = existingConfig;
            configJson = JSON.stringify(configWithoutFallbacks);
        } else {
            for (const fallback of input.fallbacks) {
                if (!isSupportedModelTarget(input.role, fallback.providerKey, fallback.modelName)) {
                    throw new UnsupportedModelAssignmentError(input.role, fallback.providerKey, fallback.modelName);
                }
            }
            const fallbackConfig = parseModelAssignmentConfig(input.role, JSON.stringify({ fallbacks: input.fallbacks }));
            configJson = JSON.stringify({ ...existingConfig, fallbacks: fallbackConfig.fallbacks });
        }
    } else if (configJson !== undefined) {
        configJson = JSON.stringify(parseModelAssignmentConfig(input.role, configJson));
    }

    const configData = configJson === undefined ? {} : { configJson };
    const assignment = await db.aiModelAssignment.upsert({
        where: { role: input.role as any },
        create: {
            role: input.role as any,
            providerKey: input.providerKey,
            modelName: input.modelName,
            ...configData,
        },
        update: {
            providerKey: input.providerKey,
            modelName: input.modelName,
            ...configData,
        },
    });

    return {
        id: assignment.id,
        role: assignment.role,
        providerKey: assignment.providerKey,
        modelName: assignment.modelName,
        ...(input.fallbacks === undefined || input.fallbacks === null ? {} : { fallbacks: input.fallbacks }),
        createdAt: assignment.createdAt.toISOString(),
        updatedAt: assignment.updatedAt.toISOString(),
    };
}

/** Remove an assignment so the runtime can use its legacy automatic fallback. */
export async function unassignModelRole(
    actor: SabahActor,
    role: string,
    db: PrismaClient = prisma,
): Promise<{ ok: true; role: string; unassigned: true }> {
    await requireAdmin(actor);
    if (role !== "CHAT" && role !== "COMPRESSION") {
        throw new UnsupportedModelAssignmentError(role, "", "");
    }
    await db.aiModelAssignment.deleteMany({ where: { role: role as any } });
    return { ok: true, role, unassigned: true };
}
