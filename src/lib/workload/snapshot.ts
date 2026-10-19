import { PrismaClient } from "@prisma/client";

export interface SnapshotRow {
    userId: string;
    weekStart: Date;
    loadHours: number;
    loadPercent: number;
    driversJson?: string | null;
    unknownTaskCount?: number | null;
    backlogCount?: number | null;
    confidence?: number | null;
}

export interface SnapshotComputation<TResult = unknown> {
    rows: SnapshotRow[];
    result?: TResult;
}

export interface PublishSnapshotOptions {
    inputVersion: string;
    calendarVersion: string;
    leaseMs?: number;
    now?: Date;
    finishedAt?: Date;
}

export type PublishedSnapshot<TResult = unknown> = {
    skipped: false;
    run: "published";
    runId: string;
    inputVersion: string;
    calendarVersion: string;
    result?: TResult;
};

export type SkippedSnapshot = {
    skipped: true;
    run: "skipped";
    reason: "lease-held" | "already-current" | "stale-run";
    runId?: string;
    inputVersion: string;
    calendarVersion: string;
};

export type PublishSnapshotResult<TResult = unknown> = PublishedSnapshot<TResult> | SkippedSnapshot;

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

type AcquireRunResult = { id: string } | { reason: "lease-held" | "already-current" };

function versionKey(inputVersion: string | null | undefined, calendarVersion: string | null | undefined): string | null {
    if (inputVersion == null || calendarVersion == null) return null;
    return `${inputVersion}:${calendarVersion}`;
}

async function lockScope(tx: Pick<PrismaClient, "$executeRaw">, scope: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}))`;
}

async function reapStaleRunsInTransaction(
    tx: Pick<PrismaClient, "teamLoadRun">,
    scope: string,
    now: Date,
): Promise<number> {
    const result = await tx.teamLoadRun.updateMany({
        where: { scope, status: "running", leaseUntil: { lte: now } },
        data: { status: "failed", finishedAt: now },
    });
    return result.count;
}

export async function reapStaleRuns(db: PrismaClient, scope: string, now = new Date()): Promise<number> {
    return db.$transaction(async (tx) => {
        await lockScope(tx, scope);
        return reapStaleRunsInTransaction(tx, scope, now);
    });
}

async function acquireRun(
    db: PrismaClient,
    scope: string,
    inputVersion: string,
    calendarVersion: string,
    now: Date,
    leaseMs: number,
): Promise<AcquireRunResult> {
    return db.$transaction(async (tx) => {
        await lockScope(tx, scope);
        await reapStaleRunsInTransaction(tx, scope, now);

        const live = await tx.teamLoadRun.findFirst({
            where: { scope, status: "running", leaseUntil: { gt: now } },
            orderBy: { startedAt: "desc" },
            select: { id: true },
        });
        if (live) return { reason: "lease-held" };

        const active = await tx.teamLoadSnapshot.findFirst({
            orderBy: { computedAt: "desc" },
            select: { inputVersion: true, calendarVersion: true },
        });
        if (versionKey(active?.inputVersion, active?.calendarVersion) === versionKey(inputVersion, calendarVersion)) {
            return { reason: "already-current" };
        }

        const run = await tx.teamLoadRun.create({
            data: {
                scope,
                inputVersion,
                status: "running",
                leaseUntil: new Date(now.getTime() + leaseMs),
                startedAt: now,
            },
            select: { id: true },
        });
        return run;
    });
}

export async function publishSnapshot<TResult = unknown>(
    db: PrismaClient,
    scope: string,
    computeFn: () => Promise<SnapshotComputation<TResult>>,
    opts: PublishSnapshotOptions,
): Promise<PublishSnapshotResult<TResult>> {
    const acquiredAt = opts.now ?? new Date();
    const run = await acquireRun(
        db,
        scope,
        opts.inputVersion,
        opts.calendarVersion,
        acquiredAt,
        opts.leaseMs ?? DEFAULT_LEASE_MS,
    );

    if ("reason" in run) {
        return {
            skipped: true,
            run: "skipped",
            reason: run.reason,
            inputVersion: opts.inputVersion,
            calendarVersion: opts.calendarVersion,
        };
    }

    try {
        const computation = await computeFn();
        const finishedAt = opts.finishedAt ?? new Date();

        return await db.$transaction(async (tx) => {
            await lockScope(tx, scope);

            const active = await tx.teamLoadSnapshot.findFirst({
                orderBy: { computedAt: "desc" },
                select: { computedAt: true, inputVersion: true, calendarVersion: true },
            });
            const activeVersion = versionKey(active?.inputVersion, active?.calendarVersion);
            const incomingVersion = versionKey(opts.inputVersion, opts.calendarVersion);
            const calendarChanged = active != null
                && activeVersion !== incomingVersion
                && active.calendarVersion !== opts.calendarVersion;
            if (active && active.computedAt > finishedAt && !calendarChanged) {
                await tx.teamLoadRun.update({
                    where: { id: run.id },
                    data: { status: "finished", finishedAt },
                });
                return {
                    skipped: true,
                    run: "skipped",
                    reason: "stale-run",
                    runId: run.id,
                    inputVersion: opts.inputVersion,
                    calendarVersion: opts.calendarVersion,
                } satisfies SkippedSnapshot;
            }

            for (const snapshot of computation.rows) {
                const data = {
                    loadHours: snapshot.loadHours,
                    loadPercent: snapshot.loadPercent,
                    driversJson: snapshot.driversJson ?? null,
                    computedAt: finishedAt,
                    inputVersion: opts.inputVersion,
                    calendarVersion: opts.calendarVersion,
                    unknownTaskCount: snapshot.unknownTaskCount ?? null,
                    backlogCount: snapshot.backlogCount ?? null,
                    confidence: snapshot.confidence ?? null,
                };
                await tx.teamLoadSnapshot.upsert({
                    where: { userId_weekStart: { userId: snapshot.userId, weekStart: snapshot.weekStart } },
                    update: data,
                    create: {
                        userId: snapshot.userId,
                        weekStart: snapshot.weekStart,
                        ...data,
                    },
                });
            }

            await tx.teamLoadRun.update({
                where: { id: run.id },
                data: { status: "finished", finishedAt },
            });
            return {
                skipped: false,
                run: "published",
                runId: run.id,
                inputVersion: opts.inputVersion,
                calendarVersion: opts.calendarVersion,
                result: computation.result,
            } satisfies PublishedSnapshot<TResult>;
        });
    } catch (error) {
        try {
            await db.teamLoadRun.update({
                where: { id: run.id },
                data: { status: "failed", finishedAt: new Date() },
            });
        } catch {
            // Preserve the compute/publish error as the caller-visible failure.
        }
        throw error;
    }
}
