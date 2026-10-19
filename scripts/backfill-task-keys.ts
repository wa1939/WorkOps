import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertLocalDatabaseUrl } from "./assert-local-database";
import { nextTaskKey, type TaskKeyDatabase } from "../src/lib/tasks/key";

export const TASK_KEY_BACKFILL_BATCH_SIZE = 1000;

type BackfillDatabase = TaskKeyDatabase & Pick<PrismaClient, "task">;

type BackfillTask = {
    id: string;
    projectId: string | null;
};

export type TaskKeyBackfillResult = {
    assigned: number;
    skippedNoProject: number;
    batches: number;
};

/** Assign keys only to currently unkeyed project tasks, in bounded batches. */
export async function backfillTaskKeys(
    db: BackfillDatabase,
    batchSize = TASK_KEY_BACKFILL_BATCH_SIZE,
): Promise<TaskKeyBackfillResult> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
        throw new RangeError("Task key backfill batch size must be a positive safe integer");
    }

    let assigned = 0;
    let batches = 0;

    while (true) {
        const tasks = await db.task.findMany({
            where: { taskKey: null, projectId: { not: null } },
            select: { id: true, projectId: true },
            orderBy: { id: "asc" },
            take: batchSize,
        }) as BackfillTask[];

        if (tasks.length === 0) break;
        batches += 1;

        for (const task of tasks) {
            if (!task.projectId) continue;

            const taskKey = await nextTaskKey(task.projectId, db);
            const updated = await db.task.updateMany({
                where: { id: task.id, taskKey: null },
                data: { taskKey },
            });
            assigned += updated.count;
        }
    }

    const skippedNoProject = await db.task.count({
        where: { taskKey: null, projectId: null },
    });

    return { assigned, skippedNoProject, batches };
}

function requireExplicitLocalDatabaseUrl(): string {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error("DATABASE_URL must be set explicitly for task-key backfill");
    }
    assertLocalDatabaseUrl(databaseUrl);
    return databaseUrl;
}

export async function main(): Promise<TaskKeyBackfillResult> {
    requireExplicitLocalDatabaseUrl();
    const db = new PrismaClient();

    try {
        const result = await backfillTaskKeys(db);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result;
    } finally {
        await db.$disconnect();
    }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
    void main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : "Task-key backfill failed"}\n`);
        process.exitCode = 1;
    });
}
