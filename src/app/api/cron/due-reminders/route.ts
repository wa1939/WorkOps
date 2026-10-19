import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createBellNotification, enqueueWithDomainWork } from "@/lib/communications/enqueue";
import {
    eventWorkspaceId,
    notificationDb,
    userDispatchOverrides,
} from "@/lib/communications/producer-helpers";

function formatTimeUntilDue(offsetMinutes: number): string {
    if (offsetMinutes >= 1440) {
        const days = Math.round(offsetMinutes / 1440);
        return `in ${days} day${days > 1 ? "s" : ""}`;
    }
    if (offsetMinutes >= 60) {
        const hours = Math.round(offsetMinutes / 60);
        return `in ${hours} hour${hours > 1 ? "s" : ""}`;
    }
    return `in ${offsetMinutes} minute${offsetMinutes > 1 ? "s" : ""}`;
}

type WorkspaceScoped = { workspaceId?: string | null };

function workspaceOf(value: unknown): string {
    return eventWorkspaceId((value as WorkspaceScoped | null | undefined)?.workspaceId);
}

async function enqueueDueReminder(input: {
    task: WorkspaceScoped & { id: string; title: string; dueAt: Date | null };
    user: { id: string; email: string; isActive?: boolean; quietUntil?: Date | null };
    type: "task_due_soon" | "task_overdue" | "task_reminder";
    title: string;
    body: string;
    linkUrl: string;
    dedupeKey: string;
    sourceVersion: string;
    now: Date;
    email: boolean;
}) {
    const { notification, ...event } = {
        workspaceId: workspaceOf(input.task),
        sourceType: "due-reminder",
        sourceId: input.task.id,
        sourceVersion: input.sourceVersion,
        category: "task" as const,
        recipientUserId: input.user.id,
        dedupeKey: input.dedupeKey,
        ...userDispatchOverrides(input.user, input.now),
        deliveries: [
            { channel: "in_app" as const, destinationKey: input.user.id },
            ...(input.email ? [{ channel: "email" as const, destinationKey: input.user.email }] : []),
            { channel: "push" as const, destinationKey: `user:${input.user.id}` },
        ],
        notification: {
            userId: input.user.id,
            type: input.type,
            title: input.title,
            body: input.body,
            linkUrl: input.linkUrl,
        },
    };
    return enqueueWithDomainWork(
        notificationDb(prisma),
        (tx) => createBellNotification(tx, notification),
        event,
    );
}

async function handleCron(request: Request) {
    try {
        const authHeader = request.headers.get("authorization");
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const now = new Date();
        const dueSoonWindow = 48; // hours
        const dueThreshold = new Date(now.getTime() + dueSoonWindow * 60 * 60 * 1000);

        // Find tasks due soon that haven't had recent reminders
        const tasksDueSoon = await prisma.task.findMany({
            where: {
                type: { not: "EXTERNAL_ACTION" },
                status: { notIn: ["DONE", "CANCELED"] },
                dueAt: {
                    gte: now,
                    lte: dueThreshold,
                },
            },
            include: {
                assignments: { include: { user: true } },
            },
        });

        // Find overdue tasks
        const tasksOverdue = await prisma.task.findMany({
            where: {
                type: { not: "EXTERNAL_ACTION" },
                status: { notIn: ["DONE", "CANCELED"] },
                dueAt: { lt: now },
            },
            include: {
                assignments: { include: { user: true } },
            },
        });

        let notificationsSent = 0;

        // Due soon notifications
        for (const task of tasksDueSoon) {
            for (const assignment of task.assignments) {
                const dueAt = task.dueAt?.toISOString() ?? "undated";
                const result = await enqueueDueReminder({
                    task: task as typeof task & WorkspaceScoped,
                    user: assignment.user,
                    type: "task_due_soon",
                    title: "Task Due Soon",
                    body: `"${task.title}" is due within ${dueSoonWindow} hours`,
                    linkUrl: `/tasks/${task.id}`,
                    dedupeKey: `due-reminder:${task.id}:${dueAt}:${assignment.userId}:due-soon`,
                    sourceVersion: `${dueAt}:due-soon`,
                    now,
                    email: false,
                });
                if (result.created) notificationsSent++;
            }
        }

        // Overdue notifications
        for (const task of tasksOverdue) {
            for (const assignment of task.assignments) {
                const dueAt = task.dueAt?.toISOString() ?? "undated";
                const result = await enqueueDueReminder({
                    task: task as typeof task & WorkspaceScoped,
                    user: assignment.user,
                    type: "task_overdue",
                    title: "Task Overdue",
                    body: `"${task.title}" is overdue`,
                    linkUrl: `/tasks/${task.id}`,
                    dedupeKey: `due-reminder:${task.id}:${dueAt}:${assignment.userId}:overdue`,
                    sourceVersion: `${dueAt}:overdue`,
                    now,
                    email: false,
                });
                if (result.created) notificationsSent++;
            }
        }

        // Process user-configured TaskReminder records. The Notification row is
        // retained for the bell; the email is now a pending outbox Delivery so
        // provider failures cannot be mistaken for a DELIVERED result.
        const pendingReminders = await prisma.taskReminder.findMany({
            where: {
                sentAt: null,
                task: {
                    type: { not: "EXTERNAL_ACTION" },
                    status: { notIn: ["DONE", "CANCELED"] },
                    dueAt: { not: null },
                },
            },
            include: {
                task: true,
                user: true,
            },
        });

        let remindersSent = 0;

        for (const reminder of pendingReminders) {
            const dueAt = reminder.task.dueAt;
            if (!dueAt) continue;

            const triggerTime = new Date(dueAt.getTime() - reminder.offsetMinutes * 60 * 1000);

            if (now >= triggerTime) {
                const timeUntilDue = formatTimeUntilDue(reminder.offsetMinutes);
                const result = await enqueueDueReminder({
                    task: reminder.task as typeof reminder.task & WorkspaceScoped,
                    user: reminder.user,
                    type: "task_reminder",
                    title: "Task Reminder",
                    body: `"${reminder.task.title}" is due ${timeUntilDue}`,
                    linkUrl: `/tasks/${reminder.taskId}`,
                    dedupeKey: `due-reminder:${reminder.id}:${dueAt.toISOString()}`,
                    sourceVersion: `${dueAt.toISOString()}:${reminder.offsetMinutes}`,
                    now,
                    email: true,
                });

                // sentAt records that the reminder was durably queued, not that
                // an email provider accepted or delivered it.
                if (result.created) {
                    await prisma.taskReminder.update({
                        where: { id: reminder.id },
                        data: { sentAt: now },
                    });
                    remindersSent++;
                }
            }
        }

        return NextResponse.json({
            success: true,
            dueSoon: tasksDueSoon.length,
            overdue: tasksOverdue.length,
            notificationsSent,
            remindersSent,
        });
    } catch (error) {
        console.error("cron/due-reminders error:", error);
        return NextResponse.json({ error: "Failed to process reminders" }, { status: 500 });
    }
}

// Vercel cron sends GET requests
export const GET = handleCron;
// Keep POST for manual triggers
export const POST = handleCron;
