import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import type { TaskActor } from "@/lib/tasks/authorization";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };
const subscriberSchema = z.object({ userId: z.string().trim().min(1).optional() }).strict();

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
        const taskId = (await params).id;
        if (!await authorize(actor, "task:view", { kind: "task", id: taskId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const parsed = subscriberSchema.parse(await request.json().catch(() => ({})));
        const userId = parsed.userId ?? actor.id;
        const user = await prisma.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
        if (!user) return NextResponse.json({ error: "Subscriber not found" }, { status: 400 });
        const subscriber = await prisma.taskSubscriber.upsert({
            where: { taskId_userId: { taskId, userId } },
            create: { taskId, userId },
            update: {},
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
        });
        return NextResponse.json(subscriber, { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
        console.error("Failed to add task subscriber", error);
        return NextResponse.json({ error: "Failed to add task subscriber" }, { status: 500 });
    }
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const session = await auth();
        const actor = actorFor(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const taskId = (await params).id;
        if (!await authorize(actor, "task:view", { kind: "task", id: taskId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const userId = new URL(request.url).searchParams.get("userId") ?? actor.id;
        await prisma.taskSubscriber.deleteMany({ where: { taskId, userId } });
        return NextResponse.json({ taskId, userId });
    } catch (error) {
        console.error("Failed to remove task subscriber", error);
        return NextResponse.json({ error: "Failed to remove task subscriber" }, { status: 500 });
    }
}
