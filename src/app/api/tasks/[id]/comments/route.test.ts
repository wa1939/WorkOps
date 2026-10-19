import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../../../../../../scripts/assert-local-database";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));

const databaseUrl = readDatabaseUrl();
if (databaseUrl) {
    const parsed = assertLocalDatabaseUrl(databaseUrl);
    if (!parsed.pathname.endsWith("_test")) {
        throw new Error("Comments route tests require a database name ending with _test");
    }
    process.env.DATABASE_URL = databaseUrl;
}
const databaseEnabled = Boolean(databaseUrl);

import { GET as listComments, POST as createComment } from "./route";
import { DELETE as deleteComment, PATCH as updateComment } from "./[commentId]/route";
import { GET as listReactions, POST as toggleReaction } from "./[commentId]/reactions/route";
import { POST as markCommentsRead } from "./read/route";

const db = new PrismaClient();

type Fixture = {
    actorId: string;
    otherId: string;
    projectId: string;
    taskId: string;
    commentId?: string;
};

function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
    return { params: Promise.resolve(value) };
}

function request(path: string, method: string, body?: unknown): NextRequest {
    return new NextRequest(`https://app.example${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

async function createFixture(): Promise<Fixture> {
    const suffix = randomUUID();
    const fixture: Fixture = {
        actorId: `comments-actor-${suffix}`,
        otherId: `comments-other-${suffix}`,
        projectId: `comments-project-${suffix}`,
        taskId: `comments-task-${suffix}`,
    };
    await db.user.createMany({
        data: [
            { id: fixture.actorId, email: `${fixture.actorId}@example.test`, name: "Alice Author", role: "MEMBER" },
            { id: fixture.otherId, email: `${fixture.otherId}@example.test`, name: "Bob Reviewer", role: "MEMBER" },
        ],
    });
    await db.project.create({ data: { id: fixture.projectId, name: "Comments project" } });
    await db.projectMember.createMany({
        data: [
            { projectId: fixture.projectId, userId: fixture.actorId, accessLevel: "MEMBER" },
            { projectId: fixture.projectId, userId: fixture.otherId, accessLevel: "MEMBER" },
        ],
    });
    await db.task.create({
        data: {
            id: fixture.taskId,
            title: "Comments task",
            projectId: fixture.projectId,
            createdById: fixture.actorId,
            status: "TODO",
        },
    });
    return fixture;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
    await db.task.deleteMany({ where: { id: fixture.taskId } });
    await db.projectMember.deleteMany({ where: { projectId: fixture.projectId } });
    await db.project.deleteMany({ where: { id: fixture.projectId } });
    await db.user.deleteMany({ where: { id: { in: [fixture.actorId, fixture.otherId] } } });
}

describe.runIf(databaseEnabled)("task comments routes", () => {
    let fixture: Fixture;

    beforeEach(async () => {
        fixture = await createFixture();
        mocks.auth.mockResolvedValue({ user: { id: fixture.actorId, role: "MEMBER" } });
    });

    afterAll(async () => {
        await db.$disconnect();
    });

    it("round-trips a comment with validated mention ids and author data", async () => {
        try {
            const createdResponse = await createComment(
                request(`/api/tasks/${fixture.taskId}/comments`, "POST", {
                    text: "Please review this, @Bob Reviewer",
                    mentionUserIds: [fixture.otherId],
                }),
                params({ id: fixture.taskId }),
            );
            expect(createdResponse.status).toBe(201);
            const created = await createdResponse.json();
            expect(created).toMatchObject({
                taskId: fixture.taskId,
                body: "Please review this, @Bob Reviewer",
                mentionUserIds: [fixture.otherId],
                author: { id: fixture.actorId, name: "Alice Author" },
            });

            const listedResponse = await listComments(
                request(`/api/tasks/${fixture.taskId}/comments`, "GET"),
                params({ id: fixture.taskId }),
            );
            expect(listedResponse.status).toBe(200);
            const listed = await listedResponse.json();
            expect(listed.comments).toHaveLength(1);
            expect(listed.comments[0]).toMatchObject({
                id: created.id,
                mentionUserIds: [fixture.otherId],
                myReadAt: null,
                reactions: [],
            });
            expect(listed.nextCursor).toBeNull();
        } finally {
            await cleanupFixture(fixture);
        }
    });

    it("toggles a reaction and returns a named roster", async () => {
        try {
            const createdResponse = await createComment(
                request(`/api/tasks/${fixture.taskId}/comments`, "POST", { text: "React to me", mentionUserIds: [] }),
                params({ id: fixture.taskId }),
            );
            const comment = await createdResponse.json();

            const addedResponse = await toggleReaction(
                request(`/api/tasks/${fixture.taskId}/comments/${comment.id}/reactions`, "POST", { emoji: "👍" }),
                params({ id: fixture.taskId, commentId: comment.id }),
            );
            expect(addedResponse.status).toBe(200);
            expect(await addedResponse.json()).toMatchObject({ active: true, emoji: "👍" });

            const rosterResponse = await listReactions(
                request(`/api/tasks/${fixture.taskId}/comments/${comment.id}/reactions`, "GET"),
                params({ id: fixture.taskId, commentId: comment.id }),
            );
            expect(await rosterResponse.json()).toEqual({
                reactions: [{ emoji: "👍", count: 1, reactedByMe: true, users: [{ id: fixture.actorId, name: "Alice Author", image: null }] }],
            });

            const removedResponse = await toggleReaction(
                request(`/api/tasks/${fixture.taskId}/comments/${comment.id}/reactions`, "POST", { emoji: "👍" }),
                params({ id: fixture.taskId, commentId: comment.id }),
            );
            expect(removedResponse.status).toBe(200);
            expect(await removedResponse.json()).toMatchObject({ active: false, emoji: "👍" });
        } finally {
            await cleanupFixture(fixture);
        }
    });

    it("upserts read receipts for visible comments", async () => {
        try {
            const createdResponse = await createComment(
                request(`/api/tasks/${fixture.taskId}/comments`, "POST", { text: "Mark me read", mentionUserIds: [] }),
                params({ id: fixture.taskId }),
            );
            const comment = await createdResponse.json();
            const firstResponse = await markCommentsRead(
                request(`/api/tasks/${fixture.taskId}/comments/read`, "POST", { commentIds: [comment.id] }),
                params({ id: fixture.taskId }),
            );
            expect(firstResponse.status).toBe(200);
            const first = await firstResponse.json();
            expect(first.read).toEqual([comment.id]);
            const firstRow = await db.commentRead.findUnique({ where: { commentId_userId: { commentId: comment.id, userId: fixture.actorId } } });
            expect(firstRow?.readAt).toBeInstanceOf(Date);

            const secondResponse = await markCommentsRead(
                request(`/api/tasks/${fixture.taskId}/comments/read`, "POST", { commentIds: [comment.id] }),
                params({ id: fixture.taskId }),
            );
            expect(secondResponse.status).toBe(200);
            expect((await db.commentRead.count({ where: { commentId: comment.id, userId: fixture.actorId } }))).toBe(1);
        } finally {
            await cleanupFixture(fixture);
        }
    });

    it("allows the author to edit but denies another member", async () => {
        try {
            const createdResponse = await createComment(
                request(`/api/tasks/${fixture.taskId}/comments`, "POST", { text: "Original", mentionUserIds: [] }),
                params({ id: fixture.taskId }),
            );
            const comment = await createdResponse.json();

            const authorResponse = await updateComment(
                request(`/api/tasks/${fixture.taskId}/comments/${comment.id}`, "PATCH", { text: "Edited", mentionUserIds: [] }),
                params({ id: fixture.taskId, commentId: comment.id }),
            );
            expect(authorResponse.status).toBe(200);
            expect((await authorResponse.json()).body).toBe("Edited");

            mocks.auth.mockResolvedValue({ user: { id: fixture.otherId, role: "MEMBER" } });
            const otherResponse = await updateComment(
                request(`/api/tasks/${fixture.taskId}/comments/${comment.id}`, "PATCH", { text: "Nope", mentionUserIds: [] }),
                params({ id: fixture.taskId, commentId: comment.id }),
            );
            expect(otherResponse.status).toBe(403);
        } finally {
            await cleanupFixture(fixture);
        }
    });

    it("soft-deletes a comment and keeps its tombstone", async () => {
        try {
            const createdResponse = await createComment(
                request(`/api/tasks/${fixture.taskId}/comments`, "POST", { text: "Delete me", mentionUserIds: [] }),
                params({ id: fixture.taskId }),
            );
            const comment = await createdResponse.json();
            const response = await deleteComment(
                request(`/api/tasks/${fixture.taskId}/comments/${comment.id}`, "DELETE"),
                params({ id: fixture.taskId, commentId: comment.id }),
            );
            expect(response.status).toBe(200);
            expect((await db.comment.findUnique({ where: { id: comment.id }, select: { deletedAt: true, body: true } }))).toMatchObject({ body: "Delete me" });
            expect((await db.comment.findUnique({ where: { id: comment.id }, select: { deletedAt: true } }))?.deletedAt).toBeInstanceOf(Date);
        } finally {
            await cleanupFixture(fixture);
        }
    });
});
