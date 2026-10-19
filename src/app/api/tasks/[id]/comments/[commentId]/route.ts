import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    allowedMentionUserIds,
    authorizeCommentEdit,
    badRequestResponse,
    commentInclude,
    commentInputSchema,
    commentText,
    notFoundResponse,
    routeParams,
    serializeComment,
    serverErrorResponse,
    sessionActor,
    unauthorizedResponse,
    type CommentRouteParams,
} from "@/lib/comments/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: CommentRouteParams): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return unauthorizedResponse();
        const { id: taskId, commentId } = await routeParams(context);
        if (!commentId) return notFoundResponse();
        const denied = await authorizeCommentEdit(actor, taskId, commentId);
        if (denied) return denied;

        const input = commentInputSchema.parse(await request.json());
        const mentionUserIds = await allowedMentionUserIds(taskId, input.mentionUserIds);
        const updated = await prisma.comment.update({
            where: { id: commentId },
            data: {
                body: commentText(input),
                mentionUserIds,
                editedAt: new Date(),
            },
            include: commentInclude(actor.id),
        });
        return NextResponse.json(serializeComment(updated, actor.id));
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) return badRequestResponse(error);
        return serverErrorResponse(error, "Failed to update comment");
    }
}

export async function DELETE(_request: Request, context: CommentRouteParams): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return unauthorizedResponse();
        const { id: taskId, commentId } = await routeParams(context);
        if (!commentId) return notFoundResponse();
        const denied = await authorizeCommentEdit(actor, taskId, commentId);
        if (denied) return denied;

        const deleted = await prisma.comment.update({
            where: { id: commentId },
            data: { deletedAt: new Date() },
            include: commentInclude(actor.id),
        });
        return NextResponse.json(serializeComment(deleted, actor.id));
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) return badRequestResponse(error);
        return serverErrorResponse(error, "Failed to delete comment");
    }
}
