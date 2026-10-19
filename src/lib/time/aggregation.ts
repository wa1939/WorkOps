import { Prisma, type PrismaClient, type TimeLog } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const timeEntryInclude = {
    task: { include: { project: true } },
    user: true,
} satisfies Prisma.TimeLogInclude;

export type TimeEntry = Prisma.TimeLogGetPayload<{ include: typeof timeEntryInclude }>;

export type TimeEntryFilters = {
    from: Date | string;
    to: Date | string;
    userId?: string;
    projectId?: string;
    taskId?: string;
};

type TimeLogReader = Pick<PrismaClient, "timeLog">;
type RawRollupRow = { total_minutes: bigint | number | null };

/** Fetch time logs in [from, to), with the task, project, and user needed by the entries view. */
export async function getTimeEntries(
    filters: TimeEntryFilters,
    db: TimeLogReader = prisma,
): Promise<TimeEntry[]> {
    const { from, to, userId, projectId, taskId } = filters;
    return db.timeLog.findMany({
        where: {
            startedAt: { gte: new Date(from), lt: new Date(to) },
            ...(userId ? { userId } : {}),
            ...(taskId ? { taskId } : {}),
            ...(projectId ? { task: { projectId } } : {}),
        },
        include: timeEntryInclude,
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    });
}

export type TimeBucketLog = { startedAt: Date | string; minutes: number };

/** Group time logs by UTC calendar date without mutating the input. */
export function weekBuckets<T extends TimeBucketLog>(logs: readonly T[]): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const log of logs) {
        const startedAt = log.startedAt instanceof Date ? log.startedAt : new Date(log.startedAt);
        if (Number.isNaN(startedAt.getTime())) continue;
        const day = startedAt.toISOString().slice(0, 10);
        totals[day] = (totals[day] ?? 0) + log.minutes;
    }
    return totals;
}

/** Return the total logged minutes without changing the input array. */
export function totalMinutes<T extends Pick<TimeLog, "minutes">>(logs: readonly T[]): number {
    return logs.reduce((total, log) => total + log.minutes, 0);
}

/** Sum a task's own time and every non-archived descendant's time. */
export async function parentTaskTimeRollup(
    parentId: string,
    db: Pick<PrismaClient, "$queryRaw"> = prisma,
): Promise<number> {
    const rows = await db.$queryRaw<RawRollupRow[]>(Prisma.sql`
        WITH RECURSIVE descendants AS (
            SELECT "Task"."id"
            FROM "Task"
            WHERE "Task"."id" = ${parentId}
              AND "Task"."archived" = false

            UNION ALL

            SELECT child."id"
            FROM "Task" AS child
            INNER JOIN descendants AS parent ON child."parentTaskId" = parent."id"
            WHERE child."archived" = false
        )
        SELECT COALESCE(SUM("TimeLog"."minutes"), 0)::bigint AS "total_minutes"
        FROM descendants
        LEFT JOIN "TimeLog" ON "TimeLog"."taskId" = descendants."id"
    `);

    return Number(rows[0]?.total_minutes ?? 0);
}
