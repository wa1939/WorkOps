import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { projectVisibilityWhere } from "@/lib/executive-summary";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { canCreateProjects, canUpdateProject } from "./authorization";
import { composeScopes, workspaceScopeWhere } from "@/lib/workspaces/scope";
import type { CreateProjectInput, UpdateProjectInput } from "./schemas";

type Transaction = Prisma.TransactionClient;
type ProjectDatabase = Pick<
    typeof prisma,
    "project" | "projectMember" | "projectObjective" | "projectOutput" | "projectRisk" | "projectStage" | "task" | "user" | "department" | "workArea" | "kPI" | "auditLog"
> & {
    $transaction: typeof prisma.$transaction;
};

export class ProjectCommandError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code: string,
    ) {
        super(message);
        this.name = "ProjectCommandError";
    }
}

function isRecordNotFoundError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2025";
}

const FULL_PROJECTION = {
    owner: true,
    manager: true,
    sponsor: true,
    responsibleDepartment: true,
    workArea: true,
    members: { include: { user: true } },
    objectives: { include: { kpi: true }, orderBy: { order: "asc" as const } },
    outputs: { orderBy: { order: "asc" as const } },
    risks: true,
    stages: { orderBy: { order: "asc" as const } },
    tasks: { select: { id: true, status: true } },
} satisfies Prisma.ProjectInclude;

function toDate(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}

async function assertReferencesValid(
    tx: Transaction,
    input: {
        ownerId?: string | null;
        managerId?: string | null;
        sponsorId?: string | null;
        responsibleDepartmentId?: string | null;
        workAreaId?: string | null;
        memberIds?: string[];
        objectives?: Array<{ kpiId?: string | null }>;
        outputs?: Array<{ ownerId?: string | null }>;
        risks?: Array<{ ownerId?: string | null }>;
    },
): Promise<void> {
    const userIds = [
        input.ownerId,
        input.managerId,
        input.sponsorId,
        ...(input.memberIds ?? []),
        ...(input.outputs ?? []).map((output) => output.ownerId),
        ...(input.risks ?? []).map((risk) => risk.ownerId),
    ].filter((id): id is string => typeof id === "string" && id.length > 0);
    const uniqueUserIds = Array.from(new Set(userIds));
    if (uniqueUserIds.length > 0) {
        const activeUsers = await tx.user.findMany({
            where: { id: { in: uniqueUserIds }, isActive: true },
            select: { id: true },
        });
        if (activeUsers.length !== uniqueUserIds.length) {
            throw new ProjectCommandError("Referenced user is missing or inactive", 400, "INVALID_REFERENCE");
        }
    }

    if (input.responsibleDepartmentId) {
        const department = await tx.department.findFirst({
            where: { id: input.responsibleDepartmentId },
            select: { id: true },
        });
        if (!department) {
            throw new ProjectCommandError("Referenced department not found", 400, "INVALID_REFERENCE");
        }
    }

    if (input.workAreaId) {
        const area = await tx.workArea.findFirst({
            where: { id: input.workAreaId, isArchived: false },
            select: { id: true },
        });
        if (!area) {
            throw new ProjectCommandError("Active work area not found", 400, "INVALID_REFERENCE");
        }
    }

    const kpiIds = (input.objectives ?? [])
        .map((objective) => objective.kpiId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
    if (kpiIds.length > 0) {
        const uniqueKpiIds = Array.from(new Set(kpiIds));
        const kpis = await tx.kPI.findMany({
            where: { id: { in: uniqueKpiIds } },
            select: { id: true },
        });
        if (kpis.length !== uniqueKpiIds.length) {
            throw new ProjectCommandError("Referenced KPI not found", 400, "INVALID_REFERENCE");
        }
    }
}

async function writeChildren(
    tx: Transaction,
    projectId: string,
    input: CreateProjectInput | UpdateProjectInput,
): Promise<void> {
    if (input.objectives !== undefined) {
        await tx.projectObjective.deleteMany({ where: { projectId } });
        if (input.objectives.length > 0) {
            await tx.projectObjective.createMany({
                data: input.objectives.map((objective) => ({
                    projectId,
                    statement: objective.statement,
                    measure: objective.measure ?? null,
                    target: objective.target ?? null,
                    kpiId: objective.kpiId ?? null,
                    order: objective.order,
                })),
            });
        }
    }
    if (input.outputs !== undefined) {
        await tx.projectOutput.deleteMany({ where: { projectId } });
        if (input.outputs.length > 0) {
            await tx.projectOutput.createMany({
                data: input.outputs.map((output) => ({
                    projectId,
                    title: output.title,
                    description: output.description ?? null,
                    acceptanceCriteria: output.acceptanceCriteria ?? null,
                    ownerId: output.ownerId ?? null,
                    dueAt: toDate(output.dueAt),
                    status: output.status,
                    order: output.order,
                })),
            });
        }
    }
    if (input.risks !== undefined) {
        await tx.projectRisk.deleteMany({ where: { projectId } });
        if (input.risks.length > 0) {
            await tx.projectRisk.createMany({
                data: input.risks.map((risk) => ({
                    projectId,
                    title: risk.title,
                    description: risk.description ?? null,
                    likelihood: risk.likelihood,
                    impact: risk.impact,
                    mitigation: risk.mitigation ?? null,
                    ownerId: risk.ownerId ?? null,
                    status: risk.status,
                })),
            });
        }
    }
    if (input.stages !== undefined) {
        await tx.projectStage.deleteMany({ where: { projectId } });
        if (input.stages.length > 0) {
            await tx.projectStage.createMany({
                data: input.stages.map((stage) => ({
                    projectId,
                    name: stage.name,
                    order: stage.order,
                    color: stage.color ?? null,
                    startAt: toDate(stage.startAt),
                    dueAt: toDate(stage.dueAt),
                    gateCriteria: stage.gateCriteria ?? null,
                    status: stage.status,
                })),
            });
        }
    }
    if (input.memberIds !== undefined) {
        await tx.projectMember.deleteMany({ where: { projectId } });
        if (input.memberIds.length > 0) {
            await tx.projectMember.createMany({
                data: Array.from(new Set(input.memberIds)).map((userId) => ({ projectId, userId })),
            });
        }
    }
}

function changedFields(input: UpdateProjectInput | CreateProjectInput): string[] {
    return Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined);
}

export async function createProject(
    input: CreateProjectInput,
    actor: SabahActor,
    db: ProjectDatabase = prisma,
) {
    if (!canCreateProjects(actor)) {
        throw new ProjectCommandError("VIEWER cannot create projects", 403, "FORBIDDEN");
    }

    // Explicit null means intentionally ownerless ("floating"/team-pool project);
    // only an omitted field falls back to the actor.
    const ownerId = input.ownerId === undefined ? actor.id : input.ownerId;
    const managerId = input.managerId === undefined ? actor.id : input.managerId;

    const created = await db.$transaction(
        async (tx) => {
            await assertReferencesValid(tx, { ...input, ownerId, managerId });
            const project = await tx.project.create({
                data: {
                    name: input.name,
                    description: input.description ?? null,
                    status: input.status,
                    startAt: toDate(input.startAt),
                    dueAt: toDate(input.dueAt),
                    dueAtEnd: toDate(input.dueAtEnd),
                    ownerId,
                    managerId,
                    responsibleDepartmentId: input.responsibleDepartmentId ?? null,
                    sponsorId: input.sponsorId ?? null,
                    sponsorStatus: input.sponsorStatus,
                    objective: input.objective ?? null,
                    scope: input.scope ?? null,
                    successCriteria: input.successCriteria ?? null,
                    projectType: input.projectType ?? null,
                    priority: input.priority,
                    health: input.health,
                    workAreaId: input.workAreaId ?? null,
                    metadataJson: Object.keys(input.metadata).length > 0 ? JSON.stringify(input.metadata) : null,
                },
                select: { id: true },
            });
            await writeChildren(tx, project.id, input);
            await tx.auditLog.create({
                data: {
                    entityType: "project",
                    entityId: project.id,
                    action: "created",
                    actorId: actor.id,
                    metaJson: JSON.stringify({ fields: changedFields(input) }),
                },
            });
            return project;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Read-back verification: the projection the caller receives reflects persisted state.
    const readBack = await db.project.findUnique({ where: { id: created.id }, include: FULL_PROJECTION });
    if (!readBack) {
        throw new ProjectCommandError("Project vanished after create", 500, "READ_BACK_FAILED");
    }
    return readBack;
}

export async function updateProject(
    id: string,
    input: UpdateProjectInput,
    actor: SabahActor,
    expectedUpdatedAt: Date,
    db: ProjectDatabase = prisma,
) {
    const existing = await db.project.findUnique({
        where: { id },
        select: { updatedAt: true },
    });
    if (!existing) {
        throw new ProjectCommandError("Project not found", 404, "NOT_FOUND");
    }
    // Permission before version: an unauthorized caller must not be able to
    // probe expectedUpdatedAt validity via the 409 path.
    const allowed = await canUpdateProject(id, actor, db);
    if (!allowed) {
        throw new ProjectCommandError("Not allowed to update this project", 403, "FORBIDDEN");
    }
    if (existing.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ProjectCommandError("Project was modified by someone else", 409, "VERSION_CONFLICT");
    }

    try {
        await db.$transaction(
            async (tx) => {
            await assertReferencesValid(tx, input);
            if (input.workAreaId === null) {
                // Mirrors the old PATCH guard (PmoWorkAreaRequiredError): a work
                // area cannot be cleared while external actions are attached.
                const externalActionCount = await tx.task.count({
                    where: { projectId: id, type: "EXTERNAL_ACTION" },
                });
                if (externalActionCount > 0) {
                    throw new ProjectCommandError(
                        "Move or remove external actions before clearing the work area",
                        409,
                        "WORK_AREA_REQUIRED",
                    );
                }
            }
            const data: Record<string, unknown> = {
                name: input.name,
                description: input.description === undefined ? undefined : input.description,
                status: input.status,
                startAt: input.startAt === undefined ? undefined : toDate(input.startAt),
                dueAt: input.dueAt === undefined ? undefined : toDate(input.dueAt),
                dueAtEnd: input.dueAtEnd === undefined ? undefined : toDate(input.dueAtEnd),
                ownerId: input.ownerId === undefined ? undefined : input.ownerId,
                managerId: input.managerId === undefined ? undefined : input.managerId,
                responsibleDepartmentId:
                    input.responsibleDepartmentId === undefined ? undefined : input.responsibleDepartmentId,
                sponsorId: input.sponsorId === undefined ? undefined : input.sponsorId,
                sponsorStatus: input.sponsorStatus,
                objective: input.objective === undefined ? undefined : input.objective,
                scope: input.scope === undefined ? undefined : input.scope,
                successCriteria: input.successCriteria === undefined ? undefined : input.successCriteria,
                projectType: input.projectType === undefined ? undefined : input.projectType,
                priority: input.priority,
                health: input.health,
                workAreaId: input.workAreaId === undefined ? undefined : input.workAreaId,
                metadataJson:
                    input.metadata === undefined
                        ? undefined
                        : Object.keys(input.metadata).length > 0
                          ? JSON.stringify(input.metadata)
                          : null,
            };
            for (const key of Object.keys(data)) {
                if (data[key] === undefined) {
                    delete data[key];
                }
            }
            await tx.project.update({ where: { id, updatedAt: expectedUpdatedAt }, data });
            await writeChildren(tx, id, input);
            await tx.auditLog.create({
                data: {
                    entityType: "project",
                    entityId: id,
                    action: "updated",
                    actorId: actor.id,
                    metaJson: JSON.stringify({ fields: changedFields(input) }),
                },
            });
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
    } catch (error) {
        if (isRecordNotFoundError(error)) {
            throw new ProjectCommandError("Project was modified by someone else", 409, "VERSION_CONFLICT");
        }
        throw error;
    }

    const readBack = await db.project.findUnique({ where: { id }, include: FULL_PROJECTION });
    if (!readBack) {
        throw new ProjectCommandError("Project vanished after update", 500, "READ_BACK_FAILED");
    }
    return readBack;
}

type ProjectDatabaseArgument = ProjectDatabase | string;

function isProjectDatabase(value: unknown): value is ProjectDatabase {
    return !!value && typeof value === "object" && ("project" in value || "$transaction" in value);
}

function resolveProjectDatabase(dbOrWorkspace: ProjectDatabaseArgument = prisma, workspaceIdOrDb?: string | ProjectDatabase) {
    if (typeof dbOrWorkspace === "string") {
        return { db: isProjectDatabase(workspaceIdOrDb) ? workspaceIdOrDb : prisma as ProjectDatabase, workspaceId: dbOrWorkspace };
    }
    return { db: dbOrWorkspace ?? (isProjectDatabase(workspaceIdOrDb) ? workspaceIdOrDb : prisma), workspaceId: typeof workspaceIdOrDb === "string" ? workspaceIdOrDb : undefined };
}

export async function getProjectForActor(id: string, actor: SabahActor, dbOrWorkspace: ProjectDatabaseArgument = prisma, workspaceId?: string | ProjectDatabase) {
    const visibilityWhere = projectVisibilityWhere(actor) as Prisma.ProjectWhereInput;
    const resolved = resolveProjectDatabase(dbOrWorkspace, workspaceId);
    const predicates: Prisma.ProjectWhereInput[] = [visibilityWhere];
    if (resolved.workspaceId !== undefined) {
        predicates.push(workspaceScopeWhere(resolved.workspaceId) as Prisma.ProjectWhereInput);
    }
    return resolved.db.project.findFirst({ where: { id, AND: predicates } as Prisma.ProjectWhereInput, include: FULL_PROJECTION });
}

export async function listProjectsForActor(
    query: { search?: string; workAreaId?: string } = {},
    actor: SabahActor,
    dbOrWorkspace: ProjectDatabaseArgument = prisma,
    workspaceId?: string | ProjectDatabase,
) {
    const and: Prisma.ProjectWhereInput[] = [projectVisibilityWhere(actor) as Prisma.ProjectWhereInput];
    const resolved = resolveProjectDatabase(dbOrWorkspace, workspaceId);
    if (resolved.workspaceId !== undefined) {
        and.push(workspaceScopeWhere(resolved.workspaceId) as Prisma.ProjectWhereInput);
    }
    if (query.search) {
        and.push({ name: { contains: query.search, mode: "insensitive" } });
    }
    if (query.workAreaId) {
        and.push({ workAreaId: query.workAreaId });
    }
    return resolved.db.project.findMany({ where: { AND: and }, include: FULL_PROJECTION, orderBy: { updatedAt: "desc" } });
}
