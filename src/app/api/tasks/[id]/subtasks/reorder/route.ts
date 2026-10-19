import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import type { TaskActor } from "@/lib/tasks/authorization";

const reorderSchema = z.object({
    orderedIds: z.array(z.string().trim().min(1)).optional(),
    subtaskIds: z.array(z.string().trim().min(1)).optional(),
    items: z.array(z.object({ id: z.string().trim().min(1) })).optional(),
}).strict().refine(
    (value) => value.orderedIds !== undefined || value.subtaskIds !== undefined || value.items !== undefined,
    { message: "orderedIds is required" },
);

type RouteContext = { params: Promise<{ id: string }> };

function actorFor(session: { user?: { id?: unknown; role?: unknown } } | null): TaskActor | null {
    const user = session?.user;
    if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
    return { id: user.id, role: user.role === "ADMIN" || user.role === "LEAD" || user.role === "MEMBER" || user.role === "VIEWER" ? user.role : "MEMBER" };
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const session = await auth();
        const actor = actorFor(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const parentId = (await params).id;
        if (!await authorize(actor, "task:edit", { kind: "task", id: parentId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const parsed = reorderSchema.parse(await request.json());
        const orderedIds = parsed.orderedIds ?? parsed.subtaskIds ?? parsed.items?.map((item) => item.id) ?? [];
        if (new Set(orderedIds).size !== orderedIds.length) {
            return NextResponse.json({ error: "orderedIds must not contain duplicates" }, { status: 400 });
        }

        const children = await prisma.task.findMany({
            where: { parentTaskId: parentId },
            select: { id: true },
        });
        const childIds = new Set(children.map((child) => child.id));
        if (children.length !== orderedIds.length || orderedIds.some((id) => !childIds.has(id))) {
            return NextResponse.json({ error: "The order must include every direct subtask" }, { status: 400 });
        }

        await prisma.$transaction(async (tx) => {
            await Promise.all(orderedIds.map((childId, siblingOrder) => tx.task.update({ where: { id: childId }, data: { siblingOrder } })));
        });

        const items = await prisma.task.findMany({
            where: { parentTaskId: parentId },
            select: { id: true, siblingOrder: true },
            orderBy: { siblingOrder: "asc" },
        });
        return NextResponse.json({ items });
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
        console.error("Failed to reorder subtasks", error);
        return NextResponse.json({ error: "Failed to reorder subtasks" }, { status: 500 });
    }
}
