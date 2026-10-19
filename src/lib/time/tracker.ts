import type { Prisma, PrismaClient, TimeLog } from "@prisma/client";

export type TimeDatabase = Pick<PrismaClient, "activeTimer" | "timeLog">;

export interface StartTimerResult {
    activeTimer: {
        userId: string;
        taskId: string;
        startedAt: Date;
    };
    stoppedLog: TimeLog | null;
}

type TransactionalTimeDatabase = TimeDatabase & {
    $transaction?: unknown;
};

type TransactionCallback = (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) => Promise<unknown>;

/** Return the rounded elapsed minutes, with a one-minute minimum for active timers. */
export function elapsedMinutes(startedAt: Date | string, now: Date | string): number {
    const startedAtMs = new Date(startedAt).getTime();
    const nowMs = new Date(now).getTime();
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 1;
    return Math.max(1, Math.round((nowMs - startedAtMs) / 60_000));
}

async function inTransaction<T>(db: TimeDatabase, operation: (transaction: TimeDatabase) => Promise<T>): Promise<T> {
    const candidate = db as TransactionalTimeDatabase;
    if (typeof candidate.$transaction === "function") {
        const transaction = candidate.$transaction as TransactionCallback;
        return transaction.call(db, (tx) => operation(tx)) as Promise<T>;
    }
    return operation(db);
}

async function stopActiveTimerInTransaction(
    db: TimeDatabase,
    userId: string,
    now: Date,
    note?: string | null,
): Promise<TimeLog | null> {
    const activeTimer = await db.activeTimer.findUnique({ where: { userId } });
    if (!activeTimer) return null;

    // Delete first so concurrent stops cannot create duplicate logs for one timer.
    const deleted = await db.activeTimer.deleteMany({ where: { userId } });
    if (deleted.count === 0) return null;

    return db.timeLog.create({
        data: {
            taskId: activeTimer.taskId,
            userId: activeTimer.userId,
            startedAt: activeTimer.startedAt,
            minutes: elapsedMinutes(activeTimer.startedAt, now),
            note: note ?? null,
            source: "timer",
        },
    });
}

/** Stop the current user's timer and persist its elapsed interval as a timer log. */
export async function stopActiveTimer(
    db: TimeDatabase,
    userId: string,
    now: Date = new Date(),
    note?: string | null,
): Promise<TimeLog | null> {
    return inTransaction(db, (transaction) => stopActiveTimerInTransaction(transaction, userId, now, note));
}

/** Start one timer per user, automatically logging any timer that was already active. */
export async function startTimer(
    db: TimeDatabase,
    userId: string,
    taskId: string,
    now: Date = new Date(),
): Promise<StartTimerResult> {
    return inTransaction(db, async (transaction) => {
        const stoppedLog = await stopActiveTimerInTransaction(transaction, userId, now);
        const activeTimer = await transaction.activeTimer.upsert({
            where: { userId },
            create: { userId, taskId, startedAt: now },
            update: { taskId, startedAt: now },
        });
        return { activeTimer, stoppedLog };
    });
}
