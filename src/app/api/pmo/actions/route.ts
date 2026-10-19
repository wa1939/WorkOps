import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createExternalAction, PmoReferenceError } from "@/lib/pmo/action-service";
import { PmoForbiddenError } from "@/lib/pmo/authorization";
import { externalActionCreateSchema } from "@/lib/pmo/schemas";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";

export async function GET() {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await prisma.task.findMany({ where: { type: "EXTERNAL_ACTION" }, include: { externalAction: { include: { owner: true, externalContact: true, reminderRules: true, evidence: true } }, project: { include: { workArea: true } }, caseStudy: { include: { workArea: true } } }, orderBy: { dueAt: "asc" } }));
}

export async function POST(request: Request) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (actor.role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
        const input = externalActionCreateSchema.parse(await request.json());
        const result = await createExternalAction(input, actor);
        return NextResponse.json({ taskId: result.taskId, externalActionId: result.externalActionId }, { status: 201 });
    } catch (error) {
        if (error instanceof PmoForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        if (error instanceof PmoReferenceError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid external action" }, { status: 400 });
        throw error;
    }
}
