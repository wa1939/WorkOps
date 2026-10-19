import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import type { TaskActor } from "@/lib/tasks/authorization";

type RouteContext = { params: Promise<{ id: string }> };
const createSubtaskSchema = z.object({ title: z.string().trim().min(1).max(500) }).strict();

function actorFor(session: { user?: { id?: unknown; role?: unknown } } | null): TaskActor | null {
    const user = session?.user;
    if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
    return { id: user.id, role: user.role === "ADMIN" || user.role === "LEAD" || user.role === "MEMBER" || user.role === "VIEWER" ? user.role : "MEMBER" };
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const session = await auth();
        const actor = actorFor(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const parentId = (await params).id;
        if (!await authorize(actor, "task:edit", { kind: "task", id: parentId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const { title } = createSubtaskSchema.parse(await request.json());
        const parent = await prisma.task.findUnique({
            where: { id: parentId },
            select: { projectId: true, workspaceId: true },
        });
        if (!parent) return NextResponse.json({ error: "Task not found" }, { status: 404 });
        const last = await prisma.task.findFirst({
            where: { parentTaskId: parentId },
            orderBy: { siblingOrder: "desc" },
            select: { siblingOrder: true },
        });
        const task = await prisma.task.create({
            data: {
                title,
                parentTaskId: parentId,
                projectId: parent.projectId,
                workspaceId: parent.workspaceId,
                siblingOrder: (last?.siblingOrder ?? -1) + 1,
                createdById: actor.id,
            },
            select: { id: true, taskKey: true, title: true, status: true, priority: true, siblingOrder: true },
        });
        return NextResponse.json(task, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
        console.error("Failed to create subtask", error);
        return NextResponse.json({ error: "Failed to create subtask" }, { status: 500 });
    }
}
