import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const projectReportInclude = {
    members: {
        include: {
            user: { select: { id: true, name: true, email: true } },
        },
    },
    tasks: {
        where: { archived: false },
        orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        include: {
            assignments: {
                include: {
                    user: { select: { id: true, name: true, email: true } },
                },
            },
            timeLogs: {
                select: {
                    userId: true,
                    minutes: true,
                    startedAt: true,
                    user: { select: { id: true, name: true, email: true } },
                },
            },
        },
    },
} satisfies Prisma.ProjectInclude;

type ProjectRecord = Prisma.ProjectGetPayload<{ include: typeof projectReportInclude }>;
type ProjectDatabase = Pick<PrismaClient, "project">;

export type ProjectReport = ReturnType<typeof buildProjectReport>;

function iso(value: Date | null): string | null {
    return value?.toISOString() ?? null;
}

function round(value: number): number {
    return Math.round(value * 100) / 100;
}

export async function loadProjectReport(
    projectId: string,
    db: ProjectDatabase = prisma,
): Promise<ProjectRecord | null> {
    return db.project.findUnique({ where: { id: projectId }, include: projectReportInclude });
}

export function buildProjectReport(project: ProjectRecord, now = new Date()) {
    const statusCounts = new Map<string, number>();
    const priorityCounts = new Map<string, number>();
    const memberRows = new Map<string, {
        memberId: string;
        memberName: string;
        memberEmail: string;
        role: string | null;
        loggedMinutes: number;
        taskIds: Set<string>;
    }>();
    const ensureMember = (user: { id: string; name: string; email: string }, role: string | null = null) => {
        const existing = memberRows.get(user.id);
        if (existing) {
            if (!existing.role && role) existing.role = role;
            return existing;
        }
        const created = {
            memberId: user.id,
            memberName: user.name || user.email,
            memberEmail: user.email,
            role,
            loggedMinutes: 0,
            taskIds: new Set<string>(),
        };
        memberRows.set(user.id, created);
        return created;
    };

    for (const member of project.members) ensureMember(member.user, member.role);

    let estimatedMinutes = 0;
    let loggedMinutes = 0;
    let completedTaskCount = 0;
    let overdueTaskCount = 0;
    const tasks = project.tasks.map((task) => {
        const taskLoggedMinutes = task.timeLogs.reduce((sum, log) => sum + log.minutes, 0);
        estimatedMinutes += task.estimateMinutes ?? 0;
        loggedMinutes += taskLoggedMinutes;
        statusCounts.set(task.status, (statusCounts.get(task.status) ?? 0) + 1);
        priorityCounts.set(task.priority, (priorityCounts.get(task.priority) ?? 0) + 1);
        if (task.status === "DONE") completedTaskCount += 1;
        if (task.dueAt && task.dueAt.getTime() < now.getTime() && task.status !== "DONE" && task.status !== "CANCELED") {
            overdueTaskCount += 1;
        }

        for (const assignment of task.assignments) {
            ensureMember(assignment.user).taskIds.add(task.id);
        }
        for (const log of task.timeLogs) {
            const member = ensureMember(log.user);
            member.loggedMinutes += log.minutes;
            member.taskIds.add(task.id);
        }

        return {
            id: task.id,
            taskKey: task.taskKey,
            title: task.title,
            status: task.status,
            priority: task.priority,
            estimateMinutes: task.estimateMinutes ?? 0,
            estimatedHours: round((task.estimateMinutes ?? 0) / 60),
            loggedMinutes: taskLoggedMinutes,
            loggedHours: round(taskLoggedMinutes / 60),
            dueAt: iso(task.dueAt),
            plannedStartAt: iso(task.plannedStartAt),
            plannedEndAt: iso(task.plannedEndAt),
            assignments: task.assignments.map((assignment) => ({
                memberId: assignment.user.id,
                memberName: assignment.user.name || assignment.user.email,
                memberEmail: assignment.user.email,
            })),
        };
    });

    const projectMembers = Array.from(memberRows.values())
        .map((member) => ({
            memberId: member.memberId,
            memberName: member.memberName,
            memberEmail: member.memberEmail,
            role: member.role,
            loggedMinutes: member.loggedMinutes,
            loggedHours: round(member.loggedMinutes / 60),
            taskCount: member.taskIds.size,
        }))
        .sort((left, right) => left.memberName.localeCompare(right.memberName));
    const statusMix = Array.from(statusCounts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => ({ status, count }));
    const priorityMix = Array.from(priorityCounts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([priority, count]) => ({ priority, count }));
    const varianceHours = round((loggedMinutes - estimatedMinutes) / 60);

    return {
        project: {
            id: project.id,
            name: project.name,
            status: project.status,
            startAt: iso(project.startAt),
            dueAt: iso(project.dueAt),
            dueAtEnd: iso(project.dueAtEnd),
        },
        summary: {
            taskCount: tasks.length,
            completedTaskCount,
            donePercent: tasks.length === 0 ? 0 : round((completedTaskCount / tasks.length) * 100),
            overdueTaskCount,
            estimatedMinutes,
            estimatedHours: round(estimatedMinutes / 60),
            loggedMinutes,
            loggedHours: round(loggedMinutes / 60),
            varianceHours,
        },
        statusMix,
        priorityMix,
        members: projectMembers,
        tasks,
    };
}
