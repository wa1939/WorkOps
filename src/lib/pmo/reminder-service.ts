import { Prisma, type PrismaClient } from "@prisma/client";
import { createBellNotification, enqueueWithDomainWork } from "@/lib/communications/enqueue";
import {
    enqueueOutboxEvent,
    eventWorkspaceId,
    notificationDb,
    userDispatchOverrides,
} from "@/lib/communications/producer-helpers";
import { prisma } from "@/lib/prisma";
import { toDatabaseDate, toRiyadhDate } from "./date";
import { selectReminderOccurrence } from "./reminders";

export type ReminderRunResult = {
    eventsCreated: number;
    notificationsCreated: number;
    emailsQueued: number;
    emailsSent: number;
    emailsFailed: number;
    emailsRetried: number;
};

type WorkspaceScoped = { workspaceId?: string | null };

export async function processPmoReminderRun({
    now,
    db = prisma,
}: {
    now: Date;
    db?: PrismaClient;
    /** @deprecated provider sends now belong to the communications worker. */
    sendOwnerEmail?: unknown;
}): Promise<ReminderRunResult> {
    const result: ReminderRunResult = {
        eventsCreated: 0,
        notificationsCreated: 0,
        emailsQueued: 0,
        // Provider acceptance and delivery are reported by the communications
        // worker; this scheduler only creates durable pending deliveries.
        emailsSent: 0,
        emailsFailed: 0,
        emailsRetried: 0,
    };
    const today = toRiyadhDate(now);
    const actions = await db.externalAction.findMany({
        where: { owner: { isActive: true }, task: { status: { notIn: ["DONE", "CANCELED"] } } },
        include: {
            owner: true,
            task: { include: { project: true, caseStudy: true } },
            reminderRules: true,
            followUpEvents: {
                where: { triggerType: { in: ["PRE_DUE", "DUE", "OVERDUE"] } },
                select: { dedupKey: true },
            },
        },
    });

    for (const action of actions) {
        if (!action.task.dueAt) continue;
        const occurrence = selectReminderOccurrence({
            actionId: action.id,
            dueDate: toRiyadhDate(action.task.dueAt),
            today,
            daysBeforeDue: action.reminderRules.map((rule) => rule.daysBeforeDue),
            overdueIntervalDays: action.overdueIntervalDays,
            processedDedupKeys: new Set(action.followUpEvents.map((event) => event.dedupKey)),
            hasScheduledHistory: action.followUpEvents.length > 0,
        });
        if (!occurrence) continue;

        try {
            const enqueueResult = await enqueueWithDomainWork(
                notificationDb(db),
                async (rawTx) => {
                    const tx = rawTx as unknown as PrismaClient;
                    const event = await tx.followUpEvent.create({
                        data: {
                            externalActionId: action.id,
                            triggerType: occurrence.triggerType,
                            scheduledDate: toDatabaseDate(occurrence.scheduledDate),
                            dedupKey: occurrence.dedupKey,
                            ownerId: action.ownerId,
                        },
                    });
                    const notification = await createBellNotification(rawTx, {
                        userId: action.ownerId,
                        type: "pmo_follow_up_due",
                        title: "PMO follow-up due",
                        body: action.task.title,
                        linkUrl: `/tasks/${action.taskId}#follow-up`,
                    });
                    await tx.followUpEvent.update({
                        where: { id: event.id },
                        data: { notificationId: notification.id, notifiedAt: now },
                    });
                },
                {
                    workspaceId: eventWorkspaceId((action.task as WorkspaceScoped).workspaceId),
                    sourceType: "pmo-reminder",
                    sourceId: action.id,
                    sourceVersion: occurrence.dedupKey,
                    category: "pmo",
                    recipientUserId: action.ownerId,
                    dedupeKey: `pmo-reminder:${occurrence.dedupKey}`,
                    ...userDispatchOverrides(action.owner, now),
                    deliveries: [
                        { channel: "in_app", destinationKey: action.ownerId },
                        { channel: "email", destinationKey: action.owner.email },
                    ],
                },
            );

            if (enqueueResult.created) {
                result.eventsCreated++;
                result.notificationsCreated++;
                result.emailsQueued++;
            }
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
        }
    }

    // Events created before the migration may have a FollowUpEvent but no
    // NotificationEvent. Re-arm only the durable outbox row; provider delivery
    // is deliberately left to the communications worker, not sent from cron.
    const deliverable = await db.followUpEvent.findMany({
        where: {
            sentAt: null,
            owner: { isActive: true },
            OR: [
                { ownerEmailState: "PENDING" },
                { ownerEmailState: "FAILED" },
                { ownerEmailState: "SENDING", ownerEmailLastAttemptAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
            ],
            externalAction: { task: { status: { notIn: ["DONE", "CANCELED"] } } },
        },
        include: {
            owner: true,
            externalAction: { include: { task: { include: { project: true, caseStudy: true } } } },
        },
    });

    for (const event of deliverable) {
        const queued = await enqueueOutboxEvent(db, {
            workspaceId: eventWorkspaceId((event.externalAction.task as WorkspaceScoped).workspaceId),
            sourceType: "pmo-reminder",
            sourceId: event.externalAction.id,
            sourceVersion: event.dedupKey,
            category: "pmo",
            recipientUserId: event.ownerId,
            dedupeKey: `pmo-reminder:${event.dedupKey}`,
            ...userDispatchOverrides(event.owner, now),
            deliveries: [{ channel: "email", destinationKey: event.owner.email }],
        });
        if (queued.created) {
            result.emailsQueued++;
            if (event.ownerEmailAttempts > 0) result.emailsRetried++;
        }
    }

    return result;
}
