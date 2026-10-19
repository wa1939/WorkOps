import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import type { TaskActor } from "@/lib/tasks/authorization";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };
const customFieldValueSchema = z.object({
    fieldId: z.string().trim().min(1),
    value: z.unknown().nullable(),
}).strict();

function actorFor(session: { user?: { id?: unknown; role?: unknown } } | null): TaskActor | null {
    const user = session?.user;
    if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
    const role = user.role;
    return { id: user.id, role: role === "ADMIN" || role === "LEAD" || role === "MEMBER" || role === "VIEWER" ? role : "MEMBER" };
}

export async function PATCH(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const session = await auth();
        const actor = actorFor(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const taskId = (await params).id;
        if (!await authorize(actor, "task:edit", { kind: "task", id: taskId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const { fieldId, value } = customFieldValueSchema.parse(await request.json());
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } });
        if (!task?.projectId) return NextResponse.json({ error: "Task project not found" }, { status: 400 });
        const field = await prisma.customField.findFirst({ where: { id: fieldId, projectId: task.projectId }, select: { id: true } });
        if (!field) return NextResponse.json({ error: "Custom field not found" }, { status: 404 });
        const saved = await prisma.customFieldValue.upsert({
            where: { fieldId_taskId: { fieldId, taskId } },
            create: { fieldId, taskId, value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue },
            update: { value: value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue },
            include: { field: true },
        });
        return NextResponse.json(saved);
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
        console.error("Failed to update custom field", error);
        return NextResponse.json({ error: "Failed to update custom field" }, { status: 500 });
    }
}
