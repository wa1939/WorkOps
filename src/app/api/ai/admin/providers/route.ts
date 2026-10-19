import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import {
    listProviderCredentials,
    createProviderCredential,
    CredentialWriteUnavailableError,
} from "@/lib/sabah/providers/admin-service";

export const dynamic = "force-dynamic";

const createCredentialSchema = z.object({
    providerKey: z.string().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
    credential: z.string().min(1).max(16_384),
}).strict();

function isProviderSchemaError(error: unknown): boolean {
    return error !== null
        && typeof error === "object"
        && "code" in error
        && ((error as { code?: unknown }).code === "P2021" || (error as { code?: unknown }).code === "P2022");
}

/**
 * GET /api/ai/admin/providers - List all provider credentials (ADMIN-only)
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        let storedProviders: Awaited<ReturnType<typeof listProviderCredentials>> = [];
        try {
            storedProviders = await listProviderCredentials(actor);
        } catch (error) {
            // Keep the admin surface useful while an older database is waiting
            // for the provider migration: env-backed metadata is still safe to
            // expose, while all other failures remain real server errors.
            if (!isProviderSchemaError(error)) throw error;
        }
        const providers: Array<Omit<(typeof storedProviders)[number], "source"> & {
            source: "db" | "env" | "placeholder";
        }> = [...storedProviders];
        // Environment-configured providers (no DB credential row) still need to
        // be listed so admins can assign model roles to them: zai (GLM) and
        // nuha (Nuha-2.1) read their keys from env vars.
        const envProviders: Array<{ key: string; configured: boolean }> = [
            { key: "zai", configured: Boolean(process.env.GLM_API_KEY) },
            { key: "nuha", configured: Boolean(process.env.NUHA_API_KEY) },
        ];
        const epoch = new Date(0).toISOString();
        for (const envProvider of envProviders) {
            if (providers.some((row) => row.providerKey === envProvider.key)) continue;
            providers.push({
                id: `${envProvider.configured ? "env" : "new"}:${envProvider.key}`,
                providerKey: envProvider.key,
                keyVersion: 0,
                isEnabled: envProvider.configured,
                maskedHint: envProvider.configured ? "configured via environment" : "not configured",
                createdAt: epoch,
                updatedAt: epoch,
                source: envProvider.configured ? "env" : "placeholder",
                mutable: !envProvider.configured,
            });
        }
        return NextResponse.json({ providers });
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        console.error("GET /api/ai/admin/providers error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * POST /api/ai/admin/providers - Create a new provider credential (ADMIN-only)
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        const body = createCredentialSchema.parse(await request.json());

        const provider = await createProviderCredential(actor, body);
        return NextResponse.json(provider, { status: 201 });
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (error instanceof CredentialWriteUnavailableError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }

        if (error && typeof error === "object" && "issues" in error) {
            return NextResponse.json(
                { error: "Invalid request body", details: error },
                { status: 400 }
            );
        }

        console.error("POST /api/ai/admin/providers error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

// Credential rotation lives at the item URL: see providers/[id]/route.ts.
