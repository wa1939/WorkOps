import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toRiyadhDate } from "./date";
import { buildFollowUpDraft, selectScheduledDraftEvent } from "./follow-up-draft";

/**
 * Load an external action and assemble its follow-up draft. Shared by the
 * /pmo draft route and Sabah's draftPmoFollowUp tool so there is one
 * implementation. Returns null when the task isn't an eligible external action.
 * `ownerId` is returned so callers can apply their own visibility scoping.
 */
export async function assembleFollowUpDraft(taskId: string, db: PrismaClient = prisma) {
    const task = await db.task.findFirst({
        where: { id: taskId, type: "EXTERNAL_ACTION" },
        include: {
            externalAction: {
                include: {
                    externalContact: true,
                    followUpEvents: {
                        where: { triggerType: { not: "MANUAL" }, sentAt: null },
                        orderBy: { scheduledDate: "asc" },
                    },
                },
            },
            project: true,
            caseStudy: true,
        },
    });
    if (!task?.externalAction || !task.dueAt) return null;

    const action = task.externalAction;
    const scheduledEvent = selectScheduledDraftEvent(action.followUpEvents);
    const draft = buildFollowUpDraft({
        contactName: action.externalContact.name,
        contactEmail: action.externalContact.email,
        actionTitle: task.title,
        actionDescription: task.description ?? task.title,
        parentType: task.project ? "Project" : "Case Study",
        parentName: task.project?.name ?? task.caseStudy?.name ?? "",
        dueDate: new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Riyadh",
        }).format(new Date(`${toRiyadhDate(task.dueAt)}T12:00:00Z`)),
    });

    return { ...draft, scheduledEventId: scheduledEvent?.id ?? null, ownerId: action.ownerId };
}
