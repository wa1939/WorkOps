import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveOperationalAiTarget } from "@/lib/ai/provider-resolution";
import { AI_RESPONSE_ERROR } from "@/lib/ai/task-actions";
import { requestPlannerInsight } from "@/lib/ai/planner-insight";
import { buildTaskGridQuery } from "@/lib/tasks/grid-query";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "@/lib/workload/calendar";
import { buildPlannerModel, type PlannerTask, type PlannerUser } from "@/lib/workload/planner-read-model";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const insightRequestSchema = z.object({
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
}).strict();

const PLANNER_ROLES = new Set(["ADMIN", "MANAGER", "MEMBER"]);

type SessionUser = {
    id?: unknown;
    role?: unknown;
    departmentIds?: unknown;
};

type PlannerViewer = {
    id: string;
    role: string;
    departmentIds: string[];
};

class InsightHttpError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "InsightHttpError";
    }
}

function sessionViewer(user: SessionUser): PlannerViewer | null {
    if (typeof user.id !== "string" || user.id.length === 0) return null;
    const role = typeof user.role === "string" && user.role.length > 0 ? user.role : "MEMBER";
    if (!PLANNER_ROLES.has(role)) return null;
    return {
        id: user.id,
        role,
        departmentIds: Array.isArray(user.departmentIds)
            ? user.departmentIds.filter((id): id is string => typeof id === "string")
            : [],
    };
}

function parseBoundary(value: string, endOfDay: boolean): Date {
    const datePartMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const candidate = datePartMatch
        ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+03:00`
        : value;
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) throw new RangeError("Planner range must contain valid dates");
    return date;
}

function taskWhereForPlanner(viewer: PlannerViewer): Prisma.TaskWhereInput {
    const gridQuery = buildTaskGridQuery({
        filters: {
            status: [],
            priority: [],
            assigneeIds: [],
            tagIds: [],
            includeArchived: false,
        },
        groupBy: "none",
        sortBy: "updatedAt",
        dir: "asc",
    }, viewer);
    return {
        AND: [
            gridQuery.where,
            { status: { notIn: ["DONE", "CANCELED"] } },
        ],
    };
}

async function loadPlannerModel(rangeStart: Date, rangeEnd: Date, viewer: PlannerViewer) {
    const [users, tasks, leavePeriods, timeLogs] = await Promise.all([
        prisma.user.findMany({
            where: { isActive: true },
            select: { id: true, name: true, image: true, capacityPerWeekHours: true },
            orderBy: { name: "asc" },
        }),
        prisma.task.findMany({
            where: taskWhereForPlanner(viewer),
            select: {
                id: true,
                taskKey: true,
                title: true,
                status: true,
                priority: true,
                estimateMinutes: true,
                remainingEffortHours: true,
                plannedStartAt: true,
                plannedEndAt: true,
                project: { select: { id: true, name: true } },
                assignments: { select: { userId: true, plannedShare: true } },
            },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        }),
        prisma.leaveRequest.findMany({
            where: { status: "Approved", startAt: { lt: rangeEnd }, endAt: { gte: rangeStart } },
            select: { userId: true, startAt: true, endAt: true },
        }),
        prisma.timeLog.findMany({
            where: { startedAt: { gte: rangeStart, lte: rangeEnd } },
            select: { userId: true, startedAt: true, minutes: true },
        }),
    ]);

    const plannerUsers: PlannerUser[] = users.map((user) => ({
        id: user.id,
        name: user.name,
        image: user.image,
        capacityPerWeekHours: user.capacityPerWeekHours,
    }));
    const plannerTasks: PlannerTask[] = tasks.map((task) => ({
        id: task.id,
        taskKey: task.taskKey,
        title: task.title,
        status: task.status,
        priority: task.priority,
        estimateMinutes: task.estimateMinutes,
        remainingEffortHours: task.remainingEffortHours,
        plannedStartAt: task.plannedStartAt,
        plannedEndAt: task.plannedEndAt,
        projectId: task.project?.id ?? null,
        projectName: task.project?.name ?? null,
        assignments: task.assignments,
    }));
    return buildPlannerModel({
        rangeStart,
        rangeEnd,
        users: plannerUsers,
        tasks: plannerTasks,
        leavePeriods,
        existingTimeLogs: timeLogs.map((log) => ({
            userId: log.userId,
            datePart: dateInTimeZone(log.startedAt, DEFAULT_TIME_ZONE),
            minutes: log.minutes,
        })),
    });
}

async function textOptions() {
    const target = await resolveOperationalAiTarget();
    return {
        provider: target.provider,
        model: target.model,
        fallbacks: target.fallbacks,
        credentials: target.credentials,
        signal: AbortSignal.timeout(30_000),
        temperature: 0.2,
        max_tokens: 900,
        thinking: "disabled" as const,
    };
}

function errorResponse(error: unknown): Response {
    if (error instanceof z.ZodError || error instanceof RangeError) return NextResponse.json({ error: "Invalid planner range" }, { status: 400 });
    if (error instanceof InsightHttpError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to generate planner insight", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate planner insight" }, { status: 500 });
}

export async function POST(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const viewer = sessionViewer((session?.user ?? {}) as SessionUser);
        if (!session?.user || !viewer) {
            return NextResponse.json({ error: session?.user ? "Forbidden" : "Unauthorized" }, { status: session?.user ? 403 : 401 });
        }
        const input = insightRequestSchema.parse(await request.json());
        const rangeStart = parseBoundary(input.from, false);
        const rangeEnd = parseBoundary(input.to, true);
        if (rangeEnd.getTime() < rangeStart.getTime()) throw new RangeError("Planner range end must not precede its start");
        const model = await loadPlannerModel(rangeStart, rangeEnd, viewer);
        const insight = await requestPlannerInsight(model, await textOptions());
        if (!insight) throw new InsightHttpError(AI_RESPONSE_ERROR, 502);
        return NextResponse.json(insight, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return errorResponse(error);
    }
}
