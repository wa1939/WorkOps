import { randomUUID } from "node:crypto";
import { resolveDispatch, type Category, type Channel, type DispatchPreferences } from "./policy";

export interface EnqueueDeliveryInput {
    channel: Channel;
    destinationKey: string;
}

export interface EnqueueDispatchOverrides {
    quietHoursActive?: boolean;
    memberActive?: boolean;
    pushConsented?: boolean;
    preferences?: Partial<Omit<DispatchPreferences, "now">> & { now?: Date };
}

export interface EnqueueEventInput extends EnqueueDispatchOverrides {
    workspaceId: string;
    sourceType: string;
    sourceId: string;
    sourceVersion: string;
    category: Category;
    recipientUserId: string;
    dedupeKey: string;
    expiresAt?: Date | null;
    deliveries: EnqueueDeliveryInput[];
}

export interface EnqueueResult {
    created: boolean;
}

interface EventCreateData {
    id: string;
    workspaceId: string;
    sourceType: string;
    sourceId: string;
    sourceVersion: string;
    category: string;
    recipientUserId: string;
    dedupeKey: string;
    expiresAt: Date | null;
}

interface DeliveryCreateData {
    eventId: string;
    channel: Channel;
    destinationKey: string;
    state: "PENDING";
    nextAttemptAt: Date | null;
}

interface StoredEvent {
    id: string;
    sourceVersion: string;
}

export interface BellNotificationInput {
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    linkUrl?: string | null;
}

interface BellNotificationTransaction {
    notification: {
        create(args: { data: BellNotificationInput }): Promise<{ id: string }>;
    };
}

export interface NotificationTransactionDb {
    notificationEvent: {
        upsert(args: {
            where: { dedupeKey: string };
            create: EventCreateData;
            update: Record<string, never>;
        }): Promise<StoredEvent>;
    };
    delivery: {
        createMany(args: { data: DeliveryCreateData[]; skipDuplicates: true }): Promise<{ count: number }>;
    };
}

export interface NotificationDb extends NotificationTransactionDb {
    $transaction<T>(fn: (tx: NotificationTransactionDb) => Promise<T>): Promise<T>;
}

/**
 * The legacy notification bell reads Notification rows, so migrated producers
 * keep that row and enqueue the durable event/deliveries in the same transaction.
 * Keeping this write in the enqueue module also gives the parity gate one seam
 * that is explicitly allowed to touch Notification directly.
 */
export function createBellNotification(
    tx: NotificationTransactionDb,
    data: BellNotificationInput,
): Promise<{ id: string }> {
    const transaction = tx as NotificationTransactionDb & BellNotificationTransaction;
    if (!transaction.notification) {
        throw new Error("Notification transaction delegate is unavailable");
    }
    return transaction.notification.create({ data });
}

const defaultPreferences: Omit<DispatchPreferences, "now"> = {
    emailEnabled: true,
    inAppEnabled: true,
    pushEnabled: false,
    snoozedUntil: null,
};

function policyPreferences(input: EnqueueEventInput, now: Date): DispatchPreferences {
    return {
        ...defaultPreferences,
        ...input.preferences,
        now: input.preferences?.now ?? now,
    };
}

async function enqueueInTransaction(
    tx: NotificationTransactionDb,
    input: EnqueueEventInput,
): Promise<EnqueueResult> {
    const eventId = randomUUID();
    const storedEvent = await tx.notificationEvent.upsert({
        where: { dedupeKey: input.dedupeKey },
        create: {
            id: eventId,
            workspaceId: input.workspaceId,
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            sourceVersion: input.sourceVersion,
            category: input.category,
            recipientUserId: input.recipientUserId,
            dedupeKey: input.dedupeKey,
            expiresAt: input.expiresAt ?? null,
        },
        update: {},
    });

    if (storedEvent.sourceVersion !== input.sourceVersion) {
        throw new Error(`Notification dedupe key already exists for source version ${storedEvent.sourceVersion}`);
    }

    if (storedEvent.id !== eventId) {
        return { created: false };
    }

    const now = input.preferences?.now ?? new Date();
    const prefs = policyPreferences(input, now);
    const rows = input.deliveries.flatMap((delivery): DeliveryCreateData[] => {
        const decision = resolveDispatch(
            {
                category: input.category,
                channel: delivery.channel,
                quietHoursActive: input.quietHoursActive ?? false,
                memberActive: input.memberActive ?? true,
                pushConsented: input.pushConsented ?? false,
            },
            prefs,
        );

        if (decision.action === "suppress") return [];

        return [{
            eventId,
            channel: delivery.channel,
            destinationKey: delivery.destinationKey,
            state: "PENDING",
            nextAttemptAt: decision.action === "delay" ? prefs.now : null,
        }];
    });

    if (rows.length > 0) {
        await tx.delivery.createMany({ data: rows, skipDuplicates: true });
    }

    return { created: true };
}

export function enqueueEvent(db: NotificationDb, input: EnqueueEventInput): Promise<EnqueueResult> {
    return db.$transaction((tx) => enqueueInTransaction(tx, input));
}

export function enqueueWithDomainWork(
    db: NotificationDb,
    domainFn: (tx: NotificationTransactionDb) => Promise<unknown> | unknown,
    input: EnqueueEventInput,
): Promise<EnqueueResult> {
    return db.$transaction(async (tx) => {
        await domainFn(tx);
        return enqueueInTransaction(tx, input);
    });
}
