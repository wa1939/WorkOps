import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    authorizeTaskView,
    badRequestResponse,
    notFoundResponse,
    readCommentsSchema,
    routeParams,
    serverErrorResponse,
    sessionActor,
    unauthorizedResponse,
    type CommentRouteParams,
} from "@/lib/comments/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: CommentRouteParams): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return unauthorizedResponse();
        const { id: taskId } = await routeParams(context);
        if (!(await authorizeTaskView(actor, taskId))) return notFoundResponse();
        const { commentIds } = readCommentsSchema.parse(await request.json());
        const uniqueIds = Array.from(new Set(commentIds));
        const visibleComments = await prisma.comment.findMany({
            where: { taskId, id: { in: uniqueIds } },
            select: { id: true },
        });
        if (visibleComments.length !== uniqueIds.length) return badRequestResponse(new Error("Comments must belong to the task"));

        const readAt = new Date();
        await prisma.$transaction(
            uniqueIds.map((commentId) => prisma.commentRead.upsert({
                where: { commentId_userId: { commentId, userId: actor.id } },
                update: { readAt },
                create: { commentId, userId: actor.id, readAt },
            })),
        );
        return NextResponse.json({ read: uniqueIds, readAt: readAt.toISOString() });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) return badRequestResponse(error);
        return serverErrorResponse(error, "Failed to mark comments as read");
    }
}
