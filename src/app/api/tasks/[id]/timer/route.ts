import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { elapsedMinutes, startTimer, stopActiveTimer } from "@/lib/time/tracker";

type RouteContext = { params: Promise<{ id: string }> };
type SessionUser = { id?: unknown; role?: unknown };
type Actor = { id: string; role: string | null };
type AuthorizationResult = { actor: Actor } | { response: Response };

const timerInputSchema = z.object({
    action: z.enum(["start", "stop"]),
    note: z.string().trim().max(2000).optional(),
}).strict();

function sessionActor(sessionUser: SessionUser | undefined): { id: string; role: string | null } | null {
    if (!sessionUser || typeof sessionUser.id !== "string" || sessionUser.id.length === 0) return null;
    return {
        id: sessionUser.id,
        role: typeof sessionUser.role === "string" ? sessionUser.role : null,
    };
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
} | null) {
    if (!log) return null;
    return {
        id: log.id,
        taskId: log.taskId,
        userId: log.userId,
        startedAt: log.startedAt.toISOString(),
        minutes: log.minutes,
        note: log.note,
        source: log.source,
        createdAt: log.createdAt.toISOString(),
    };
}

function serializeActiveTimer(timer: { userId: string; taskId: string; startedAt: Date }, now: Date) {
    return {
        userId: timer.userId,
        taskId: timer.taskId,
        startedAt: timer.startedAt.toISOString(),
        elapsedMinutes: elapsedMinutes(timer.startedAt, now),
    };
}

async function authorizedActor(taskId: string): Promise<AuthorizationResult> {
    const session = await auth();
    const actor = sessionActor((session?.user ?? undefined) as SessionUser | undefined);
    if (!actor) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!(await authorize(actor, "task:view", { kind: "task", id: taskId }))) {
        return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
    }
    return { actor };
}

export async function GET(_request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const taskId = (await params).id;
        const authorization = await authorizedActor(taskId);
        if ("response" in authorization) return authorization.response;
        const actor = authorization.actor;

        const activeTimer = await prisma.activeTimer.findUnique({ where: { userId: actor.id } });
        if (!activeTimer || activeTimer.taskId !== taskId) return NextResponse.json(null);
        return NextResponse.json(serializeActiveTimer(activeTimer, new Date()));
    } catch (error) {
        console.error("Failed to fetch task timer", error);
        return NextResponse.json({ error: "Failed to fetch task timer" }, { status: 500 });
    }
}

export async function POST(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const taskId = (await params).id;
        const authorization = await authorizedActor(taskId);
        if ("response" in authorization) return authorization.response;
        const actor = authorization.actor;

        const input = timerInputSchema.parse(await request.json());
        const now = new Date();
        if (input.action === "start") {
            const result = await startTimer(prisma, actor.id, taskId, now);
            return NextResponse.json({
                activeTimer: serializeActiveTimer(result.activeTimer, now),
                stoppedLog: serializeLog(result.stoppedLog),
            });
        }

        const log = await stopActiveTimer(prisma, actor.id, now, input.note ?? null);
        return NextResponse.json({ activeTimer: null, log: serializeLog(log) });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof SyntaxError) {
            return NextResponse.json({ error: "Invalid timer request" }, { status: 400 });
        }
        console.error("Failed to update task timer", error);
        return NextResponse.json({ error: "Failed to update task timer" }, { status: 500 });
    }
}
