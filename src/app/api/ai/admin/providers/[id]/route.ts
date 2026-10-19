import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import {
    CredentialConflictError,
    CredentialWriteUnavailableError,
    NoPreviousCredentialError,
    rollbackProviderCredential,
    rotateProviderCredential,
    type RotateCredentialInput,
} from "@/lib/sabah/providers/admin-service";

export const dynamic = "force-dynamic";

/**
 * PUT /api/ai/admin/providers/[id] - Rotate or roll back a provider credential
 * (ADMIN-only)
 *
 * Body { newCredential } replaces the stored credential in place, retaining
 * the outgoing value as one-level history. Body { action: "rollback" }
 * restores that retained previous version; 409 when none exists yet.
 */
export async function PUT(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = (await request.json()) as Partial<RotateCredentialInput> & { action?: string };
        const actor = await toSabahActor(session.user);

        if (params.id.startsWith("env:")) {
            return NextResponse.json({ error: "Environment-configured provider credentials are read-only" }, { status: 409 });
        }

        if (body.action === "rollback") {
            const restored = await rollbackProviderCredential(actor, params.id);
            return NextResponse.json({ ok: true, ...restored });
        }
        if (typeof body.newCredential !== "string" || body.newCredential.length === 0) {
            return NextResponse.json({ error: "newCredential is required" }, { status: 400 });
        }

        const provider = await rotateProviderCredential(actor, params.id, { newCredential: body.newCredential });
        return NextResponse.json(provider);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (error instanceof CredentialWriteUnavailableError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }

        if (error instanceof NoPreviousCredentialError || error instanceof CredentialConflictError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }

        if (error && typeof error === "object" && "issues" in error) {
            return NextResponse.json(
                { error: "Invalid request body", details: error },
                { status: 400 }
            );
        }

        console.error("PUT /api/ai/admin/providers/[id] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
