import { Prisma, type PrismaClient } from "@prisma/client";
import { canTransition } from "./contracts";

export type DeliverySender = (
    delivery: { id: string; channel: string; destinationKey: string },
    event: { id: string; category: string; sourceType: string; sourceId: string },
) => Promise<
    | { outcome: "accepted"; providerId: string }
    | { outcome: "failed"; message: string; retryable: boolean }
    | { outcome: "unknown"; message?: string }
>;

export type RunReport = {
    claimed: number;
    suppressed: number;
    accepted: number;
    failed: number;
    requeued: number;
    unknown: number;
};

type WorkerOptions = {
    now?: Date;
    batchSize?: number;
    maxAttempts?: number;
};

type ClaimedDelivery = {
    id: string;
    attempts: number;
    channel: string;
    destinationKey: string;
    event: {
        id: string;
        category: string;
        sourceType: string;
        sourceId: string;
        recipientUserId: string;
    };
};

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 5;
const LEASE_DURATION_MS = 60_000;
const UNKNOWN_RECONCILIATION_DELAY_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 15 * 60_000;

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.floor(value));
}

function deterministicJitterMs(deliveryId: string, attempts: number): number {
    let hash = attempts * 17;
    for (const character of deliveryId) hash = (hash * 31 + character.charCodeAt(0)) % 997;
    return hash;
}

function retryDelayMs(deliveryId: string, attempts: number): number {
    const exponential = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, attempts - 1));
    return Math.min(MAX_BACKOFF_MS, exponential + deterministicJitterMs(deliveryId, attempts));
}

async function recoverStaleLeases(db: PrismaClient, now: Date, maxAttempts: number): Promise<number> {
    const result = await db.delivery.updateMany({
        where: {
            state: "SENDING",
            leaseUntil: { lt: now },
            attempts: { lt: maxAttempts },
        },
        data: {
            state: "PENDING",
            nextAttemptAt: now,
            leaseUntil: null,
        },
    });
    return result.count;
}

async function claimDeliveries(db: PrismaClient, now: Date, batchSize: number): Promise<string[]> {
    return db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT d."id"
            FROM "Delivery" AS d
            WHERE d."state" = CAST('PENDING' AS "DeliveryState")
              AND (d."nextAttemptAt" IS NULL OR d."nextAttemptAt" <= ${now})
              AND (d."leaseUntil" IS NULL OR d."leaseUntil" < ${now})
            ORDER BY d."createdAt" ASC, d."id" ASC
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
        `);
        if (rows.length === 0) return [];

        await tx.delivery.updateMany({
            where: {
                id: { in: rows.map((row) => row.id) },
                state: "PENDING",
            },
            data: {
                state: "SENDING",
                attempts: { increment: 1 },
                leaseUntil: new Date(now.getTime() + LEASE_DURATION_MS),
            },
        });
        return rows.map((row) => row.id);
    });
}

async function loadClaimedDeliveries(db: PrismaClient, ids: string[]): Promise<ClaimedDelivery[]> {
    if (ids.length === 0) return [];
    return db.delivery.findMany({
        where: { id: { in: ids } },
        include: {
            event: {
                select: {
                    id: true,
                    category: true,
                    sourceType: true,
                    sourceId: true,
                    recipientUserId: true,
                },
            },
        },
    });
}

export async function processCommunicationsRun(
    db: PrismaClient,
    sender: DeliverySender,
    opts: WorkerOptions = {},
): Promise<RunReport> {
    const now = opts.now ?? new Date();
    const batchSize = normalizePositiveInteger(opts.batchSize, DEFAULT_BATCH_SIZE);
    const maxAttempts = normalizePositiveInteger(opts.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    const report: RunReport = {
        claimed: 0,
        suppressed: 0,
        accepted: 0,
        failed: 0,
        requeued: await recoverStaleLeases(db, now, maxAttempts),
        unknown: 0,
    };

    const claimedIds = await claimDeliveries(db, now, batchSize);
    report.claimed = claimedIds.length;
    const deliveries = await loadClaimedDeliveries(db, claimedIds);
    const deliveriesById = new Map(deliveries.map((delivery) => [delivery.id, delivery]));

    for (const deliveryId of claimedIds) {
        const delivery = deliveriesById.get(deliveryId);
        if (!delivery) continue;

        const member = await db.user.findUnique({
            where: { id: delivery.event.recipientUserId },
            select: { isActive: true },
        });
        if (!member?.isActive) {
            if (!canTransition("SENDING", "SUPPRESSED")) throw new Error("Invalid delivery transition");
            await db.delivery.update({
                where: { id: delivery.id },
                data: {
                    state: "SUPPRESSED",
                    lastError: "membership_inactive",
                    leaseUntil: null,
                    nextAttemptAt: null,
                },
            });
            report.suppressed++;
            continue;
        }

        let outcome: Awaited<ReturnType<DeliverySender>>;
        try {
            outcome = await sender(
                {
                    id: delivery.id,
                    channel: delivery.channel,
                    destinationKey: delivery.destinationKey,
                },
                {
                    id: delivery.event.id,
                    category: delivery.event.category,
                    sourceType: delivery.event.sourceType,
                    sourceId: delivery.event.sourceId,
                },
            );
        } catch {
            outcome = { outcome: "unknown" };
        }

        if (outcome.outcome === "accepted") {
            if (!canTransition("SENDING", "ACCEPTED")) throw new Error("Invalid delivery transition");
            await db.delivery.update({
                where: { id: delivery.id },
                data: {
                    state: "ACCEPTED",
                    providerId: outcome.providerId,
                    acceptedAt: now,
                    leaseUntil: null,
                    nextAttemptAt: null,
                    lastError: null,
                },
            });
            report.accepted++;
            continue;
        }

        if (outcome.outcome === "failed") {
            const lastError = outcome.message;
            if (outcome.retryable && delivery.attempts < maxAttempts) {
                if (!canTransition("SENDING", "PENDING")) throw new Error("Invalid delivery transition");
                await db.delivery.update({
                    where: { id: delivery.id },
                    data: {
                        state: "PENDING",
                        lastError,
                        nextAttemptAt: new Date(now.getTime() + retryDelayMs(delivery.id, delivery.attempts)),
                        leaseUntil: null,
                    },
                });
            } else {
                if (!canTransition("SENDING", "FAILED")) throw new Error("Invalid delivery transition");
                await db.delivery.update({
                    where: { id: delivery.id },
                    data: {
                        state: "FAILED",
                        lastError,
                        nextAttemptAt: null,
                        leaseUntil: null,
                    },
                });
                report.failed++;
            }
            continue;
        }

        await db.delivery.update({
            where: { id: delivery.id },
            data: {
                state: "SENDING",
                lastError: "provider outcome unknown",
                leaseUntil: null,
                nextAttemptAt: new Date(now.getTime() + UNKNOWN_RECONCILIATION_DELAY_MS),
            },
        });
        report.unknown++;
    }

    return report;
}
