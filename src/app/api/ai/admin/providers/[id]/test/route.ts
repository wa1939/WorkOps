import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { testProviderCredential, ProviderCredentialNotConfiguredError } from "@/lib/sabah/providers/admin-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/admin/providers/[id]/test - Test a provider credential (ADMIN-only)
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        const { id } = params;

        if (id.startsWith("env:")) {
            return NextResponse.json({ error: "Environment-configured provider credentials are read-only" }, { status: 409 });
        }
        if (id.startsWith("new:")) {
            return NextResponse.json({
                error: "Provider credential is not configured; save a credential before testing",
                code: "CREDENTIAL_NOT_CONFIGURED",
            }, { status: 409 });
        }

        const result = await testProviderCredential(actor, id);
        return NextResponse.json(result);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (error instanceof ProviderCredentialNotConfiguredError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }

        console.error("POST /api/ai/admin/providers/[id]/test error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
