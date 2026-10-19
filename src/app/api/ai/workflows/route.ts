import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { proposeWorkflow, listWorkflows, WorkflowServiceError } from "@/lib/sabah/workflows/service";
import { getRunnerDeps } from "@/lib/sabah/capabilities/runner-deps";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/workflows - List actor-scoped workflows
 */
export async function GET(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        const status = request.nextUrl.searchParams.get("status") ?? undefined;
        const conversationId = request.nextUrl.searchParams.get("conversationId") ?? undefined;
        const limitParam = request.nextUrl.searchParams.get("limit");
        const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : undefined;
        if (conversationId && !/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) {
            return NextResponse.json({ error: "Invalid conversationId" }, { status: 400 });
        }

        const workflows = await listWorkflows(actor, { status, conversationId, limit });
        return NextResponse.json({ workflows });
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        console.error("GET /api/ai/workflows error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * POST /api/ai/workflows - Propose a new workflow
 *
 * Creates a new workflow from the proposed workflow definition.
 * Validates input via proposedWorkflowSchema, persists workflow and steps.
 * Idempotent via idempotencyKey.
 */
export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const actor = await toSabahActor(session.user);
        const runnerDeps = getRunnerDeps();

        const snapshot = await proposeWorkflow(actor, body, undefined, runnerDeps);

        return NextResponse.json(snapshot, { status: 201 });
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (error instanceof WorkflowServiceError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }

        // Zod validation errors
        if (error && typeof error === "object" && "issues" in error) {
            return NextResponse.json(
                { error: "Invalid request body", details: error },
                { status: 400 }
            );
        }

        console.error("POST /api/ai/workflows error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}