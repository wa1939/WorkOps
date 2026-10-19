import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    authorizeTaskView,
    badRequestResponse,
    notFoundResponse,
    reactionSchema,
    routeParams,
    serializeReactions,
    serverErrorResponse,
    sessionActor,
    taskComment,
    unauthorizedResponse,
    type CommentRouteParams,
} from "@/lib/comments/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

async function authorizeReactionRoute(actor: { id: string; role?: string | null }, taskId: string, commentId: string): Promise<Response | null> {
    if (!(await authorizeTaskView(actor, taskId))) return notFoundResponse();
    const comment = await taskComment(taskId, commentId);
    return comment ? null : notFoundResponse();
}

async function reactionRoster(commentId: string, actorId: string) {
    const reactions = await prisma.commentReaction.findMany({
        where: { commentId },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true, email: true, image: true } } },
    });
    return serializeReactions(reactions, actorId);
}

export async function GET(_request: Request, context: CommentRouteParams): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return unauthorizedResponse();
        const { id: taskId, commentId } = await routeParams(context);
        if (!commentId) return notFoundResponse();
        const denied = await authorizeReactionRoute(actor, taskId, commentId);
        if (denied) return denied;
        return NextResponse.json({ reactions: await reactionRoster(commentId, actor.id) });
    } catch (error) {
        return serverErrorResponse(error, "Failed to fetch reactions");
    }
}

export async function POST(request: Request, context: CommentRouteParams): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return unauthorizedResponse();
        const { id: taskId, commentId } = await routeParams(context);
        if (!commentId) return notFoundResponse();
        const denied = await authorizeReactionRoute(actor, taskId, commentId);
        if (denied) return denied;
        const { emoji } = reactionSchema.parse(await request.json());
        const active = await prisma.$transaction(async (tx) => {
            const removed = await tx.commentReaction.deleteMany({
                where: { commentId, userId: actor.id, emoji },
            });
            if (removed.count > 0) return false;
            await tx.commentReaction.create({ data: { commentId, userId: actor.id, emoji } });
            return true;
        });
        return NextResponse.json({ commentId, emoji, active, reactions: await reactionRoster(commentId, actor.id) });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) return badRequestResponse(error);
        return serverErrorResponse(error, "Failed to toggle reaction");
    }
}
