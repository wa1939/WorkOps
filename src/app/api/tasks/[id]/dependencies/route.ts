import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import type { TaskActor } from "@/lib/tasks/authorization";
import { addTaskDependencies, removeTaskDependency } from "@/lib/tasks/commands";

const dependencySchema = z.object({ dependsOnId: z.string().trim().min(1) }).strict();
type RouteContext = { params: Promise<{ id: string }> };

function actorFor(session: { user?: { id?: unknown; role?: unknown } } | null): TaskActor | null {
    const user = session?.user;
    if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
    return { id: user.id, role: user.role === "ADMIN" || user.role === "LEAD" || user.role === "MEMBER" || user.role === "VIEWER" ? user.role : "MEMBER" };
}

async function getActor(): Promise<TaskActor | null> {
    return actorFor(await auth());
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const actor = await getActor();
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const taskId = (await params).id;
        if (!await authorize(actor, "task:edit", { kind: "task", id: taskId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const { dependsOnId } = dependencySchema.parse(await request.json());
        const result = await addTaskDependencies(taskId, [dependsOnId], actor, prisma);
        return NextResponse.json(result, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
        if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
            return NextResponse.json({ error: error instanceof Error ? error.message : "Dependency update failed" }, { status: error.status });
        }
        console.error("Failed to add task dependency", error);
        return NextResponse.json({ error: "Failed to add task dependency" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const actor = await getActor();
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const taskId = (await params).id;
        const dependencyId = new URL(request.url).searchParams.get("dependencyId")?.trim();
        if (!dependencyId) return NextResponse.json({ error: "dependencyId is required" }, { status: 400 });
        const relation = await prisma.taskDependency.findUnique({
            where: { id: dependencyId },
            select: { id: true, taskId: true, dependsOnId: true },
        });
        if (!relation || (relation.taskId !== taskId && relation.dependsOnId !== taskId)) {
            return NextResponse.json({ error: "Dependency not found" }, { status: 404 });
        }
        const editableTaskId = relation.taskId;
        if (!await authorize(actor, "task:edit", { kind: "task", id: editableTaskId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (relation.taskId === taskId) {
            return NextResponse.json(await removeTaskDependency(taskId, dependencyId, actor, prisma));
        }
        await prisma.taskDependency.delete({ where: { id: dependencyId } });
        return NextResponse.json({ id: dependencyId, taskId: relation.taskId, dependsOnId: relation.dependsOnId });
    } catch (error) {
        if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
            return NextResponse.json({ error: error instanceof Error ? error.message : "Dependency update failed" }, { status: error.status });
        }
        console.error("Failed to remove task dependency", error);
        return NextResponse.json({ error: "Failed to remove task dependency" }, { status: 500 });
    }
}
