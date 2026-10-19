import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type TaskKeyDatabase = Pick<PrismaClient, "project">;

type ProjectCounter = {
    id: string;
    name: string;
    taskSeq: number;
};

const NON_ALPHANUMERIC = /[^A-Z0-9]/g;

/** Derive a stable three-character project prefix from its name and id. */
export function deriveProjectPrefix(
    projectName: string | null | undefined,
    projectId: string | null | undefined,
): string {
    const prefix = `${projectName ?? ""}${projectId ?? ""}`
        .toUpperCase()
        .replace(NON_ALPHANUMERIC, "")
        .slice(0, 3);

    return prefix || "TSK";
}

/** Format a task key without touching the database. */
export function formatTaskKey(prefix: string, sequence: number): string {
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
        throw new RangeError("Task key sequence must be a positive safe integer");
    }

    const normalizedPrefix = prefix.toUpperCase().replace(NON_ALPHANUMERIC, "").slice(0, 3) || "TSK";
    return `${normalizedPrefix}-${String(sequence).padStart(4, "0")}`;
}

/** Atomically reserve the next per-project sequence and return its task key. */
export async function nextTaskKey(
    projectId: string,
    db: TaskKeyDatabase = prisma,
): Promise<string> {
    const project = await db.project.update({
        where: { id: projectId },
        data: { taskSeq: { increment: 1 } },
        select: { id: true, name: true, taskSeq: true },
    }) as ProjectCounter;

    return formatTaskKey(deriveProjectPrefix(project.name, project.id), project.taskSeq);
}
