import { TaskStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { nextTaskKey } from "./key";
import {
    isDue,
    isValidRecurrenceRule,
    nextOccurrence,
    type RecurrenceRule,
} from "./recurrence";

const TASK_STATUSES = new Set<string>(Object.values(TaskStatus));
const MAX_CATCH_UP = 10_000;

type MaterializerDatabase = PrismaClient;

type MaterializeResult = {
    processed: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
};

type MaterializeOutcome =
    | "created"
    | "updated"
    | "skipped"
    | "invalid";

function boundedLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 0;
    return Math.max(0, Math.floor(limit));
}

function nextRunAfter(rule: RecurrenceRule, scheduled: Date, now: Date): Date | null {
    let candidate = nextOccurrence(rule, scheduled);
    let attempts = 0;
    while (candidate && candidate.getTime() <= now.getTime() && attempts < MAX_CATCH_UP) {
        candidate = nextOccurrence(rule, candidate);
        attempts++;
    }
    return attempts >= MAX_CATCH_UP ? null : candidate;
}

function shiftedDate(value: Date | null | undefined, shiftMs: number): Date | null | undefined {
    if (!value) return value;
    return new Date(value.getTime() + shiftMs);
}

function createCopyData(source: any, scheduled: Date, taskKey: string | null): Record<string, unknown> {
    const shiftMs = source.dueAt
        ? scheduled.getTime() - source.dueAt.getTime()
        : source.startAt
            ? scheduled.getTime() - source.startAt.getTime()
            : 0;

    return {
        taskKey,
        title: source.title.endsWith("(Recurring)") ? source.title : `${source.title} (Recurring)`,
        description: source.description,
        type: source.type,
        status: "TODO",
        priority: source.priority,
        progressMode: source.progressMode,
        estimateMinutes: source.estimateMinutes,
        manualProgress: null,
        startAt: shiftedDate(source.startAt, shiftMs),
        dueAt: source.dueAt ? scheduled : null,
        dueAtEnd: shiftedDate(source.dueAtEnd, shiftMs),
        doneAt: null,
        plannedStartAt: shiftedDate(source.plannedStartAt, shiftMs),
        plannedEndAt: shiftedDate(source.plannedEndAt, shiftMs),
        estimateConfirmedAt: null,
        effortHours: source.effortHours,
        actualHours: null,
        remainingEffortHours: null,
        aiEffortHours: source.aiEffortHours,
        aiEffortAt: null,
        signatureHash: null,
        isPrivate: source.isPrivate,
        isStarred: false,
        archived: false,
        siblingOrder: source.siblingOrder,
        parentTaskId: source.parentTaskId,
        projectId: source.projectId,
        stageId: source.stageId,
        caseStudyId: source.caseStudyId,
        kpiId: source.kpiId,
        workspaceId: source.workspaceId,
        createdById: source.createdById,
        assignments: source.assignments?.length
            ? { create: source.assignments.map((assignment: any) => ({ userId: assignment.userId, plannedShare: assignment.plannedShare })) }
            : undefined,
        tags: source.tags?.length
            ? { create: source.tags.map((tag: any) => ({ tagId: tag.tagId })) }
            : undefined,
    };
}

async function processRule(
    db: MaterializerDatabase,
    ruleId: string,
    now: Date,
): Promise<MaterializeOutcome> {
    return db.$transaction(async (tx: any) => {
        const rule = await tx.recurringRule.findUnique({
            where: { id: ruleId },
            include: { task: { include: { assignments: true, tags: true } } },
        });
        if (!rule || !rule.active || !rule.nextRunAt || rule.nextRunAt.getTime() > now.getTime()) return "skipped";

        const recurrence = rule as RecurrenceRule;
        if (!isDue(recurrence, now) || !isValidRecurrenceRule(recurrence)) {
            await tx.recurringRule.update({ where: { id: rule.id }, data: { active: false } });
            return "invalid";
        }

        const scheduled = rule.nextRunAt as Date;
        const nextRunAt = nextRunAfter(recurrence, scheduled, now);
        if (!nextRunAt) {
            await tx.recurringRule.update({
                where: { id: rule.id },
                data: { active: false, lastRunAt: scheduled, nextRunAt: null },
            });
            return "invalid";
        }

        if (rule.mode === "create") {
            if (rule.task.type === "EXTERNAL_ACTION") {
                await tx.recurringRule.update({ where: { id: rule.id }, data: { active: false } });
                return "invalid";
            }
            const taskKey = rule.task.projectId ? await nextTaskKey(rule.task.projectId, tx) : null;
            // The copy is dated at the occurrence that is due NOW (`scheduled`),
            // not at the future nextRunAt. Missed occurrences materialize on
            // their due date; nextRunAt still advances forward.
            await tx.task.create({ data: createCopyData(rule.task, scheduled, taskKey) });
            await tx.recurringRule.update({
                where: { id: rule.id },
                data: { lastRunAt: scheduled, nextRunAt },
            });
            return "created";
        }

        if (rule.mode === "status" && typeof rule.targetStatus === "string" && TASK_STATUSES.has(rule.targetStatus)) {
            await tx.task.update({
                where: { id: rule.taskId },
                data: {
                    status: rule.targetStatus,
                    doneAt: rule.targetStatus === TaskStatus.DONE ? now : null,
                },
            });
            await tx.recurringRule.update({
                where: { id: rule.id },
                data: { lastRunAt: scheduled, nextRunAt },
            });
            return "updated";
        }

        await tx.recurringRule.update({ where: { id: rule.id }, data: { active: false } });
        return "invalid";
    });
}

/** Materialize each due active rule once, then advance it beyond `now`. */
export async function runDueRecurrences(
    now: Date,
    limit = 50,
    db: MaterializerDatabase = prisma,
): Promise<MaterializeResult> {
    const result: MaterializeResult = { processed: 0, created: 0, updated: 0, skipped: 0, errors: 0 };
    if (Number.isNaN(now.getTime())) return result;

    const take = boundedLimit(limit);
    if (take === 0) return result;

    const dueRules = await db.recurringRule.findMany({
        where: { active: true, nextRunAt: { not: null, lte: now } },
        orderBy: { nextRunAt: "asc" },
        take,
    });

    for (const rule of dueRules) {
        try {
            const outcome = await processRule(db, rule.id, now);
            if (outcome === "skipped") {
                result.skipped++;
            } else {
                result.processed++;
                if (outcome === "created") result.created++;
                if (outcome === "updated") result.updated++;
                if (outcome === "invalid") result.errors++;
            }
        } catch {
            result.errors++;
        }
    }

    return result;
}
