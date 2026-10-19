import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { projectVisibilityWhere } from "@/lib/executive-summary";
import { noteVisibility } from "@/lib/notes/authorization";
import { taskScopeForActor } from "@/lib/tasks/authorization";
import { composeScopes } from "@/lib/workspaces/scope";
import { SabahForbiddenError, toSabahActor } from "@/lib/sabah/auth/actor";

export type SearchEntityType = "task" | "project" | "member" | "note";

export interface SearchHit {
    type: SearchEntityType;
    id: string;
    title: string;
    subtitle?: string | null;
    href: string;
}

export interface SearchGroup {
    type: SearchEntityType;
    label: string;
    results: SearchHit[];
}

const searchQuerySchema = z.object({
    q: z.string().trim().min(2).max(200),
    workspaceId: z.string().trim().min(1).max(100).optional(),
}).strict();

function emptyGroups(): SearchGroup[] {
    return [
        { type: "task", label: "Tasks", results: [] },
        { type: "project", label: "Projects", results: [] },
        { type: "member", label: "People", results: [] },
        { type: "note", label: "Notes", results: [] },
    ];
}

/** Keep legacy workspace rows visible while restricting owned rows to memberships. */
function workspaceScopeForIds(workspaceIds: readonly string[] | undefined): Record<string, unknown> | undefined {
    if (!workspaceIds || workspaceIds.length === 0) return undefined;
    return {
        OR: [...Array.from(workspaceIds, (workspaceId) => ({ workspaceId })), { workspaceId: null }],
    };
}

/**
 * Search uses the selected workspace when supplied, otherwise all active
 * workspaces of the actor. A requested workspace is never allowed to bypass
 * membership checks for non-admin users.
 */
async function resolveSearchWorkspaces(
    actor: Awaited<ReturnType<typeof toSabahActor>>,
    requestedWorkspaceId: string | undefined,
): Promise<string[] | undefined> {
    const memberships = await prisma.workspaceMember.findMany({
        where: { userId: actor.id, active: true },
        select: { workspaceId: true },
    });
    const workspaceIds = Array.from(new Set(memberships.map(({ workspaceId }) => workspaceId)));

    if (requestedWorkspaceId) {
        if (actor.role !== "ADMIN" && !workspaceIds.includes(requestedWorkspaceId)) {
            throw new SabahForbiddenError();
        }
        return [requestedWorkspaceId];
    }

    return workspaceIds.length > 0 ? workspaceIds : undefined;
}

function taskSearchWhere(
    actor: Awaited<ReturnType<typeof toSabahActor>>,
    workspaceIds: readonly string[] | undefined,
    q: string,
): Prisma.TaskWhereInput {
    const scope = workspaceIds?.length === 1
        ? taskScopeForActor(actor, workspaceIds[0])
        : composeScopes(taskScopeForActor(actor), workspaceScopeForIds(workspaceIds));
    const projectScope = actor.role === "ADMIN"
        ? undefined
        : {
            OR: [
                { projectId: null },
                { project: projectVisibilityWhere(actor) },
            ],
        };

    return composeScopes(
        scope,
        projectScope,
        {
            OR: [
                { taskKey: { contains: q, mode: "insensitive" } },
                { title: { contains: q, mode: "insensitive" } },
            ],
        },
    ) as Prisma.TaskWhereInput;
}

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let actor;
    try {
        actor = await toSabahActor(session.user);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        throw error;
    }

    const url = new URL(request.url);
    const parsedQuery = searchQuerySchema.safeParse({
        q: url.searchParams.get("q") ?? "",
        workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    });
    if (!parsedQuery.success) {
        return NextResponse.json(
            { error: "Search query must contain at least 2 characters" },
            { status: 400 },
        );
    }

    let workspaceIds: string[] | undefined;
    try {
        workspaceIds = await resolveSearchWorkspaces(actor, parsedQuery.data.workspaceId);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
        }
        throw error;
    }

    const { q } = parsedQuery.data;
    const workspaceScope = workspaceScopeForIds(workspaceIds);
    const projectScope = projectVisibilityWhere(actor) as Prisma.ProjectWhereInput;
    const privateNoteScope = actor.role === "ADMIN" ? {} : noteVisibility(actor);
    const canSearchMemberEmail = actor.role === "ADMIN" || actor.role === "LEAD";
    const memberMatch: Prisma.UserWhereInput = {
        OR: canSearchMemberEmail
            ? [
                { name: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
            ]
            : [{ name: { contains: q, mode: "insensitive" } }],
    };
    const memberWorkspaceScope: Prisma.UserWhereInput | undefined = workspaceIds
        ? { workspaceMemberships: { some: { active: true, workspaceId: { in: workspaceIds } } } }
        : undefined;

    const [tasks, projects, members, notes] = await Promise.all([
        prisma.task.findMany({
            where: taskSearchWhere(actor, workspaceIds, q),
            select: { id: true, taskKey: true, title: true, status: true, project: { select: { name: true } } },
            take: 5,
            orderBy: { updatedAt: "desc" },
        }),
        prisma.project.findMany({
            where: composeScopes(
                { name: { contains: q, mode: "insensitive" } },
                projectScope,
                workspaceScope,
            ) as Prisma.ProjectWhereInput,
            select: { id: true, name: true, status: true },
            take: 5,
            orderBy: { updatedAt: "desc" },
        }),
        prisma.user.findMany({
            where: composeScopes(
                { isActive: true },
                memberMatch,
                memberWorkspaceScope,
            ) as Prisma.UserWhereInput,
            select: { id: true, name: true, email: true, title: true, role: true },
            take: 5,
            orderBy: { name: "asc" },
        }),
        prisma.notePage.findMany({
            where: composeScopes(
                { title: { contains: q, mode: "insensitive" } },
                privateNoteScope,
                workspaceScope,
            ) as Prisma.NotePageWhereInput,
            select: { id: true, title: true },
            take: 5,
            orderBy: { updatedAt: "desc" },
        }),
    ]);

    const taskResults: SearchHit[] = tasks.map((task) => ({
        type: "task",
        id: task.id,
        title: task.title,
        subtitle: task.project?.name ?? task.status,
        href: `/tasks?task=${task.id}`,
    }));
    const projectResults: SearchHit[] = projects.map((project) => ({
        type: "project",
        id: project.id,
        title: project.name,
        subtitle: project.status,
        href: `/projects/${project.id}`,
    }));
    const memberResults: SearchHit[] = members.map((member) => ({
        type: "member",
        id: member.id,
        title: member.name || "Unnamed member",
        subtitle: canSearchMemberEmail ? member.email : member.title ?? member.role,
        href: "/team",
    }));
    const noteResults: SearchHit[] = notes.map((note) => ({
        type: "note",
        id: note.id,
        title: note.title,
        href: `/notes/${note.id}`,
    }));

    const groups: SearchGroup[] = [
        { type: "task", label: "Tasks", results: taskResults },
        { type: "project", label: "Projects", results: projectResults },
        { type: "member", label: "People", results: memberResults },
        { type: "note", label: "Notes", results: noteResults },
    ];
    const hits = groups.reduce<SearchHit[]>((all, group) => all.concat(group.results), []);

    return NextResponse.json({ groups, hits });
}
