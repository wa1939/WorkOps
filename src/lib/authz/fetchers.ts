import { prisma } from "@/lib/prisma";
import type {
    CommentMembership,
    ProjectMembership,
    TaskMembership,
    TimeLogMembership,
} from "./types";

export async function loadTaskContext(
    taskId: string,
    userId: string,
): Promise<TaskMembership | null> {
    const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: {
            id: true,
            projectId: true,
            createdById: true,
            assignments: { select: { userId: true } },
            project: {
                select: {
                    members: {
                        where: { userId },
                        select: { projectId: true, userId: true, accessLevel: true },
                    },
                },
            },
        },
    });

    if (!task) {
        return null;
    }

    const membership = task.project?.members[0];
    return {
        taskId: task.id,
        projectId: task.projectId,
        userId,
        accessLevel: membership?.accessLevel ?? null,
        taskOwnerId: task.createdById,
        taskAssigneeIds: task.assignments.map((assignment) => assignment.userId),
    };
}

export async function loadProjectContext(
    projectId: string,
    userId: string,
): Promise<ProjectMembership | null> {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
            id: true,
            members: {
                where: { userId },
                select: { projectId: true, userId: true, accessLevel: true },
            },
        },
    });

    if (!project) {
        return null;
    }

    const membership = project.members[0];
    return {
        projectId: project.id,
        userId,
        accessLevel: membership?.accessLevel ?? null,
    };
}

export async function loadCommentContext(
    commentId: string,
    userId: string,
): Promise<CommentMembership | null> {
    const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: {
            id: true,
            authorId: true,
            task: {
                select: {
                    projectId: true,
                    project: {
                        select: {
                            members: {
                                where: { userId },
                                select: { projectId: true, userId: true, accessLevel: true },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!comment) {
        return null;
    }

    const membership = comment.task.project?.members[0];
    return {
        commentId: comment.id,
        projectId: comment.task.projectId,
        userId,
        accessLevel: membership?.accessLevel ?? null,
        authorId: comment.authorId,
    };
}

type TimeLogRecord = {
    id: string;
    userId: string | null;
    task: {
        projectId: string | null;
        project: {
            members: Array<{
                projectId: string;
                userId: string;
                accessLevel: string;
            }>;
        } | null;
    } | null;
};

type TimeLogDelegate = {
    findUnique(args: {
        where: { id: string };
        select: {
            id: true;
            userId: true;
            task: {
                select: {
                    projectId: true;
                    project: {
                        select: {
                            members: {
                                where: { userId: string };
                                select: { projectId: true; userId: true; accessLevel: true };
                            };
                        };
                    };
                };
            };
        };
    }): Promise<TimeLogRecord | null>;
};

/**
 * TimeLog is introduced by the time-tracking phase. The delegate is looked up
 * dynamically because the model may not exist yet in the generated client.
 * When the delegate is absent the lookup FAILS CLOSED (throws) rather than
 * reporting not-found: callers see an authorization failure, not a silent 404,
 * and no timelog context is ever authorized without a real query.
 */
export async function loadTimeLogContext(
    timeLogId: string,
    userId: string,
): Promise<TimeLogMembership | null> {
    const timeLogDelegate = (prisma as unknown as { timeLog?: TimeLogDelegate }).timeLog;
    if (!timeLogDelegate) {
        throw new Error("TimeLog model is not available in the Prisma client");
    }

    const timeLog = await timeLogDelegate.findUnique({
        where: { id: timeLogId },
        select: {
            id: true,
            userId: true,
            task: {
                select: {
                    projectId: true,
                    project: {
                        select: {
                            members: {
                                where: { userId },
                                select: { projectId: true, userId: true, accessLevel: true },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!timeLog) {
        return null;
    }

    const membership = timeLog.task?.project?.members[0];
    return {
        timeLogId: timeLog.id,
        projectId: timeLog.task?.projectId ?? null,
        userId,
        accessLevel: membership?.accessLevel ?? null,
        authorId: timeLog.userId,
    };
}
