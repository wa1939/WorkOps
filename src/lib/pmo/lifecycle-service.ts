import { Prisma, type PrismaClient } from "@prisma/client";
import type { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertCanManageExternalAction, type PmoActor } from "./authorization";
import { writePmoAudit } from "./audit";
import type { evidenceSchema } from "./schemas";

type EvidenceInput = z.infer<typeof evidenceSchema>;

export class PmoLifecycleError extends Error {
    constructor(message: string, public readonly status = 400) {
        super(message);
        this.name = "PmoLifecycleError";
    }
}

export function validateClosureBasis(evidenceCount: number, closureNote?: string | null): void {
    if (evidenceCount === 0 && !closureNote?.trim()) {
        throw new PmoLifecycleError("Add evidence or a closure note before closing");
    }
}

export function validateEvidenceRemoval(input: { status: string; evidenceCount: number; closureNote: string | null }): void {
    if (input.status === "DONE" && input.evidenceCount <= 1 && !input.closureNote?.trim()) {
        throw new PmoLifecycleError("Closed action must retain evidence or a closure note");
    }
}

async function lockAction(tx: Prisma.TransactionClient, taskId: string): Promise<void> {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pmo:${taskId}`);
}

async function loadAction(tx: Prisma.TransactionClient, taskId: string, actor: PmoActor) {
    const task = await tx.task.findFirst({
        where: { id: taskId, type: "EXTERNAL_ACTION" },
        include: {
            externalAction: {
                include: {
                    owner: { select: { managerId: true } },
                    _count: { select: { evidence: true } },
                },
            },
            project: { select: { ownerId: true } },
            caseStudy: { select: { ownerId: true } },
        },
    });
    if (!task?.externalAction) throw new PmoLifecycleError("External action not found", 404);

    assertCanManageExternalAction(actor, {
        ownerId: task.externalAction.ownerId,
        parentOwnerId: task.project?.ownerId ?? task.caseStudy?.ownerId ?? null,
        ownerManagerId: task.externalAction.owner.managerId,
    });
    return { ...task, externalAction: task.externalAction };
}

export async function recordExternalResponse(
    taskId: string,
    input: { comment: string; evidence?: EvidenceInput },
    actor: PmoActor,
    db: PrismaClient = prisma,
) {
    return db.$transaction(async (tx) => {
        await lockAction(tx, taskId);
        const current = await loadAction(tx, taskId, actor);
        if (current.status === "DONE" || current.status === "CANCELED") throw new PmoLifecycleError("Action is closed; reopen it first", 409);
        const now = new Date();
        const comment = await tx.comment.create({ data: { taskId, authorId: actor.id, body: input.comment } });
        if (input.evidence) {
            await tx.actionEvidence.create({
                data: { externalActionId: current.externalAction.id, ...input.evidence, addedById: actor.id },
            });
        }
        await tx.externalAction.update({
            where: { id: current.externalAction.id },
            data: { lastExternalResponseAt: now },
        });
        if (current.status === "WAITING") {
            await tx.task.update({ where: { id: taskId }, data: { status: "DOING" } });
        }
        await writePmoAudit(tx, {
            entityType: "external_action",
            entityId: current.externalAction.id,
            action: "response_recorded",
            actorId: actor.id,
            taskId,
            changes: { fields: input.evidence ? ["comment", "evidence", "lastExternalResponseAt", "status"] : ["comment", "lastExternalResponseAt", "status"] },
        });
        return comment;
    });
}

export async function addEvidence(taskId: string, input: EvidenceInput, actor: PmoActor, db: PrismaClient = prisma) {
    return db.$transaction(async (tx) => {
        await lockAction(tx, taskId);
        const current = await loadAction(tx, taskId, actor);
        if (current.status === "DONE" || current.status === "CANCELED") throw new PmoLifecycleError("Action is closed; reopen it first", 409);
        const evidence = await tx.actionEvidence.create({
            data: { externalActionId: current.externalAction.id, ...input, addedById: actor.id },
        });
        await writePmoAudit(tx, {
            entityType: "action_evidence",
            entityId: evidence.id,
            action: "create",
            actorId: actor.id,
            taskId,
            changes: { fields: ["label", "url"] },
        });
        return evidence;
    });
}

export async function updateEvidence(
    taskId: string,
    evidenceId: string,
    input: EvidenceInput,
    actor: PmoActor,
    db: PrismaClient = prisma,
) {
    return db.$transaction(async (tx) => {
        await lockAction(tx, taskId);
        const current = await loadAction(tx, taskId, actor);
        if (current.status === "DONE" || current.status === "CANCELED") throw new PmoLifecycleError("Action is closed; reopen it first", 409);
        const existing = await tx.actionEvidence.findFirst({ where: { id: evidenceId, externalActionId: current.externalAction.id } });
        if (!existing) throw new PmoLifecycleError("Evidence not found", 404);
        const evidence = await tx.actionEvidence.update({ where: { id: evidenceId }, data: input });
        await writePmoAudit(tx, {
            entityType: "action_evidence",
            entityId: evidenceId,
            action: "update",
            actorId: actor.id,
            taskId,
            changes: { fields: ["label", "url"] },
        });
        return evidence;
    });
}

export async function removeEvidence(taskId: string, evidenceId: string, actor: PmoActor, db: PrismaClient = prisma) {
    return db.$transaction(async (tx) => {
        await lockAction(tx, taskId);
        const current = await loadAction(tx, taskId, actor);
        const existing = await tx.actionEvidence.findFirst({ where: { id: evidenceId, externalActionId: current.externalAction.id } });
        if (!existing) throw new PmoLifecycleError("Evidence not found", 404);
        validateEvidenceRemoval({
            status: current.status,
            evidenceCount: current.externalAction._count.evidence,
            closureNote: current.externalAction.closureNote,
        });
        await tx.actionEvidence.delete({ where: { id: evidenceId } });
        await writePmoAudit(tx, {
            entityType: "action_evidence",
            entityId: evidenceId,
            action: "remove",
            actorId: actor.id,
            taskId,
            changes: { fields: ["evidence"] },
        });
    });
}

type LifecycleInput =
    | { action: "close"; closureNote?: string }
    | { action: "cancel"; reason: string }
    | { action: "reopen" };

export async function transitionExternalAction(
    taskId: string,
    input: LifecycleInput,
    actor: PmoActor,
    db: PrismaClient = prisma,
) {
    return db.$transaction(async (tx) => {
        await lockAction(tx, taskId);
        const current = await loadAction(tx, taskId, actor);
        const now = new Date();

        // State machine: close/cancel only from an open status; reopen only from a terminal one.
        const terminal = current.status === "DONE" || current.status === "CANCELED";
        if (input.action === "reopen") {
            if (!terminal) throw new PmoLifecycleError("Only a closed or canceled action can be reopened", 409);
        } else if (terminal) {
            throw new PmoLifecycleError(`Action is already ${current.status === "DONE" ? "closed" : "canceled"}`, 409);
        }

        if (input.action === "close") {
            validateClosureBasis(current.externalAction._count.evidence, input.closureNote);
            await tx.task.update({ where: { id: taskId }, data: { status: "DONE", doneAt: now } });
            await tx.externalAction.update({
                where: { id: current.externalAction.id },
                data: { closedAt: now, closedById: actor.id, closureNote: input.closureNote?.trim() || null },
            });
        } else if (input.action === "cancel") {
            const reason = input.reason.trim();
            if (!reason) throw new PmoLifecycleError("Cancellation reason is required");
            await tx.task.update({ where: { id: taskId }, data: { status: "CANCELED", doneAt: null } });
            await tx.externalAction.update({
                where: { id: current.externalAction.id },
                data: { closedAt: null, closedById: null, closureNote: null },
            });
        } else {
            await tx.task.update({ where: { id: taskId }, data: { status: "WAITING", doneAt: null } });
            await tx.externalAction.update({
                where: { id: current.externalAction.id },
                data: { closedAt: null, closedById: null, closureNote: null },
            });
        }

        await writePmoAudit(tx, {
            entityType: "external_action",
            entityId: current.externalAction.id,
            action: input.action,
            actorId: actor.id,
            taskId,
            changes: input.action === "cancel"
                ? { fields: ["status", "reason"], reason: input.reason.trim() }
                : { fields: ["status", "closedAt", "closedById", "closureNote"] },
        });
        return tx.task.findUnique({ where: { id: taskId }, include: { externalAction: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
