import { prisma } from "@/lib/prisma";
import { enqueueEvent } from "@/lib/communications/enqueue";
import {
    eventWorkspaceId,
    notificationDb,
    userDispatchOverrides,
} from "@/lib/communications/producer-helpers";

export type AssignmentEmailWork = {
    userId: string;
    email: string;
    name: string | null;
    title: string;
    taskId: string;
    workspaceId?: string | null;
    isActive?: boolean;
    quietUntil?: Date | null;
};

export function uniqueRecipientIds(ids: string[], actorId?: string) {
    return Array.from(new Set(ids)).filter((id) => id !== actorId);
}

export async function dispatchAssignmentEmails(
    work: AssignmentEmailWork[],
    db: unknown = prisma,
) {
    await Promise.allSettled(
        work.map((item) => enqueueEvent(notificationDb(db), {
            workspaceId: eventWorkspaceId(item.workspaceId),
            sourceType: "task-assignment",
            sourceId: item.taskId,
            sourceVersion: "v1",
            category: "task",
            recipientUserId: item.userId,
            dedupeKey: `task-assignment:${item.taskId}:${item.userId}`,
            ...userDispatchOverrides(item, new Date()),
            deliveries: [{ channel: "email", destinationKey: item.email }],
        })),
    );
}
