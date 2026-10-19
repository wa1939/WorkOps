import { NextResponse } from "next/server";
import { z } from "zod";
import { callGLMText } from "@/lib/glm";
import { prisma } from "@/lib/prisma";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { assertCanManageExternalAction, PmoForbiddenError } from "@/lib/pmo/authorization";
import { buildAiRewritePrompt, parseAiRewrite } from "@/lib/pmo/follow-up-draft";

const rewriteSchema = z.object({ subject: z.string().trim().min(1), body: z.string().trim().min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { taskId } = await params;
    const task = await prisma.task.findFirst({
        where: { id: taskId, type: "EXTERNAL_ACTION" },
        include: {
            externalAction: { include: { owner: { select: { managerId: true } } } },
            project: true,
            caseStudy: true,
        },
    });
    if (!task?.externalAction || !task.dueAt) {
        return NextResponse.json({ error: "External action not found" }, { status: 404 });
    }

    try {
        assertCanManageExternalAction(actor, {
            ownerId: task.externalAction.ownerId,
            parentOwnerId: task.project?.ownerId ?? task.caseStudy?.ownerId ?? null,
            ownerManagerId: task.externalAction.owner.managerId,
        });
    } catch (error) {
        if (error instanceof PmoForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        throw error;
    }

    let current: z.infer<typeof rewriteSchema>;
    try {
        current = rewriteSchema.parse(await request.json());
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid draft" }, { status: 400 });
        throw error;
    }

    try {
        const context = {
            actionTitle: task.title,
            parentName: task.project?.name ?? task.caseStudy?.name ?? "",
            dueDate: task.dueAt.toISOString().slice(0, 10),
        };
        const preview = parseAiRewrite(await callGLMText(
            buildAiRewritePrompt({ to: "", ...current }, context),
            { model: "glm-4.5-flash", temperature: 0.4, max_tokens: 700 },
        ));
        await prisma.auditLog.create({
            data: {
                entityType: "external_action",
                entityId: task.externalAction.id,
                action: "draft_ai_rewrite_preview",
                actorId: actor.id,
                taskId,
                metaJson: JSON.stringify({ fields: ["subject", "body"] }),
            },
        });
        return NextResponse.json({ preview });
    } catch {
        await prisma.auditLog.create({
            data: {
                entityType: "external_action",
                entityId: task.externalAction.id,
                action: "draft_ai_rewrite_failure",
                actorId: actor.id,
                taskId,
                metaJson: JSON.stringify({ fields: [] }),
            },
        });
        return NextResponse.json({ error: "AI rewrite unavailable" }, { status: 502 });
    }
}
