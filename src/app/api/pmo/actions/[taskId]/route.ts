import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { PmoReferenceError, updateExternalActionLegacy } from "@/lib/pmo/action-service";
import { PmoForbiddenError } from "@/lib/pmo/authorization";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { externalActionUpdateSchema } from "@/lib/pmo/schemas";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { taskId } = await params;
    const task = await prisma.task.findFirst({
        where: { id: taskId, type: "EXTERNAL_ACTION" },
        include: {
            externalAction: { include: { owner: true, externalContact: true, reminderRules: true, evidence: true, followUpEvents: true } },
            project: { include: { workArea: true } },
            caseStudy: { include: { workArea: true } },
            assignments: { include: { user: true } },
            tags: { include: { tag: true } },
            blockers: { include: { dependsOn: true } },
        },
    });
    if (!task) return NextResponse.json({ error: "External action not found" }, { status: 404 });
    return NextResponse.json(task);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { taskId } = await params;
        const input = externalActionUpdateSchema.parse(await request.json());
        return NextResponse.json(await updateExternalActionLegacy(taskId, input, actor));
    } catch (error) {
        if (error instanceof PmoForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        if (error instanceof PmoReferenceError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid external action" }, { status: 400 });
        throw error;
    }
}
