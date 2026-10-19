import { Prisma, type PrismaClient, type Priority, type TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writePmoAudit } from "./audit";
import { assertCanAttachToParent, assertCanManageExternalAction, canCreatePmoAction, PmoForbiddenError, type PmoActor } from "./authorization";
import { fromRiyadhDate } from "./date";

export class PmoReferenceError extends Error {
    constructor(message: string, public readonly status = 400) {
        super(message);
        this.name = "PmoReferenceError";
    }
}

export function assertExternalActionStatusEditable(currentStatus: TaskStatus, _nextStatus?: TaskStatus): void {
    // A closed/canceled action is fully frozen until reopened through the lifecycle —
    // not only when a new status is supplied.
    if (currentStatus === "DONE" || currentStatus === "CANCELED") {
        throw new PmoReferenceError("Reopen the action through the PMO lifecycle first", 409);
    }
}

export type CreateExternalActionInput = {
    title: string;
    description: string;
    priority: Priority;
    ownerId: string;
    externalContactId: string;
    dueDate: string;
    projectId?: string | null;
    caseStudyId?: string | null;
    collaboratorIds: string[];
    reminderOffsets: number[];
    overdueIntervalDays: number | null;
    tagIds: string[];
    dependencyIds: string[];
    classifyParentWorkAreaId?: string | null;
};

export type UpdateExternalActionInput = Partial<CreateExternalActionInput> & {
    status?: Exclude<TaskStatus, "DONE" | "CANCELED">;
    /** Capability writes must supply this; legacy routes use the explicit adapter below. */
    expectedUpdatedAt?: string;
};

type ReferenceInput = Pick<CreateExternalActionInput,
    "ownerId" | "externalContactId" | "projectId" | "caseStudyId" | "collaboratorIds" | "tagIds" | "dependencyIds"
>;
type ReferenceDatabase = Pick<Prisma.TransactionClient, "user" | "externalContact" | "project" | "caseStudy" | "tag" | "task">;

async function loadActionReferences(
    input: ReferenceInput,
    db: ReferenceDatabase,
    current?: { externalContactId: string; projectId: string | null; caseStudyId: string | null },
) {
    if (Boolean(input.projectId) === Boolean(input.caseStudyId)) {
        throw new PmoReferenceError("Select exactly one project or case study");
    }
    const [owner, contact, parentRecord, collaborators, tags, dependencies] = await Promise.all([
        db.user.findUnique({ where: { id: input.ownerId }, select: { id: true, role: true, isActive: true, managerId: true } }),
        db.externalContact.findUnique({ where: { id: input.externalContactId }, select: { id: true, isArchived: true } }),
        input.projectId
            ? db.project.findUnique({ where: { id: input.projectId }, select: { id: true, ownerId: true, workArea: { select: { id: true, isArchived: true } } } })
            : db.caseStudy.findUnique({ where: { id: input.caseStudyId! }, select: { id: true, ownerId: true, workArea: { select: { id: true, isArchived: true } } } }),
        db.user.findMany({ where: { id: { in: Array.from(new Set([input.ownerId, ...input.collaboratorIds])) }, isActive: true }, select: { id: true } }),
        db.tag.findMany({ where: { id: { in: input.tagIds } }, select: { id: true } }),
        db.task.findMany({ where: { id: { in: input.dependencyIds } }, select: { id: true } }),
    ]);
    const parent = parentRecord as { id: string; ownerId: string | null; workArea: { id: string; isArchived: boolean } | null } | null;
    if (!owner || !owner.isActive || owner.role === "VIEWER") throw new PmoReferenceError("Owner must be an active non-viewer", 404);
    // Only enforce "active" on references the update actually changes: an archived
    // contact/work-area that is already attached must not block unrelated field edits.
    const contactUnchanged = Boolean(current) && current!.externalContactId === input.externalContactId;
    if (!contact || (contact.isArchived && !contactUnchanged)) throw new PmoReferenceError("Active external contact not found", 404);
    if (!parent) throw new PmoReferenceError("Parent not found", 404);
    const parentUnchanged =
        Boolean(current) && (input.projectId ?? null) === current!.projectId && (input.caseStudyId ?? null) === current!.caseStudyId;
    if (!parent.workArea || (parent.workArea.isArchived && !parentUnchanged)) throw new PmoReferenceError("Parent requires an active work area");

    const assigneeIds = Array.from(new Set([input.ownerId, ...input.collaboratorIds]));
    if (collaborators.length !== assigneeIds.length) throw new PmoReferenceError("All collaborators must be active users");
    if (tags.length !== input.tagIds.length) throw new PmoReferenceError("One or more tags were not found");
    if (dependencies.length !== input.dependencyIds.length) throw new PmoReferenceError("One or more dependencies were not found");
    return { owner, contact, parent, assigneeIds };
}

export async function createExternalAction(input: CreateExternalActionInput, actor: PmoActor, db: PrismaClient = prisma) {
    if (!canCreatePmoAction(actor)) throw new PmoForbiddenError();
    return db.$transaction(async (tx) => {
        // Load the parent once: authorize attaching an action to it (admin / parent
        // owner / member), then optionally classify it (owner/admin only, matching the
        // project PATCH rule) — atomically, so a create failure strands nothing.
        const parentId = input.projectId ?? input.caseStudyId;
        if (!parentId) throw new PmoReferenceError("Select exactly one project or case study");
        const parent = input.projectId
            ? await tx.project.findUnique({ where: { id: input.projectId }, select: { ownerId: true, workAreaId: true, members: { select: { userId: true } } } })
            : await tx.caseStudy.findUnique({ where: { id: input.caseStudyId! }, select: { ownerId: true, workAreaId: true, members: { select: { userId: true } } } });
        if (!parent) throw new PmoReferenceError("Parent not found", 404);
        assertCanAttachToParent(actor, { ownerId: parent.ownerId, memberIds: parent.members.map((member) => member.userId) });
        if (input.classifyParentWorkAreaId && !parent.workAreaId) {
            if (actor.role !== "ADMIN" && parent.ownerId !== actor.id) throw new PmoForbiddenError();
            const area = await tx.workArea.findFirst({ where: { id: input.classifyParentWorkAreaId, isArchived: false }, select: { id: true } });
            if (!area) throw new PmoReferenceError("Active work area not found");
            if (input.projectId) await tx.project.update({ where: { id: input.projectId }, data: { workAreaId: input.classifyParentWorkAreaId } });
            else await tx.caseStudy.update({ where: { id: input.caseStudyId! }, data: { workAreaId: input.classifyParentWorkAreaId } });
        }
        const references = await loadActionReferences(input, tx);
        const task = await tx.task.create({
            data: {
                type: "EXTERNAL_ACTION",
                title: input.title,
                description: input.description,
                status: "WAITING",
                priority: input.priority,
                dueAt: fromRiyadhDate(input.dueDate),
                isPrivate: false,
                projectId: input.projectId ?? null,
                caseStudyId: input.caseStudyId ?? null,
                createdById: actor.id,
                assignments: { create: references.assigneeIds.map((userId) => ({ userId })) },
                tags: input.tagIds.length ? { create: input.tagIds.map((tagId) => ({ tagId })) } : undefined,
            },
        });
        if (input.dependencyIds.length) {
            await tx.taskDependency.createMany({ data: input.dependencyIds.map((dependsOnId) => ({ taskId: task.id, dependsOnId })) });
        }
        const externalAction = await tx.externalAction.create({
            data: {
                taskId: task.id,
                ownerId: input.ownerId,
                externalContactId: input.externalContactId,
                overdueIntervalDays: input.overdueIntervalDays,
            },
        });
        await tx.reminderRule.createMany({
            data: input.reminderOffsets.map((daysBeforeDue) => ({ externalActionId: externalAction.id, daysBeforeDue })),
        });
        await writePmoAudit(tx, {
            entityType: "external_action",
            entityId: externalAction.id,
            action: "create",
            actorId: actor.id,
            taskId: task.id,
            changes: { fields: ["title", "description", "priority", "dueDate", "ownerId", "externalContactId", "parent", "collaboratorIds", "tagIds", "dependencyIds"] },
        });
        return { taskId: task.id, externalActionId: externalAction.id, references };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateExternalAction(taskId: string, input: UpdateExternalActionInput, actor: PmoActor, db: PrismaClient = prisma) {
    return db.$transaction(async (tx) => {
        // Serialize with lifecycle mutations and make the read participate in conflict
        // detection so a concurrent reassignment can't be silently reverted.
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `pmo:${taskId}`);
        const current = await tx.task.findUnique({
            where: { id: taskId },
            include: {
                externalAction: { include: { owner: { select: { managerId: true } }, reminderRules: true } },
                project: { select: { ownerId: true } },
                caseStudy: { select: { ownerId: true } },
                assignments: { select: { userId: true } },
                tags: { select: { tagId: true } },
                blockers: { select: { dependsOnId: true } },
            },
        });
        if (!current?.externalAction || current.type !== "EXTERNAL_ACTION") throw new PmoReferenceError("External action not found", 404);
        if (input.expectedUpdatedAt && current.updatedAt.toISOString() !== input.expectedUpdatedAt) {
            throw Object.assign(new PmoReferenceError("PMO action changed; refresh before updating", 409), { code: "STALE_VERSION" });
        }
        const externalAction = current.externalAction;
        assertExternalActionStatusEditable(current.status, input.status);
        assertCanManageExternalAction(actor, {
            ownerId: externalAction.ownerId,
            parentOwnerId: current.project?.ownerId ?? current.caseStudy?.ownerId ?? null,
            ownerManagerId: externalAction.owner.managerId,
        });
        const merged = {
            ownerId: input.ownerId ?? externalAction.ownerId,
            externalContactId: input.externalContactId ?? externalAction.externalContactId,
            projectId: input.projectId === undefined ? current.projectId : input.projectId,
            caseStudyId: input.caseStudyId === undefined ? current.caseStudyId : input.caseStudyId,
            collaboratorIds: input.collaboratorIds ?? current.assignments.map((assignment) => assignment.userId).filter((id) => id !== externalAction.ownerId),
            tagIds: input.tagIds ?? current.tags.map((tag) => tag.tagId),
            dependencyIds: input.dependencyIds ?? current.blockers.map((dependency) => dependency.dependsOnId),
        };
        const references = await loadActionReferences(merged, tx, {
            externalContactId: externalAction.externalContactId,
            projectId: current.projectId,
            caseStudyId: current.caseStudyId,
        });
        await tx.task.update({
            where: { id: taskId },
            data: {
                title: input.title,
                description: input.description,
                priority: input.priority,
                status: input.status,
                dueAt: input.dueDate ? fromRiyadhDate(input.dueDate) : undefined,
                projectId: merged.projectId,
                caseStudyId: merged.caseStudyId,
                isPrivate: false,
            },
        });
        await tx.externalAction.update({
            where: { taskId },
            data: { ownerId: merged.ownerId, externalContactId: merged.externalContactId, overdueIntervalDays: input.overdueIntervalDays },
        });
        await tx.taskAssignment.deleteMany({ where: { taskId, userId: { notIn: references.assigneeIds } } });
        await tx.taskAssignment.createMany({ data: references.assigneeIds.map((userId) => ({ taskId, userId })), skipDuplicates: true });
        if (input.tagIds) {
            await tx.taskTag.deleteMany({ where: { taskId } });
            await tx.taskTag.createMany({ data: input.tagIds.map((tagId) => ({ taskId, tagId })), skipDuplicates: true });
        }
        if (input.dependencyIds) {
            await tx.taskDependency.deleteMany({ where: { taskId } });
            await tx.taskDependency.createMany({ data: input.dependencyIds.map((dependsOnId) => ({ taskId, dependsOnId })), skipDuplicates: true });
        }
        if (input.reminderOffsets) {
            await tx.reminderRule.deleteMany({ where: { externalActionId: externalAction.id } });
            await tx.reminderRule.createMany({ data: input.reminderOffsets.map((daysBeforeDue) => ({ externalActionId: externalAction.id, daysBeforeDue })) });
        }
        await writePmoAudit(tx, {
            entityType: "external_action",
            entityId: externalAction.id,
            action: "update",
            actorId: actor.id,
            taskId,
            changes: { fields: Object.keys(input) },
        });
        return tx.task.findUnique({
            where: { id: taskId },
            include: {
                externalAction: { include: { owner: true, externalContact: true, reminderRules: true } },
                project: { include: { workArea: true } },
                caseStudy: { include: { workArea: true } },
                assignments: true,
                tags: true,
                blockers: true,
            },
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Explicit compatibility seam for the legacy route, which predates version tokens. */
export async function updateExternalActionLegacy(taskId: string, input: UpdateExternalActionInput, actor: PmoActor, db: PrismaClient = prisma) {
    const { expectedUpdatedAt: _ignored, ...legacyInput } = input;
    return updateExternalAction(taskId, legacyInput, actor, db);
}
