import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getTimeEntries, totalMinutes, weekBuckets, type TimeEntry } from "@/lib/time/aggregation";

const isoDate = z.union([
    z.string().date(),
    z.string().datetime({ offset: true }),
]);

const querySchema = z.object({
    from: isoDate,
    to: isoDate,
    userId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
}).superRefine((value, context) => {
    if (new Date(value.to).getTime() <= new Date(value.from).getTime()) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be after from" });
    }
});

type SessionUser = { id?: unknown; role?: unknown };

function serializeEntry(log: TimeEntry) {
    return {
        id: log.id,
        taskId: log.taskId,
        userId: log.userId,
        startedAt: log.startedAt.toISOString(),
        minutes: log.minutes,
        note: log.note,
        source: log.source,
        createdAt: log.createdAt.toISOString(),
        task: {
            id: log.task.id,
            taskKey: log.task.taskKey,
            title: log.task.title,
            parentTaskId: log.task.parentTaskId,
            estimateMinutes: log.task.estimateMinutes,
            project: log.task.project
                ? { id: log.task.project.id, name: log.task.project.name }
                : null,
        },
        user: {
            id: log.user.id,
            name: log.user.name,
            email: log.user.email,
            image: log.user.image,
        },
    };
}

function canQueryOtherUsers(role: unknown): boolean {
    return role === "ADMIN" || role === "LEAD" || role === "MANAGER";
}

export async function GET(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const sessionUser = (session?.user ?? {}) as SessionUser;
        if (typeof sessionUser.id !== "string" || sessionUser.id.length === 0) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const parsed = querySchema.safeParse({
            from: url.searchParams.get("from") ?? undefined,
            to: url.searchParams.get("to") ?? undefined,
            userId: url.searchParams.get("userId") ?? undefined,
            projectId: url.searchParams.get("projectId") ?? undefined,
            taskId: url.searchParams.get("taskId") ?? undefined,
        });
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
        }

        const targetUserId = parsed.data.userId ?? sessionUser.id;
        if (targetUserId !== sessionUser.id && !canQueryOtherUsers(sessionUser.role)) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const logs = await getTimeEntries({
            from: new Date(parsed.data.from),
            to: new Date(parsed.data.to),
            userId: targetUserId,
            projectId: parsed.data.projectId,
            taskId: parsed.data.taskId,
        });

        return NextResponse.json({
            logs: logs.map(serializeEntry),
            dayTotals: weekBuckets(logs),
            weekTotal: totalMinutes(logs),
        });
    } catch (error) {
        console.error("Failed to fetch time entries", error);
        return NextResponse.json({ error: "Failed to fetch time entries" }, { status: 500 });
    }
}
