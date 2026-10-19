import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import type { AuthzUser } from "@/lib/authz/types";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const userSelect = { id: true, name: true, email: true, image: true } as const;

export type CommentRouteParams = {
    params: Promise<{ id: string; commentId?: string }>;
};

export type CommentAuthor = {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
};

type ReactionRow = {
    id: string;
    userId: string;
    emoji: string;
    createdAt: Date;
    user: CommentAuthor;
};

type CommentRow = {
    id: string;
    body: string;
    taskId: string;
    authorId: string | null;
    mentionUserIds: string[];
    editedAt: Date | null;
    deletedAt: Date | null;
    isHandoverUpdate: boolean;
    createdAt: Date;
    author: CommentAuthor | null;
    reactions: ReactionRow[];
    reads: Array<{ readAt: Date }>;
};

export type SerializedReaction = {
    emoji: string;
    count: number;
    reactedByMe: boolean;
    users: Array<Pick<CommentAuthor, "id" | "name" | "image">>;
};

export type SerializedComment = {
    id: string;
    taskId: string;
    body: string;
    authorId: string | null;
    author: CommentAuthor | null;
    mentionUserIds: string[];
    createdAt: string;
    editedAt: string | null;
    deletedAt: string | null;
    isDeleted: boolean;
    isHandoverUpdate: boolean;
    myReadAt: string | null;
    reactions: SerializedReaction[];
};

export const commentInputSchema = z.object({
    text: z.string().trim().min(1).max(20_000).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
    mentionUserIds: z.array(z.string().trim().min(1).max(200)).max(100).optional().default([]),
    attachmentIds: z.array(z.string().trim().min(1).max(200)).max(5).optional(),
}).strict().superRefine((value, context) => {
    if (!value.text && !value.body) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["text"], message: "Comment text is required" });
    }
});

export const reactionSchema = z.object({
    emoji: z.string().trim().min(1).max(32),
}).strict();

export const readCommentsSchema = z.object({
    commentIds: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
}).strict();

export async function sessionActor(): Promise<AuthzUser | null> {
    let session: { user?: unknown } | null = null;
    try {
        session = await auth();
    } catch (error) {
        console.error("[comments] session lookup failed", error);
        return null;
    }

    const user = session?.user;
    if (!user || typeof user !== "object") return null;
    const candidate = user as { id?: unknown; role?: unknown };
    if (typeof candidate.id !== "string" || candidate.id.length === 0) return null;
    return {
        id: candidate.id,
        role: typeof candidate.role === "string" ? candidate.role : null,
    };
}

export function unauthorizedResponse(): Response {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export function forbiddenResponse(): Response {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function notFoundResponse(): Response {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export function badRequestResponse(error: unknown): Response {
    if (error instanceof z.ZodError) {
        return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
}

export function serverErrorResponse(error: unknown, message: string): Response {
    console.error(`[comments] ${message}`, error);
    return NextResponse.json({ error: message }, { status: 500 });
}

export async function routeParams(context: CommentRouteParams): Promise<{ id: string; commentId?: string }> {
    return await context.params;
}

export async function authorizeTaskView(actor: AuthzUser, taskId: string): Promise<boolean> {
    return authorize(actor, "task:view", { kind: "task", id: taskId });
}

export async function taskComment(taskId: string, commentId: string): Promise<{ id: string; taskId: string; authorId: string | null; deletedAt: Date | null } | null> {
    return prisma.comment.findFirst({
        where: { id: commentId, taskId },
        select: { id: true, taskId: true, authorId: true, deletedAt: true },
    });
}

/** Gate comment mutations while keeping task privacy indistinguishable. */
export async function authorizeCommentEdit(
    actor: AuthzUser,
    taskId: string,
    commentId: string,
): Promise<Response | null> {
    if (!(await authorizeTaskView(actor, taskId))) return notFoundResponse();
    const comment = await taskComment(taskId, commentId);
    if (!comment) return notFoundResponse();
    if (!(await authorize(actor, "comment:edit", { kind: "comment", id: commentId }))) {
        return forbiddenResponse();
    }
    return null;
}

export async function allowedMentionUserIds(taskId: string, requestedIds: readonly string[]): Promise<string[]> {
    if (requestedIds.length === 0) return [];
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { project: { select: { members: { select: { userId: true } } } } },
    });
    const validIds = new Set(task?.project?.members.map((member) => member.userId) ?? []);
    return Array.from(new Set(requestedIds.filter((id) => validIds.has(id))));
}

export function commentText(input: z.infer<typeof commentInputSchema>): string {
    return input.text ?? input.body ?? "";
}

export function serializeReactions(reactions: readonly ReactionRow[], actorId: string): SerializedReaction[] {
    const grouped = new Map<string, SerializedReaction>();
    for (const reaction of reactions) {
        const existing = grouped.get(reaction.emoji);
        const user = { id: reaction.user.id, name: reaction.user.name, image: reaction.user.image };
        if (existing) {
            existing.count += 1;
            existing.reactedByMe ||= reaction.userId === actorId;
            existing.users.push(user);
            continue;
        }
        grouped.set(reaction.emoji, {
            emoji: reaction.emoji,
            count: 1,
            reactedByMe: reaction.userId === actorId,
            users: [user],
        });
    }
    return Array.from(grouped.values());
}

export function serializeComment(comment: CommentRow, actorId: string): SerializedComment {
    return {
        id: comment.id,
        taskId: comment.taskId,
        body: comment.body,
        authorId: comment.authorId,
        author: comment.author,
        mentionUserIds: comment.mentionUserIds,
        createdAt: comment.createdAt.toISOString(),
        editedAt: comment.editedAt?.toISOString() ?? null,
        deletedAt: comment.deletedAt?.toISOString() ?? null,
        isDeleted: comment.deletedAt !== null,
        isHandoverUpdate: comment.isHandoverUpdate,
        myReadAt: comment.reads[0]?.readAt.toISOString() ?? null,
        reactions: serializeReactions(comment.reactions, actorId),
    };
}

export function commentInclude(userId: string) {
    return {
        author: { select: userSelect },
        reactions: {
            orderBy: { createdAt: "asc" as const },
            include: { user: { select: userSelect } },
        },
        reads: {
            where: { userId },
            select: { readAt: true },
        },
    } as const;
}

export async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(await request.json());
}
