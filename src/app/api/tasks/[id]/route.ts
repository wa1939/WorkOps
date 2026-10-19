import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { taskScopeForActor, type TaskActor } from "@/lib/tasks/authorization";
import { getTaskForActor, updateTask, TaskCommandError } from "@/lib/tasks/commands";
import { taskIdListSchema, updateTaskSchema } from "@/lib/tasks/schemas";
import { z } from "zod";

const taskDrawerPatchSchema = updateTaskSchema.pick({
    title: true,
    description: true,
    status: true,
    priority: true,
    startAt: true,
    dueAt: true,
    dueAtEnd: true,
    progressMode: true,
    estimateMinutes: true,
    manualProgress: true,
    plannedStartAt: true,
    plannedEndAt: true,
    assigneeIds: true,
}).extend({ assignees: taskIdListSchema.optional() }).strict();

type RouteContext = { params: Promise<{ id: string }> };
type SessionUser = { id?: unknown; role?: unknown };

function errorResponse(error: unknown, fallback: string): Response {
    if (error instanceof TaskCommandError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
        return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    console.error(fallback, error);
    return NextResponse.json({ error: fallback }, { status: 500 });
}

function actorFor(user: SessionUser): TaskActor | null {
    if (typeof user.id !== "string" || user.id.length === 0) return null;
    return {
        id: user.id,
        role: typeof user.role === "string" && ["ADMIN", "LEAD", "MEMBER", "VIEWER"].includes(user.role) ? user.role as TaskActor["role"] : "MEMBER",
    };
}

async function sessionActor(): Promise<TaskActor | null> {
    const session = await auth();
    return actorFor((session?.user ?? {}) as SessionUser);
}

async function authorizeTask(actor: TaskActor, id: string, action: "task:view" | "task:edit"): Promise<Response | null> {
    if (await authorize(actor, action, { kind: "task", id })) return null;
    return NextResponse.json(
        { error: action === "task:view" ? "Not found" : "Forbidden" },
        { status: action === "task:view" ? 404 : 403 },
    );
}

async function parentChain(task: { parentTaskId?: string | null }, actor: TaskActor) {
    const parents: Array<{ id: string; taskKey: string | null; title: string }> = [];
    let parentId = task.parentTaskId ?? null;
    for (let depth = 0; depth < 3 && parentId; depth += 1) {
        const parent = await prisma.task.findFirst({
            where: {
                id: parentId,
                ...(taskScopeForActor(actor) as Record<string, unknown>),
            },
            select: { id: true, taskKey: true, title: true, parentTaskId: true },
        });
        if (!parent) break;
        parents.unshift({ id: parent.id, taskKey: parent.taskKey, title: parent.title });
        parentId = parent.parentTaskId;
    }
    return parents;
}

async function drawerPayload(id: string, actor: TaskActor) {
    const task = await getTaskForActor(id, actor, prisma) as { parentTaskId?: string | null } & Record<string, unknown>;
    return { ...task, parents: await parentChain(task, actor) };
}

async function handleUpdate(
    request: Request,
    { params }: RouteContext,
    drawerPatch: boolean,
): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const id = (await params).id;
        const denied = await authorizeTask(actor, id, "task:edit");
        if (denied) return denied;

        const parsed = (drawerPatch ? taskDrawerPatchSchema : updateTaskSchema).parse(await request.json());
        const input = { ...parsed } as Record<string, unknown>;
        const assignees = "assignees" in input ? input.assignees : undefined;
        delete input.assignees;
        if (input.assigneeIds === undefined && assignees !== undefined) input.assigneeIds = assignees;
        await updateTask(id, input as never, actor, prisma);
        return NextResponse.json(await drawerPayload(id, actor));
    } catch (error) {
        return errorResponse(error, "Failed to update task");
    }
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const id = (await params).id;
        const denied = await authorizeTask(actor, id, "task:view");
        if (denied) return denied;
        return NextResponse.json(await drawerPayload(id, actor));
    } catch (error) {
        return errorResponse(error, "Failed to fetch task");
    }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
    return handleUpdate(request, context, false);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
    return handleUpdate(request, context, true);
}

/** Permanent deletion remains a legacy creator-only UI operation. */
export async function DELETE(_request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const actor = await sessionActor();
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const id = (await params).id;
        const task = await prisma.task.findFirst({
            where: {
                id,
                OR: [{ isPrivate: false }, { createdById: actor.id }, { assignments: { some: { userId: actor.id } } }],
            },
            select: { createdById: true, type: true },
        });
        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        if (task.type === "EXTERNAL_ACTION") return NextResponse.json({ error: "External actions must be canceled, not deleted" }, { status: 409 });
        if (task.createdById !== actor.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        await prisma.task.delete({ where: { id } });
        return NextResponse.json({ success: true });
    } catch (error) {
        return errorResponse(error, "Failed to delete task");
    }
}
