import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { executeNextStep } from "@/lib/sabah/workflows/service";
import { getRunnerDeps } from "@/lib/sabah/capabilities/runner-deps";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/workflows/[id]/execute - Execute next ready step
 *
 * Finds the first PENDING step whose dependencies are VERIFIED,
 * executes it via the capability runner, and updates workflow state.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        const runnerDeps = getRunnerDeps();

        const snapshot = await executeNextStep(actor, params.id, undefined, runnerDeps);

        return NextResponse.json(snapshot);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        console.error("POST /api/ai/workflows/[id]/execute error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}