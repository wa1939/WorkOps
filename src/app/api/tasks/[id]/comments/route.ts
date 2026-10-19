import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
    allowedMentionUserIds,
    authorizeTaskView,
    badRequestResponse,
    commentInclude,
    commentText,
    commentInputSchema,
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
const PAGE_SIZE = 50;

export async function GET(request: Request, context: CommentRouteParams): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return unauthorizedResponse();
        const { id: taskId } = await routeParams(context);
        if (!(await authorizeTaskView(actor, taskId))) return notFoundResponse();

        const cursor = new URL(request.url).searchParams.get("cursor");
        let after: { id: string; createdAt: Date } | null = null;
        if (cursor) {
            after = await prisma.comment.findFirst({
                where: { id: cursor, taskId },
                select: { id: true, createdAt: true },
            });
            if (!after) return badRequestResponse(new Error("Invalid comment cursor"));
        }

        const comments = await prisma.comment.findMany({
            where: {
                taskId,
                ...(after
                    ? {
                        OR: [
                            { createdAt: { gt: after.createdAt } },
                            { createdAt: after.createdAt, id: { gt: after.id } },
                        ],
                    }
                    : {}),
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: PAGE_SIZE + 1,
            include: commentInclude(actor.id),
        });

        const hasMore = comments.length > PAGE_SIZE;
        const page = hasMore ? comments.slice(0, PAGE_SIZE) : comments;
        const serialized = page.map((comment) => serializeComment(comment, actor.id));
        return NextResponse.json({
            viewerId: actor.id,
            comments: serialized,
            myReads: serialized
                .filter((comment) => comment.myReadAt !== null)
                .map((comment) => ({ commentId: comment.id, readAt: comment.myReadAt })),
            nextCursor: hasMore ? serialized[serialized.length - 1]?.id ?? null : null,
        });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) return badRequestResponse(error);
        return serverErrorResponse(error, "Failed to fetch comments");
    }
}

export async function POST(request: Request, context: CommentRouteParams): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return unauthorizedResponse();
        const { id: taskId } = await routeParams(context);
        if (!(await authorizeTaskView(actor, taskId))) return notFoundResponse();
        const input = commentInputSchema.parse(await request.json());
        const mentionUserIds = await allowedMentionUserIds(taskId, input.mentionUserIds);
        const created = await prisma.comment.create({
            data: {
                taskId,
                authorId: actor.id,
                body: commentText(input),
                mentionUserIds,
            },
            include: commentInclude(actor.id),
        });
        return NextResponse.json(serializeComment(created, actor.id), { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) return badRequestResponse(error);
        return serverErrorResponse(error, "Failed to create comment");
    }
}
