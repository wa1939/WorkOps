import { randomUUID } from "node:crypto";
import { type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCanManageExternalAction, type PmoActor } from "./authorization";
import { writePmoAudit } from "./audit";
import { toDatabaseDate, toRiyadhDate } from "./date";

export type MarkFollowUpSentInput = {
    eventId?: string;
    confirmedSent: true;
    recipient: string;
    subject: string;
    body: string;
};

export async function markFollowUpSent(
    taskId: string,
    payload: MarkFollowUpSentInput,
    actor: PmoActor,
    db: PrismaClient = prisma,
) {
    const task = await db.task.findFirst({
        where: { id: taskId, type: "EXTERNAL_ACTION" },
        include: {
            externalAction: { include: { owner: { select: { managerId: true } } } },
            project: { select: { ownerId: true } },
            caseStudy: { select: { ownerId: true } },
        },
    });
    if (!task?.externalAction) throw new Error("External action not found");
    const action = task.externalAction;
    assertCanManageExternalAction(actor, {
        ownerId: action.ownerId,
        parentOwnerId: task.project?.ownerId ?? task.caseStudy?.ownerId ?? null,
        ownerManagerId: action.owner.managerId,
    });

    return db.$transaction(async (tx) => {
        if (!payload.eventId) {
            const scheduled = await tx.followUpEvent.findFirst({
                where: {
                    externalActionId: action.id,
                    triggerType: { not: "MANUAL" },
                    sentAt: null,
                },
            });
            if (scheduled) throw new Error("Scheduled follow-up event must be used");

            const now = new Date();
            const event = await tx.followUpEvent.create({
                data: {
                    externalActionId: action.id,
                    triggerType: "MANUAL",
                    scheduledDate: toDatabaseDate(toRiyadhDate(now)),
                    dedupKey: `manual:${action.id}:${randomUUID()}`,
                    ownerId: action.ownerId,
                    finalRecipient: payload.recipient,
                    finalSubject: payload.subject,
                    finalBody: payload.body,
                    sentAt: now,
                    sentById: actor.id,
                },
            });
            await writePmoAudit(tx, {
                entityType: "follow_up_event",
                entityId: event.id,
                action: "marked_sent",
                actorId: actor.id,
                taskId,
                changes: { fields: ["finalRecipient", "finalSubject", "finalBody", "sentAt", "sentById"] },
            });
            return event;
        }

        const existing = await tx.followUpEvent.findFirst({
            where: {
                id: payload.eventId,
                externalActionId: action.id,
                triggerType: { not: "MANUAL" },
                sentAt: null,
            },
        });
        if (!existing) throw new Error("Scheduled follow-up event not found");

        const claimed = await tx.followUpEvent.updateMany({
            where: { id: payload.eventId, externalActionId: action.id, sentAt: null },
            data: {
                finalRecipient: payload.recipient,
                finalSubject: payload.subject,
                finalBody: payload.body,
                sentAt: new Date(),
                sentById: actor.id,
            },
        });
        if (claimed.count !== 1) throw new Error("Scheduled follow-up was already marked sent");
        const event = await tx.followUpEvent.findUnique({ where: { id: payload.eventId } });
        if (!event) throw new Error("Scheduled follow-up event not found");
        await writePmoAudit(tx, {
            entityType: "follow_up_event",
            entityId: event.id,
            action: "marked_sent",
            actorId: actor.id,
            taskId,
            changes: { fields: ["finalRecipient", "finalSubject", "finalBody", "sentAt", "sentById"] },
        });
        return event;
    });
}
