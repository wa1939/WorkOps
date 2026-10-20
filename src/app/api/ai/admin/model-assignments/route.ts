import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AI_PROVIDERS } from "@/lib/ai/provider-config";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { assignModelRole, listModelAssignments, unassignModelRole, UnsupportedChatProviderError, UnsupportedModelAssignmentError } from "@/lib/sabah/providers/admin-service";
import { InvalidModelAssignmentConfigError, MAX_MODEL_FALLBACKS } from "@/lib/sabah/providers/roles";

export const dynamic = "force-dynamic";

const fallbackTargetSchema = z.object({
    providerKey: z.enum(AI_PROVIDERS),
    modelName: z.string().min(1).max(128),
}).strict();

const assignRoleSchema = z.union([
    z.object({
        role: z.enum(["CHAT", "COMPRESSION"]),
        providerKey: z.string().min(1).max(64),
        modelName: z.string().min(1).max(128),
        fallbacks: z.array(fallbackTargetSchema).max(MAX_MODEL_FALLBACKS).nullable().optional(),
    }).strict(),
    z.object({
        role: z.enum(["CHAT", "COMPRESSION"]),
        providerKey: z.null(),
        modelName: z.null(),
    }).strict(),
]);

function assignmentResponse(assignment: Awaited<ReturnType<typeof listModelAssignments>>[number]) {
    return {
        role: assignment.role,
        providerKey: assignment.providerKey,
        model: assignment.modelName,
        ...(assignment.fallbacks === undefined
            ? {}
            : { fallbacks: assignment.fallbacks.map((fallback) => ({ providerKey: fallback.providerKey, model: fallback.modelName })) }),
    };
}

/**
 * GET /api/ai/admin/model-assignments - List model role assignments (ADMIN-only)
 *
 * Returns the UI shape: `model` mirrors the persisted modelName.
 */
export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        const assignments = await listModelAssignments(actor);
        return NextResponse.json({ assignments: assignments.map(assignmentResponse) });
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (error instanceof InvalidModelAssignmentConfigError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }
        console.error("GET /api/ai/admin/model-assignments error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

/**
 * PUT /api/ai/admin/model-assignments - Assign a model role (ADMIN-only)
 */
export async function PUT(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const actor = await toSabahActor(session.user);
        const body = assignRoleSchema.parse(await request.json());

        if (body.providerKey === null) {
            return NextResponse.json(await unassignModelRole(actor, body.role));
        }

        const assignment = await assignModelRole(actor, body);
        return NextResponse.json(assignmentResponse(assignment));
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (error && typeof error === "object" && "issues" in error) {
            return NextResponse.json(
                { error: "Invalid request body", details: error },
                { status: 400 }
            );
        }

        if (error instanceof InvalidModelAssignmentConfigError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }

        if (error instanceof UnsupportedModelAssignmentError || error instanceof UnsupportedChatProviderError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }

        console.error("PUT /api/ai/admin/model-assignments error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
