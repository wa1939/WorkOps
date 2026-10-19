import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTaskGridQuery } from "@/lib/tasks/grid-query";
import { dateInTimeZone, DEFAULT_TIME_ZONE } from "@/lib/workload/calendar";
import { buildPlannerModel, type PlannerTask, type PlannerUser } from "@/lib/workload/planner-read-model";

export const dynamic = "force-dynamic";

const plannerQuerySchema = z.object({
    from: z.string().trim().min(1),
    to: z.string().trim().min(1),
    projectIds: z.array(z.string().trim().min(1)).default([]),
    memberIds: z.array(z.string().trim().min(1)).default([]),
    weekDays: z.array(z.number().int().min(0).max(6)).optional(),
    dailyHours: z.coerce.number().finite().min(1).max(24).optional(),
}).strict();

const PLANNER_ROLES = new Set(["ADMIN", "MANAGER", "MEMBER"]);

type PlannerQuery = z.infer<typeof plannerQuerySchema> & {
    rangeStart: Date;
    rangeEnd: Date;
};

type SessionUser = {
    id?: unknown;
    role?: unknown;
    departmentIds?: unknown;
};

function sessionViewer(user: SessionUser): { id: string; role: string; departmentIds: string[] } | null {
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

function splitQueryList(values: string[]): string[] {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
        for (const item of value.split(",")) {
            const trimmed = item.trim();
            if (trimmed && !seen.has(trimmed)) {
                seen.add(trimmed);
                result.push(trimmed);
            }
        }
    }
    return result;
}

function parseBoundary(value: string, endOfDay: boolean): Date {
    const datePartMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const candidate = datePartMatch
        ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+03:00`
        : value;
    const date = new Date(candidate);
    if (Number.isNaN(date.getTime())) {
        throw new RangeError("Planner range must contain valid dates");
    }
    return date;
}

function parsePlannerQuery(searchParams: URLSearchParams): PlannerQuery {
    const raw = plannerQuerySchema.parse({
        from: searchParams.get("from") ?? undefined,
        to: searchParams.get("to") ?? undefined,
        projectIds: splitQueryList(searchParams.getAll("projectIds")),
        memberIds: splitQueryList(searchParams.getAll("memberIds")),
        weekDays: searchParams.has("weekDays")
            ? splitQueryList(searchParams.getAll("weekDays")).map((value) => Number(value))
            : undefined,
        dailyHours: searchParams.get("dailyHours") ?? undefined,
    });
    const rangeStart = parseBoundary(raw.from, false);
    const rangeEnd = parseBoundary(raw.to, true);
    if (rangeEnd.getTime() < rangeStart.getTime()) {
        throw new RangeError("Planner range end must not precede its start");
    }
    return { ...raw, rangeStart, rangeEnd };
}

function taskWhereForPlanner(
    projectIds: readonly string[],
    memberIds: readonly string[],
    viewer: { id: string; role: string; departmentIds: readonly string[] },
): Prisma.TaskWhereInput {
    const gridQuery = buildTaskGridQuery({
        filters: {
            status: [],
            priority: [],
            assigneeIds: [...memberIds],
            tagIds: [],
            ...(projectIds.length === 1 ? { projectId: projectIds[0] } : {}),
            includeArchived: false,
        },
        groupBy: "none",
        sortBy: "updatedAt",
        dir: "asc",
    }, viewer);

    const extraScopes: Prisma.TaskWhereInput[] = [
        { status: { notIn: ["DONE", "CANCELED"] } },
    ];
    if (projectIds.length > 1) {
        extraScopes.push({ projectId: { in: [...projectIds] } });
    }
    return { AND: [gridQuery.where, ...extraScopes] };
}

export async function GET(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const viewer = sessionViewer((session?.user ?? {}) as SessionUser);
        if (!session?.user || !viewer) {
            return NextResponse.json(
                { error: session?.user ? "Forbidden" : "Unauthorized" },
                { status: session?.user ? 403 : 401 },
            );
        }

        const query = parsePlannerQuery(new URL(request.url).searchParams);
        const userWhere = query.memberIds.length > 0
            ? { isActive: true, id: { in: query.memberIds } }
            : { isActive: true };
        const taskWhere = taskWhereForPlanner(query.projectIds, query.memberIds, viewer);

        const [users, tasks, leavePeriods, timeLogs] = await Promise.all([
            prisma.user.findMany({
                where: userWhere,
                select: {
                    id: true,
                    name: true,
                    image: true,
                    capacityPerWeekHours: true,
                },
                orderBy: { name: "asc" },
            }),
            prisma.task.findMany({
                where: taskWhere,
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
                where: {
                    status: "Approved",
                    startAt: { lt: query.rangeEnd },
                    endAt: { gte: query.rangeStart },
                    ...(query.memberIds.length > 0 ? { userId: { in: query.memberIds } } : {}),
                },
                select: { userId: true, startAt: true, endAt: true },
            }),
            prisma.timeLog.findMany({
                where: {
                    startedAt: { gte: query.rangeStart, lte: query.rangeEnd },
                    ...(query.memberIds.length > 0 ? { userId: { in: query.memberIds } } : {}),
                },
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
        const model = buildPlannerModel({
            rangeStart: query.rangeStart,
            rangeEnd: query.rangeEnd,
            users: plannerUsers,
            tasks: plannerTasks,
            leavePeriods,
            existingTimeLogs: timeLogs.map((log) => ({
                userId: log.userId,
                datePart: dateInTimeZone(log.startedAt, DEFAULT_TIME_ZONE),
                minutes: log.minutes,
            })),
            weekDays: query.weekDays,
            dailyHours: query.dailyHours,
        });

        return NextResponse.json(model, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error) {
        if (error instanceof z.ZodError || error instanceof RangeError) {
            return NextResponse.json({ error: "Invalid planner range or filters" }, { status: 400 });
        }
        console.error("Failed to fetch planner", error);
        return NextResponse.json({ error: "Failed to fetch planner" }, { status: 500 });
    }
}
