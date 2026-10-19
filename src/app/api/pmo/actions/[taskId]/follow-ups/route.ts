import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { PmoForbiddenError } from "@/lib/pmo/authorization";
import { markFollowUpSent } from "@/lib/pmo/follow-up-service";
import { markFollowUpSentSchema } from "@/lib/pmo/schemas";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { taskId } = await params;
    return NextResponse.json(await prisma.followUpEvent.findMany({
        where: { externalAction: { taskId } },
        select: {
            id: true,
            triggerType: true,
            scheduledDate: true,
            sentAt: true,
            sentBy: { select: { name: true } },
            finalRecipient: true,
            finalSubject: true,
            finalBody: true,
        },
        orderBy: { createdAt: "desc" },
    }));
}

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { taskId } = await params;
        const input = markFollowUpSentSchema.parse(await request.json());
        return NextResponse.json(await markFollowUpSent(taskId, input, actor), { status: 201 });
    } catch (error) {
        if (error instanceof PmoForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid follow-up" }, { status: 400 });
        console.error("POST /api/pmo/actions/[taskId]/follow-ups error:", error);
        return NextResponse.json({ error: "Unable to record follow-up" }, { status: 400 });
    }
}
