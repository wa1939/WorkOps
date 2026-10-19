import {
    createBellNotification,
    enqueueEvent,
    enqueueWithDomainWork,
    type BellNotificationInput,
    type EnqueueEventInput,
    type NotificationDb,
    type NotificationTransactionDb,
} from "./enqueue";

/**
 * Legacy rows may still be unscoped while the workspace backfill is in flight.
 * The workspace migration owns replacing this fallback with an actual workspace
 * id; event producers must still provide a stable non-empty key today.
 */
export const LEGACY_WORKSPACE_ID = "legacy";

export function notificationDb(db: unknown): NotificationDb {
    return db as NotificationDb;
}

export function eventWorkspaceId(workspaceId: string | null | undefined): string {
    return workspaceId ?? process.env.NOTIFICATION_WORKSPACE_ID ?? LEGACY_WORKSPACE_ID;
}

export function userDispatchOverrides(
    user: { isActive?: boolean; quietUntil?: Date | null } | null | undefined,
    now: Date,
): Pick<EnqueueEventInput, "memberActive" | "quietHoursActive" | "preferences"> {
    return {
        memberActive: user?.isActive ?? true,
        quietHoursActive: false,
        preferences: {
            now,
            snoozedUntil: user?.quietUntil ?? null,
        },
    };
}

export type BellEventInput = Omit<EnqueueEventInput, "deliveries"> & {
    notification: BellNotificationInput;
    deliveries: EnqueueEventInput["deliveries"];
};

/**
 * Preserve the Notification row consumed by the bell while making the event and
 * its channel deliveries part of the same transaction.
 */
export function enqueueBellEvent(db: unknown, input: BellEventInput) {
    const { notification, ...event } = input;
    return enqueueWithDomainWork(
        notificationDb(db),
        (tx: NotificationTransactionDb) => createBellNotification(tx, notification),
        event,
    );
}

export function enqueueOutboxEvent(db: unknown, input: EnqueueEventInput) {
    return enqueueEvent(notificationDb(db), input);
}
