import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import type { TaskActor } from "@/lib/tasks/authorization";
import {
    isValidRecurrenceRule,
    nextOccurrence,
    type RecurrenceRule,
} from "@/lib/tasks/recurrence";

const TASK_STATUSES = ["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"] as const;
const recurrenceInputSchema = z.object({
    freq: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
    interval: z.coerce.number().int().min(1).max(1_000_000).optional(),
    byDay: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
    byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
    nthWeek: z.number().int().min(1).max(5).nullable().optional(),
    weekday: z.number().int().min(0).max(6).nullable().optional(),
    mode: z.enum(["create", "status"]).optional(),
    targetStatus: z.enum(TASK_STATUSES).nullable().optional(),
    active: z.boolean().optional(),
    nextRunAt: z.coerce.date().nullable().optional(),
}).strict();

type RouteContext = { params: Promise<{ id: string }> };
type SessionLike = { user?: { id?: unknown; role?: unknown } } | null;

function actorFor(session: SessionLike): TaskActor | null {
    const user = session?.user;
    if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
    return {
        id: user.id,
        role: user.role === "ADMIN" || user.role === "LEAD" || user.role === "MEMBER" || user.role === "VIEWER"
            ? user.role
            : "MEMBER",
    };
}

function ownProperty(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function badRequest(message: string): Response {
    return NextResponse.json({ error: message }, { status: 400 });
}

function errorResponse(error: unknown): Response {
    if (error instanceof z.ZodError) {
        return badRequest(error.issues[0]?.message ?? "Invalid recurrence rule");
    }
    return NextResponse.json({ error: "Failed to save recurrence rule" }, { status: 500 });
}

export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const session = await auth();
        const actor = actorFor(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const taskId = (await params).id;
        if (!await authorize(actor, "task:edit", { kind: "task", id: taskId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const body = await request.json() as Record<string, unknown>;
        const input = recurrenceInputSchema.parse(body);
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true, startAt: true, dueAt: true, recurringRule: true },
        });
        if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

        const existing = task.recurringRule;
        const scheduleChanged = ["freq", "interval", "byDay", "byMonthDay", "nthWeek", "weekday"]
            .some((key) => ownProperty(body, key));
        const active = input.active ?? existing?.active ?? true;
        const mode = input.mode ?? existing?.mode ?? "create";
        const targetStatus = mode === "status"
            ? (input.targetStatus !== undefined ? input.targetStatus : existing?.targetStatus ?? null)
            : null;
        const byDay = input.byDay !== undefined ? input.byDay : existing?.byDay ?? undefined;
        const byMonthDay = input.byMonthDay !== undefined ? input.byMonthDay : existing?.byMonthDay ?? null;
        const nthWeek = input.nthWeek !== undefined ? input.nthWeek : existing?.nthWeek ?? null;
        const weekday = input.weekday !== undefined ? input.weekday : existing?.weekday ?? null;
        const candidate: RecurrenceRule = {
            freq: input.freq ?? existing?.freq ?? "daily",
            interval: input.interval ?? existing?.interval ?? 1,
            byDay,
            byMonthDay,
            nthWeek,
            weekday,
            mode,
            targetStatus,
            active,
        };

        if (mode !== "create" && mode !== "status") return badRequest("mode must be create or status");
        if (mode === "status" && (!targetStatus || !TASK_STATUSES.includes(targetStatus as typeof TASK_STATUSES[number]))) {
            return badRequest("targetStatus is required for status recurrences");
        }
        if (!isValidRecurrenceRule(candidate)) return badRequest("Invalid recurrence schedule");

        let nextRunAt: Date | null = null;
        if (active) {
            const explicitNextRunAt = input.nextRunAt instanceof Date ? input.nextRunAt : null;
            const preservedNextRunAt = !scheduleChanged && !ownProperty(body, "nextRunAt")
                ? existing?.nextRunAt ?? null
                : null;
            nextRunAt = explicitNextRunAt ?? preservedNextRunAt;
            if (!nextRunAt) {
                const anchor = task.dueAt ?? task.startAt ?? new Date();
                nextRunAt = nextOccurrence(candidate, anchor);
            }
            if (!nextRunAt) return badRequest("Unable to calculate the next recurrence");
        }

        const rule = await prisma.recurringRule.upsert({
            where: { taskId },
            create: {
                taskId,
                freq: candidate.freq,
                interval: candidate.interval ?? 1,
                byDay: Array.isArray(candidate.byDay) ? candidate.byDay : Prisma.JsonNull,
                byMonthDay: candidate.freq === "monthly" && candidate.byMonthDay !== null ? candidate.byMonthDay : null,
                nthWeek: candidate.freq === "monthly" && candidate.nthWeek !== null ? candidate.nthWeek : null,
                weekday: candidate.freq === "monthly" && candidate.weekday !== null ? candidate.weekday : null,
                mode,
                targetStatus,
                active,
                nextRunAt,
            },
            update: {
                freq: candidate.freq,
                interval: candidate.interval ?? 1,
                byDay: Array.isArray(candidate.byDay) ? candidate.byDay : Prisma.JsonNull,
                byMonthDay: candidate.freq === "monthly" && candidate.byMonthDay !== null ? candidate.byMonthDay : null,
                nthWeek: candidate.freq === "monthly" && candidate.nthWeek !== null ? candidate.nthWeek : null,
                weekday: candidate.freq === "monthly" && candidate.weekday !== null ? candidate.weekday : null,
                mode,
                targetStatus,
                active,
                nextRunAt,
            },
        });

        return NextResponse.json({ rule });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function DELETE(_request: Request, { params }: RouteContext): Promise<Response> {
    try {
        const session = await auth();
        const actor = actorFor(session);
        if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const taskId = (await params).id;
        if (!await authorize(actor, "task:edit", { kind: "task", id: taskId })) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const existing = await prisma.recurringRule.findUnique({ where: { taskId } });
        if (!existing) return NextResponse.json({ error: "Recurrence rule not found" }, { status: 404 });
        const rule = await prisma.recurringRule.update({
            where: { taskId },
            data: { active: false, nextRunAt: null },
        });
        return NextResponse.json({ rule });
    } catch (error) {
        return errorResponse(error);
    }
}
