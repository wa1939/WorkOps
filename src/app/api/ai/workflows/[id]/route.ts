import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { getSnapshot } from "@/lib/sabah/workflows/service";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/workflows/[id] - Get workflow snapshot
 *
 * Returns the workflow snapshot for the given workflow ID.
 * Actor-scoped: returns 404 for inaccessible workflows.
 */
export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        const snapshot = await getSnapshot(actor, params.id);

        return NextResponse.json(snapshot);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (error instanceof Error && error.message.includes("not found")) {
            return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
        }

        console.error("GET /api/ai/workflows/[id] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}