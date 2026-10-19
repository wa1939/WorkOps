import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { variance } from "@/lib/time/variance";

const isoDate = z.union([
    z.string().date(),
    z.string().datetime({ offset: true }),
]);

const querySchema = z.object({
    from: isoDate,
    to: isoDate,
    projectId: z.string().min(1).optional(),
    memberId: z.string().min(1).optional(),
}).superRefine((value, context) => {
    if (new Date(value.to).getTime() <= new Date(value.from).getTime()) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be after from" });
    }
});

type SessionUser = { id?: unknown; role?: unknown };

function canQueryOtherUsers(role: unknown): boolean {
    return role === "ADMIN" || role === "LEAD" || role === "MANAGER";
}

const taskSelect = {
    id: true,
    estimateMinutes: true,
    status: true,
    project: { select: { id: true, name: true } },
    assignments: {
        select: {
            userId: true,
            user: { select: { id: true, name: true, email: true } },
        },
    },
    timeLogs: {
        select: {
            userId: true,
            minutes: true,
            user: { select: { id: true, name: true, email: true } },
        },
    },
} satisfies Prisma.TaskSelect;

type ReportTask = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

type ProjectAggregate = {
    projectId: string;
    projectName: string;
    estimatedMinutes: number;
    loggedMinutes: number;
    taskCount: number;
    completedTaskCount: number;
};

type MemberAggregate = {
    memberId: string;
    memberName: string;
    memberEmail: string;
    estimatedMinutes: number;
    loggedMinutes: number;
    taskCount: number;
    completedTaskCount: number;
};

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function serializeProject(row: ProjectAggregate) {
    const result = variance(row.estimatedMinutes, row.loggedMinutes);
    return {
        ...row,
        estimatedHours: round(result.estimateHours),
        loggedHours: round(result.loggedHours),
        variance: {
            ...result,
            loggedHours: round(result.loggedHours),
            estimateHours: round(result.estimateHours),
            deltaHours: round(result.deltaHours),
        },
        varianceState: result.state,
    };
}

function serializeMember(row: MemberAggregate) {
    const result = variance(row.estimatedMinutes, row.loggedMinutes);
    return {
        ...row,
        estimatedHours: round(result.estimateHours),
        loggedHours: round(result.loggedHours),
        variance: {
            ...result,
            loggedHours: round(result.loggedHours),
            estimateHours: round(result.estimateHours),
            deltaHours: round(result.deltaHours),
        },
        varianceState: result.state,
    };
}

function memberIdsForTask(task: ReportTask, selectedMemberId: string | undefined): string[] {
    const ids = new Set<string>();
    for (const assignment of task.assignments) {
        if (!selectedMemberId || assignment.userId === selectedMemberId) ids.add(assignment.userId);
    }
    for (const log of task.timeLogs) {
        if (!selectedMemberId || log.userId === selectedMemberId) ids.add(log.userId);
    }
    return Array.from(ids);
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
            projectId: url.searchParams.get("projectId") ?? undefined,
            memberId: url.searchParams.get("memberId") ?? undefined,
        });
        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
        }

        const canQueryOthers = canQueryOtherUsers(sessionUser.role);
        const selectedMemberId = parsed.data.memberId;
        if (selectedMemberId && selectedMemberId !== sessionUser.id && !canQueryOthers) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        const targetMemberId = selectedMemberId ?? (canQueryOthers ? undefined : sessionUser.id);
        const from = new Date(parsed.data.from);
        const to = new Date(parsed.data.to);
        const logRange = { gte: from, lt: to };

        const where: Prisma.TaskWhereInput = {
            archived: false,
            ...(parsed.data.projectId ? { projectId: parsed.data.projectId } : {}),
            ...(targetMemberId
                ? {
                    OR: [
                        { assignments: { some: { userId: targetMemberId } } },
                        { timeLogs: { some: { userId: targetMemberId, startedAt: logRange } } },
                    ],
                }
                : {}),
        };
        const tasks = await prisma.task.findMany({
            where,
            select: {
                ...taskSelect,
                timeLogs: { where: { startedAt: logRange }, select: taskSelect.timeLogs.select },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });

        const projects = new Map<string, ProjectAggregate>();
        const members = new Map<string, MemberAggregate>();
        for (const task of tasks) {
            if (!task.project) continue;
            const project = projects.get(task.project.id) ?? {
                projectId: task.project.id,
                projectName: task.project.name,
                estimatedMinutes: 0,
                loggedMinutes: 0,
                taskCount: 0,
                completedTaskCount: 0,
            };
            project.estimatedMinutes += task.estimateMinutes ?? 0;
            project.loggedMinutes += task.timeLogs
                .filter((log) => !targetMemberId || log.userId === targetMemberId)
                .reduce((sum, log) => sum + log.minutes, 0);
            project.taskCount += 1;
            if (task.status === "DONE") project.completedTaskCount += 1;
            projects.set(project.projectId, project);

            for (const memberId of memberIdsForTask(task, targetMemberId)) {
                const assignment = task.assignments.find((item) => item.userId === memberId);
                const logRows = task.timeLogs.filter((log) => log.userId === memberId);
                const user = assignment?.user ?? logRows[0]?.user;
                if (!user) continue;
                const member = members.get(memberId) ?? {
                    memberId,
                    memberName: user.name || user.email,
                    memberEmail: user.email,
                    estimatedMinutes: 0,
                    loggedMinutes: 0,
                    taskCount: 0,
                    completedTaskCount: 0,
                };
                if (assignment || logRows.length > 0) {
                    member.estimatedMinutes += task.estimateMinutes ?? 0;
                    member.taskCount += 1;
                    if (task.status === "DONE") member.completedTaskCount += 1;
                }
                member.loggedMinutes += logRows.reduce((sum, log) => sum + log.minutes, 0);
                members.set(memberId, member);
            }
        }

        const projectRows = Array.from(projects.values())
            .sort((left, right) => left.projectName.localeCompare(right.projectName))
            .map(serializeProject);
        const memberRows = Array.from(members.values())
            .sort((left, right) => left.memberName.localeCompare(right.memberName))
            .map(serializeMember);
        const totals = projectRows.reduce(
            (total, row) => ({
                estimatedMinutes: total.estimatedMinutes + row.estimatedMinutes,
                loggedMinutes: total.loggedMinutes + row.loggedMinutes,
                taskCount: total.taskCount + row.taskCount,
                completedTaskCount: total.completedTaskCount + row.completedTaskCount,
            }),
            { estimatedMinutes: 0, loggedMinutes: 0, taskCount: 0, completedTaskCount: 0 },
        );
        return NextResponse.json({
            from: from.toISOString(),
            to: to.toISOString(),
            projectId: parsed.data.projectId ?? null,
            memberId: selectedMemberId ?? (targetMemberId ?? null),
            projects: projectRows,
            members: memberRows,
            totals: { ...totals, variance: variance(totals.estimatedMinutes, totals.loggedMinutes) },
        });
    } catch (error) {
        console.error("Failed to build estimate-vs-actual report", error);
        return NextResponse.json({ error: "Failed to build estimate-vs-actual report" }, { status: 500 });
    }
}
