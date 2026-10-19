import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { dayCapacity, isWorkingDay } from "@/lib/workload/calendar";

const isoDate = z.union([
    z.string().date(),
    z.string().datetime({ offset: true }),
]);

const querySchema = z.object({ from: isoDate, to: isoDate }).superRefine((value, context) => {
    if (new Date(value.to).getTime() <= new Date(value.from).getTime()) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be after from" });
    }
});

type SessionUser = { id?: unknown; role?: unknown };
type DatePart = string;

type MemberRecord = {
    id: string;
    name: string;
    email: string;
    capacityPerWeekHours: number;
};

type LeaveRecord = { userId: string; startAt: Date; endAt: Date };
type LogRecord = { userId: string; startedAt: Date; minutes: number };

type PlannedTask = {
    estimateMinutes: number | null;
    assignments: Array<{ userId: string }>;
};

type SnapshotRecord = {
    userId: string;
    weekStart: Date;
    loadHours: number;
    loadPercent: number;
};

function canQueryOtherUsers(role: unknown): boolean {
    return role === "ADMIN" || role === "LEAD" || role === "MANAGER";
}

function datePartsBetween(from: Date, to: Date): DatePart[] {
    const parts: DatePart[] = [];
    const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    while (cursor < end) {
        parts.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return parts;
}

function weekStartFor(datePart: DatePart): DatePart {
    const date = new Date(`${datePart}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - date.getUTCDay());
    return date.toISOString().slice(0, 10);
}

function weekStartsFor(dateParts: readonly DatePart[]): DatePart[] {
    return Array.from(new Set(dateParts.map(weekStartFor))).sort();
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function utilizationPercent(capacityHours: number, loggedHours: number): number {
    if (capacityHours <= 0) return loggedHours > 0 ? 100 : 0;
    return round((loggedHours / capacityHours) * 100);
}

function utilizationState(percent: number): "under" | "healthy" | "over" {
    if (percent > 100) return "over";
    if (percent >= 80) return "healthy";
    return "under";
}

function addToNumberMap(map: Map<string, number>, key: string, value: number): void {
    map.set(key, (map.get(key) ?? 0) + value);
}

function snapshotKey(userId: string, weekStart: string): string {
    return `${userId}:${weekStart}`;
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
        });
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
        }

        const from = new Date(parsed.data.from);
        const to = new Date(parsed.data.to);
        const allMembers = canQueryOtherUsers(sessionUser.role);
        const users = await prisma.user.findMany({
            where: allMembers ? { isActive: true } : { id: sessionUser.id },
            select: { id: true, name: true, email: true, capacityPerWeekHours: true },
            orderBy: { name: "asc" },
        });
        const userIds = users.map((user) => user.id);
        if (userIds.length === 0) {
            return NextResponse.json({ from: from.toISOString(), to: to.toISOString(), dataSource: "live", weeks: [], members: [] });
        }

        const [leaves, logs, plannedTasks, snapshots] = await Promise.all([
            prisma.leaveRequest.findMany({
                where: {
                    userId: { in: userIds },
                    status: "Approved",
                    startAt: { lt: to },
                    endAt: { gt: from },
                },
                select: { userId: true, startAt: true, endAt: true },
            }),
            prisma.timeLog.findMany({
                where: { userId: { in: userIds }, startedAt: { gte: from, lt: to } },
                select: { userId: true, startedAt: true, minutes: true },
            }),
            prisma.task.findMany({
                where: {
                    archived: false,
                    plannedStartAt: { not: null, lt: to },
                    plannedEndAt: { not: null, gt: from },
                    assignments: { some: { userId: { in: userIds } } },
                },
                select: {
                    estimateMinutes: true,
                    assignments: { select: { userId: true } },
                },
            }),
            prisma.teamLoadSnapshot.findMany({
                where: {
                    userId: { in: userIds },
                    weekStart: {
                        gte: new Date(from.getTime() - 7 * 24 * 60 * 60 * 1000),
                        lt: to,
                    },
                },
                select: { userId: true, weekStart: true, loadHours: true, loadPercent: true },
            }),
        ] satisfies [
            Promise<LeaveRecord[]>,
            Promise<LogRecord[]>,
            Promise<PlannedTask[]>,
            Promise<SnapshotRecord[]>,
        ]);

        const dateParts = datePartsBetween(from, to);
        const weekStarts = weekStartsFor(dateParts);
        const leavesByUser = new Map<string, LeaveRecord[]>();
        for (const leave of leaves) {
            const userLeaves = leavesByUser.get(leave.userId) ?? [];
            userLeaves.push(leave);
            leavesByUser.set(leave.userId, userLeaves);
        }
        const logsByUser = new Map<string, LogRecord[]>();
        for (const log of logs) {
            const userLogs = logsByUser.get(log.userId) ?? [];
            userLogs.push(log);
            logsByUser.set(log.userId, userLogs);
        }
        const plannedByUser = new Map<string, number>();
        for (const task of plannedTasks) {
            for (const assignment of task.assignments) {
                addToNumberMap(plannedByUser, assignment.userId, (task.estimateMinutes ?? 0) / 60);
            }
        }
        const snapshotByKey = new Map<string, SnapshotRecord>();
        for (const snapshot of snapshots) {
            snapshotByKey.set(snapshotKey(snapshot.userId, snapshot.weekStart.toISOString().slice(0, 10)), snapshot);
        }

        const memberRows = users.map((user: MemberRecord) => {
            const leavesForUser = leavesByUser.get(user.id) ?? [];
            const logsForUser = logsByUser.get(user.id) ?? [];
            const dailyHours = user.capacityPerWeekHours / 5;
            const capacityByWeek = new Map<string, number>();
            for (const datePart of dateParts) {
                const capacity = isWorkingDay(datePart) ? dayCapacity(datePart, { dailyHours, leave: leavesForUser, recurring: [] }) : 0;
                addToNumberMap(capacityByWeek, weekStartFor(datePart), capacity);
            }
            const loggedByWeek = new Map<string, number>();
            for (const log of logsForUser) {
                addToNumberMap(loggedByWeek, weekStartFor(log.startedAt.toISOString().slice(0, 10)), log.minutes / 60);
            }
            const livePlannedHours = plannedByUser.get(user.id) ?? 0;
            const weeks = weekStarts.map((weekStart) => {
                const capacityHours = round(capacityByWeek.get(weekStart) ?? 0);
                const loggedHours = round(loggedByWeek.get(weekStart) ?? 0);
                const snapshot = snapshotByKey.get(snapshotKey(user.id, weekStart));
                const plannedHours = round(snapshot && loggedHours === 0 && livePlannedHours === 0
                    ? snapshot.loadHours
                    : livePlannedHours / Math.max(weekStarts.length, 1));
                const percent = utilizationPercent(capacityHours, loggedHours);
                return {
                    weekStart,
                    capacityHours,
                    loggedHours,
                    plannedHours,
                    utilizationPercent: percent,
                    state: utilizationState(percent),
                    bucket: utilizationState(percent),
                    snapshotLoadPercent: snapshot?.loadPercent ?? null,
                };
            });
            const capacityHours = round(weeks.reduce((sum, week) => sum + week.capacityHours, 0));
            const loggedHours = round(weeks.reduce((sum, week) => sum + week.loggedHours, 0));
            const plannedHours = round(weeks.reduce((sum, week) => sum + week.plannedHours, 0));
            const percent = utilizationPercent(capacityHours, loggedHours);
            return {
                memberId: user.id,
                memberName: user.name || user.email,
                memberEmail: user.email,
                capacityHours,
                loggedHours,
                plannedHours,
                utilizationPercent: percent,
                state: utilizationState(percent),
                bucket: utilizationState(percent),
                weeks,
            };
        });

        const trend = weekStarts.map((weekStart) => {
            const capacityHours = round(memberRows.reduce((sum, member) => sum + (member.weeks.find((week) => week.weekStart === weekStart)?.capacityHours ?? 0), 0));
            const loggedHours = round(memberRows.reduce((sum, member) => sum + (member.weeks.find((week) => week.weekStart === weekStart)?.loggedHours ?? 0), 0));
            const plannedHours = round(memberRows.reduce((sum, member) => sum + (member.weeks.find((week) => week.weekStart === weekStart)?.plannedHours ?? 0), 0));
            const percent = utilizationPercent(capacityHours, loggedHours);
            return { weekStart, capacityHours, loggedHours, plannedHours, utilizationPercent: percent, state: utilizationState(percent), bucket: utilizationState(percent) };
        });

        return NextResponse.json({
            from: from.toISOString(),
            to: to.toISOString(),
            dataSource: snapshots.length > 0 ? "live+snapshot" : "live",
            weeks: trend,
            members: memberRows,
        });
    } catch (error) {
        console.error("Failed to build utilization report", error);
        return NextResponse.json({ error: "Failed to build utilization report" }, { status: 500 });
    }
}
