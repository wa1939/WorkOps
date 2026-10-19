import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { decide, WorkflowServiceError, type WorkflowFeedbackRecorder } from "@/lib/sabah/workflows/service";
import { createFeedbackService, createPrismaFeedbackRepository } from "@/lib/sabah/feedback/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/workflows/[id]/decision - Record a workflow decision
 *
 * Records an APPROVE, REJECT, RENEW, CLARIFY, or RESOLVE_DUPLICATE decision.
 * RENEW atomically expires an expired approved gate and creates a fresh
 * PENDING gate; it never grants execution authority.
 * Updates approval status and workflow state accordingly.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const actor = await toSabahActor(session.user);

        const feedback = createFeedbackService(createPrismaFeedbackRepository(), { authorizeSource: async (source) => source.kind === "WORKFLOW" && source.id === params.id, authorizeScope: async (scope, scopeId, feedbackActor) => scope === "PERSONAL" && scopeId === feedbackActor.id });
        const recorder: WorkflowFeedbackRecorder = async (feedbackInput, workflowActor) => { await feedback.recordFeedback(feedbackInput, { id: workflowActor.id, scope: "PERSONAL", scopeId: workflowActor.id }); };
        const snapshot = await decide(actor, params.id, body, undefined, undefined, recorder);

        return NextResponse.json(snapshot);
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

        console.error("POST /api/ai/workflows/[id]/decision error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}