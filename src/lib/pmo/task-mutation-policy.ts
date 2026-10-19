export class PmoWorkflowRequiredError extends Error {
    constructor(message = "Use the PMO action workflow") { super(message); this.name = "PmoWorkflowRequiredError"; }
}

type PmoTask = { type: string; ownerId?: string | null; status?: string | null };
type Mutation = Record<string, unknown>;

export function assertGenericTaskMutationAllowed(task: PmoTask, payload: Mutation): void {
    if (task.type !== "EXTERNAL_ACTION") return;
    if (["DONE", "CANCELED"].includes(task.status ?? "") && Object.keys(payload).some((key) => key !== "expectedUpdatedAt")) throw new PmoWorkflowRequiredError();
    if (payload.delete === true || payload.status !== undefined || payload.dueAt !== undefined || payload.isPrivate !== undefined || payload.projectId !== undefined || payload.caseStudyId !== undefined) throw new PmoWorkflowRequiredError();
    if (Array.isArray(payload.assigneeIds) && task.ownerId && !payload.assigneeIds.includes(task.ownerId)) throw new PmoWorkflowRequiredError();
}

export function isPmoQuickCompleteAllowed(taskType: string): boolean { return taskType !== "EXTERNAL_ACTION"; }

export function buildAiUndoWhere(taskIds: string[], creatorId: string, cutoff: Date): Prisma.TaskWhereInput {
    return {
        id: { in: taskIds },
        type: "STANDARD",
        createdById: creatorId,
        createdAt: { gte: cutoff },
        status: { notIn: ["DONE", "CANCELED"] },
    };
}
import type { Prisma } from "@prisma/client";
