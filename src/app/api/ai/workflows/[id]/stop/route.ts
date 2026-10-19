import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { getSnapshot } from "@/lib/sabah/workflows/service";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/workflows/[id]/stop - Stop a workflow
 *
 * Marks the workflow as CANCELED and prevents further step execution.
 * Updates all PENDING steps to SKIPPED.
 */
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);

        // Check workflow ownership
        const workflow = await prisma.aiWorkflow.findUnique({
            where: { id: params.id },
        });

        if (!workflow) {
            return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
        }

        if (workflow.actorId !== actor.id && actor.role !== "ADMIN") {
            throw new SabahForbiddenError();
        }

        // Stop only a workflow that is still running: a completion/stop race
        // must never rewrite a terminal COMPLETED/FAILED outcome.
        const stopped = await prisma.$transaction(async (transaction) => {
            const stoppedAt = new Date();
            const workflowClaim = await transaction.aiWorkflow.updateMany({
                where: { id: params.id, status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } },
                data: { status: "CANCELED", completedAt: stoppedAt },
            });
            if (workflowClaim.count === 1) {
                await transaction.aiWorkflowStep.updateMany({
                    where: { workflowId: params.id, status: { in: ["PENDING", "APPROVAL_REQUIRED"] } },
                    data: { status: "SKIPPED", completedAt: stoppedAt },
                });
                await transaction.aiApproval.updateMany({
                    where: { workflowId: params.id, status: "PENDING" },
                    data: {
                        status: "REJECTED",
                        decidedById: actor.id,
                        decidedAt: stoppedAt,
                        decisionType: "REJECT",
                        decisionReason: "Workflow stopped",
                    },
                });
            }
            return workflowClaim;
        });

        if (stopped.count !== 1) {
            const current = await prisma.aiWorkflow.findUnique({ where: { id: params.id } });
            if (current?.status !== "CANCELED") {
                return NextResponse.json(
                    { error: `Workflow already ${current?.status.toLowerCase() ?? workflow.status.toLowerCase()}`, status: current?.status ?? workflow.status },
                    { status: 409 }
                );
            }
        }

        // Return the refreshed snapshot: the Sabah client validates stop
        // responses against the full workflow snapshot schema.
        const snapshot = await getSnapshot(actor, params.id, prisma);
        return NextResponse.json(snapshot);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        console.error("POST /api/ai/workflows/[id]/stop error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}