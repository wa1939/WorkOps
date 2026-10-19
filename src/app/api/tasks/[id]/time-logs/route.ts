import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };
type SessionUser = { id?: unknown; role?: unknown };
type Actor = { id: string; role: string | null };
type AuthorizationResult = { actor: Actor } | { response: Response };

const manualLogSchema = z.object({
    minutes: z.coerce.number().int().min(1).max(24 * 60),
    note: z.string().trim().max(2000).optional(),
}).strict();

function actorFromSession(sessionUser: SessionUser | undefined): { id: string; role: string | null } | null {
    if (!sessionUser || typeof sessionUser.id !== "string" || sessionUser.id.length === 0) return null;
    return { id: sessionUser.id, role: typeof sessionUser.role === "string" ? sessionUser.role : null };
}

function dayBounds(now: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
}

function serializeLog(log: {
    id: string;
    taskId: string;
    userId: string;
    startedAt: Date;
    minutes: number;
    note: string | null;
    source: string;
    createdAt: Date;
    user: { id: string; name: string; email: string; image: string | null };
}) {
    return {
        id: log.id,
        taskId: log.taskId,
        userId: log.userId,
        startedAt: log.startedAt.toISOString(),
        minutes: log.minutes,
        note: log.note,
        source: log.source,
        createdAt: log.createdAt.toISOString(),
        user: log.user,
    };
}

async function authorizedActor(taskId: string): Promise<AuthorizationResult> {
    const session = await auth();
    const actor = actorFromSession((session?.user ?? undefined) as SessionUser | undefined);
    if (!actor) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!(await authorize(actor, "task:view", { kind: "task", id: taskId }))) {
        return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    }
    return { actor };
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const taskId = (await params).id;
        const actorResult = await authorizedActor(taskId);
        if ("response" in actorResult) return actorResult.response;

        const { start, end } = dayBounds(new Date());
        const logs = await prisma.timeLog.findMany({
            where: { taskId, startedAt: { gte: start, lt: end } },
            orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
        });
        return NextResponse.json({
            logs: logs.map(serializeLog),
            totalMinutes: logs.reduce((total, log) => total + log.minutes, 0),
        });
    } catch (error) {
        console.error("Failed to fetch task time logs", error);
        return NextResponse.json({ error: "Failed to fetch task time logs" }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const taskId = (await params).id;
        const actorResult = await authorizedActor(taskId);
        if ("response" in actorResult) return actorResult.response;
        const actor = actorResult.actor;

        const input = manualLogSchema.parse(await request.json());
        const created = await prisma.timeLog.create({
            data: {
                taskId,
                userId: actor.id,
                startedAt: new Date(),
                minutes: input.minutes,
                note: input.note || null,
                source: "manual",
            },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
        });
        return NextResponse.json(serializeLog(created), { status: 201 });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json({ error: "Invalid time log" }, { status: 400 });
        }
        console.error("Failed to create task time log", error);
        return NextResponse.json({ error: "Failed to create task time log" }, { status: 500 });
    }
}
