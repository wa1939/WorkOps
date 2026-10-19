import { z } from "zod";
import { Prisma } from "@prisma/client";
import { defineCapability } from "../contracts";
import type { CapabilityRegistry } from "../registry";
import {
    createProject,
    updateProject,
    getProjectForActor,
    listProjectsForActor,
} from "@/lib/projects/commands";
import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { DEFAULT_PROJECT_STAGES } from "@/lib/project-stages";
import { findDuplicateCandidates, assertNoExactDuplicate, createPrismaDuplicateDb } from "@/lib/sabah/intelligence/duplicates";
import {
    createProjectSchema,
    updateProjectSchema,
    type CreateProjectInput,
    type UpdateProjectInput,
} from "@/lib/projects/schemas";

type ProjectProjection = Awaited<ReturnType<typeof getProjectForActor>>;

function canWrite(actor: SabahActor): boolean {
    return actor.role !== "VIEWER";
}

const projectRefSchema = z.object({ id: z.string().min(1) });

// ---------------------------------------------------------------------------
// projects.search
// ---------------------------------------------------------------------------

const searchInputSchema = z.object({
    query: z.string().trim().max(200).default(""),
    workAreaId: z.string().nullish(),
});

export const projectsSearchCapability = defineCapability({
    name: "projects.search",
    version: 1,
    module: "projects",
    description: "Search the projects visible to the actor by name.",
    risk: "READ",
    inputSchema: searchInputSchema,
    outputSchema: z.array(z.object({ id: z.string(), name: z.string() }).passthrough()),
    async available() {
        return true;
    },
    async authorize() {
        // Reads are open to every actor; visibility is enforced by the command.
    },
    async preview(input) {
        return {
            title: `Search projects${input.query ? ` matching “${input.query}”` : ""}`,
            fields: [{ path: "query", proposed: input.query || "(all)" }],
        };
    },
    async execute(input, context) {
        const projects = await listProjectsForActor(
            { search: input.query || undefined, workAreaId: input.workAreaId ?? undefined },
            context.actor,
        );
        return projects.map((project) => ({ id: project.id, name: project.name, status: project.status }));
    },
    async verify(output) {
        return output;
    },
    summarize(output) {
        return `Found ${output.length} project${output.length === 1 ? "" : "s"}.`;
    },
});

// ---------------------------------------------------------------------------
// projects.get
// ---------------------------------------------------------------------------

export const projectsGetCapability = defineCapability({
    name: "projects.get",
    version: 1,
    module: "projects",
    description: "Read one project with its strategic children.",
    risk: "READ",
    inputSchema: projectRefSchema,
    outputSchema: z.object({ id: z.string() }).passthrough(),
    async available() {
        return true;
    },
    async authorize() {},
    async preview(input) {
        return { title: "Read project details", fields: [{ path: "id", proposed: input.id }] };
    },
    async execute(input, context) {
        const project = await getProjectForActor(input.id, context.actor);
        if (!project) {
            throw Object.assign(new Error("Project not found"), { status: 404, code: "NOT_FOUND" });
        }
        return project as any;
    },
    async verify(output, context) {
        const project = await getProjectForActor(output.id, context.actor);
        if (!project) {
            throw Object.assign(new Error("Project disappeared"), { status: 500, code: "READ_BACK_FAILED" });
        }
        assertProjectionMatches(output, project);
        return project as any;
    },
    summarize(output) {
        return `Read project ${(output as { name?: string }).name ?? output.id}.`;
    },
});

// ---------------------------------------------------------------------------
// projects.create
// ---------------------------------------------------------------------------

type CreateInput = z.input<typeof createProjectSchema>;

const updateInputSchema = updateProjectSchema.and(
    z.object({
        id: z.string().min(1),
        expectedUpdatedAt: z.string().datetime(),
    }),
);
type UpdateInput = z.input<typeof updateInputSchema>;

export function projectCreateItemCount(input: CreateInput): number {
    const values = input as {
        objectives?: unknown[];
        outputs?: unknown[];
        risks?: unknown[];
        stages?: unknown[];
    };
    return (
        (values.objectives?.length ?? 0) +
        (values.outputs?.length ?? 0) +
        (values.risks?.length ?? 0) +
        (values.stages?.length ?? 0)
    );
}

const PROJECT_PREVIEW_SCALARS = [
    "name",
    "description",
    "status",
    "startAt",
    "dueAt",
    "dueAtEnd",
    "ownerId",
    "managerId",
    "responsibleDepartmentId",
    "sponsorId",
    "sponsorStatus",
    "objective",
    "scope",
    "successCriteria",
    "projectType",
    "priority",
    "health",
    "workAreaId",
    "metadata",
] as const;

const PROJECT_CHILD_COLLECTIONS = ["objectives", "outputs", "risks", "stages"] as const;

function previewValue(value: unknown): unknown {
    if (value === null || value === undefined || value === "") {
        return "(unset)";
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return value;
}

function countLabel(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function projectPreviewFields(input: CreateInput): Array<{ path: string; proposed?: unknown }> {
    const parsed = createProjectSchema.parse(input);
    const values = parsed as unknown as Record<string, unknown>;
    return [
        ...PROJECT_PREVIEW_SCALARS.map((path) => ({ path, proposed: previewValue(values[path]) })),
        { path: "memberIds", proposed: countLabel(parsed.memberIds.length, "member") },
        { path: "objectives", proposed: countLabel(parsed.objectives.length, "objective") },
        { path: "outputs", proposed: countLabel(parsed.outputs.length, "output") },
        { path: "risks", proposed: countLabel(parsed.risks.length, "risk") },
        { path: "stages", proposed: countLabel(parsed.stages.length, "stage") },
        { path: "tasks", proposed: "0 tasks" },
    ];
}

function updatePreviewFields(
    input: UpdateInput,
    current: unknown,
): Array<{ path: string; current?: unknown; proposed?: unknown }> {
    const proposedValues = input as unknown as Record<string, unknown>;
    const currentValues = (current ?? {}) as Record<string, unknown>;
    const fields: Array<{ path: string; current?: unknown; proposed?: unknown }> = [];
    for (const path of PROJECT_PREVIEW_SCALARS) {
        if (proposedValues[path] !== undefined) {
            fields.push({
                path,
                current: previewValue(
                    path === "metadata" ? currentValues.metadataJson ?? currentValues.metadata : currentValues[path],
                ),
                proposed: previewValue(proposedValues[path]),
            });
        }
    }
    for (const path of PROJECT_CHILD_COLLECTIONS) {
        if (proposedValues[path] !== undefined) {
            const currentItems = Array.isArray(currentValues[path]) ? currentValues[path] : [];
            const proposedItems = proposedValues[path] as unknown[];
            const singular = path.slice(0, -1);
            fields.push({
                path,
                current: `${countLabel(currentItems.length, singular)} (existing)`,
                proposed: `${countLabel(proposedItems.length, singular)} (replaces existing)`,
            });
        }
    }
    if (proposedValues.memberIds !== undefined) {
        const currentMembers = Array.isArray(currentValues.members)
            ? currentValues.members
            : Array.isArray(currentValues.memberIds)
              ? currentValues.memberIds
              : [];
        fields.push({
            path: "memberIds",
            current: `${countLabel(currentMembers.length, "member")} (existing)`,
            proposed: `${countLabel((proposedValues.memberIds as unknown[]).length, "member")} (replaces existing)`,
        });
    }
    return fields;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function normalizeProjectionValue(value: unknown): unknown {
    if (value === undefined) {
        return null;
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "string" && ISO_DATE_PATTERN.test(value)) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }
    if (Array.isArray(value)) {
        return value.map((item) => normalizeProjectionValue(item));
    }
    if (typeof value === "object" && value !== null) {
        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const child = (value as Record<string, unknown>)[key];
            if (child !== undefined) {
                normalized[key] = normalizeProjectionValue(child);
            }
        }
        return normalized;
    }
    return value;
}

function metadataProjectionValue(project: Record<string, unknown>): unknown {
    const raw = project.metadataJson ?? project.metadata;
    if (typeof raw !== "string") {
        return raw;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function materialProjection(project: unknown): Record<string, unknown> {
    const record = (project ?? {}) as Record<string, unknown>;
    const projection: Record<string, unknown> = { id: record.id };
    for (const path of PROJECT_PREVIEW_SCALARS) {
        projection[path] = path === "metadata" ? metadataProjectionValue(record) : record[path];
    }
    for (const path of PROJECT_CHILD_COLLECTIONS) {
        projection[path] = Array.isArray(record[path]) ? record[path] : [];
    }
    const memberIds = Array.isArray(record.memberIds)
        ? record.memberIds
        : Array.isArray(record.members)
          ? record.members
                .map((member) => {
                    if (typeof member === "string") {
                        return member;
                    }
                    const value = member as Record<string, unknown>;
                    const user = value.user as Record<string, unknown> | undefined;
                    return value.userId ?? user?.id ?? value.id;
                })
                .filter((id): id is string => typeof id === "string")
          : [];
    projection.members = [...memberIds].sort();
    projection.tasks = Array.isArray(record.tasks) ? record.tasks : [];
    return normalizeProjectionValue(projection) as Record<string, unknown>;
}

function throwVerificationMismatch(path: string): never {
    throw Object.assign(new Error(`Project verification mismatch at ${path}`), {
        status: 500,
        code: "VERIFY_FAILED",
    });
}

function assertProjectionMatches(left: unknown, right: unknown): void {
    const first = materialProjection(left);
    const second = materialProjection(right);
    if (JSON.stringify(first) === JSON.stringify(second)) {
        return;
    }
    if (first.id !== second.id) {
        throwVerificationMismatch("id");
    }
    for (const path of PROJECT_PREVIEW_SCALARS) {
        if (JSON.stringify(first[path]) !== JSON.stringify(second[path])) {
            throwVerificationMismatch(path);
        }
    }
    for (const path of PROJECT_CHILD_COLLECTIONS) {
        if (JSON.stringify(first[path]) !== JSON.stringify(second[path])) {
            throwVerificationMismatch(path);
        }
    }
    if (JSON.stringify(first.members) !== JSON.stringify(second.members)) {
        throwVerificationMismatch("members");
    }
    if (JSON.stringify(first.tasks) !== JSON.stringify(second.tasks)) {
        throwVerificationMismatch("tasks");
    }
}

function preserveReversibleMarker(output: unknown, readBack: unknown): unknown {
    const marker = (output as { reversible?: unknown }).reversible;
    return marker === undefined ? readBack : { ...(readBack as object), reversible: marker };
}

export const projectsCreateCapability = defineCapability({
    name: "projects.create",
    version: 1,
    module: "projects",
    description: "Create a strategic project transactionally, including objectives, outputs, risks, and stages.",
    requiresExplicitApproval: true,
    risk: (input: CreateInput) => (projectCreateItemCount(input) > 0 ? "REVERSIBLE_WRITE" : "DRAFT"),
    inputSchema: createProjectSchema,
    outputSchema: z.object({ id: z.string(), reversible: z.literal(false).optional() }).passthrough(),
    async available(actor) {
        return canWrite(actor);
    },
    async authorize(input, context) {
        await assertNoExactDuplicate({ entityType: "PROJECT", ...input, idempotencyKey: context.idempotencyKey }, context.actor, context.duplicateDb ?? createPrismaDuplicateDb());
    },
    async preview(input, context) {
        const baseWarnings = projectCreateItemCount(input) > 0 ? ["Creates child records in one transaction."] : [];
        const injectedDb = context.duplicateDb;
        const projectModel = prisma.project;
        const duplicateDb = injectedDb ?? (typeof projectModel.findMany === "function" ? createPrismaDuplicateDb() : undefined);
        if (!duplicateDb) {
            return { title: `Create project “${input.name}”`, fields: projectPreviewFields(input), warnings: [...baseWarnings, "DUPLICATE_CHECK_UNAVAILABLE: manual duplicate review is required before approval."] };
        }
        const candidates = await findDuplicateCandidates({ entityType: "PROJECT", ...input, idempotencyKey: context.idempotencyKey }, context.actor, duplicateDb);
        const duplicateWarnings = candidates.map((candidate) => `${candidate.overlap === "EXACT" ? "Exact duplicate" : candidate.overlap === "LIKELY_DUPLICATE" ? "Likely duplicate" : candidate.overlap === "RECURRING" ? "Recurring work" : "Related work"}: ${candidate.source.label} — ${candidate.reasons.join("; ")}.`);
        const duplicateChoices = candidates.flatMap((candidate) => candidate.overlap === "RECURRING" || candidate.overlap === "RELATED" ? [] : (["USE_EXISTING", "UPDATE_EXISTING", "LINK", "MERGE", "CREATE_SEPARATELY"] as const).map((action) => ({ action, entityType: candidate.source.entityType as "PROJECT" | "TASK", entityId: candidate.source.entityId, label: candidate.source.label, requiresReason: action === "CREATE_SEPARATELY" })));
        return {
            title: `Create project “${input.name}”`,
            fields: projectPreviewFields(input),
            warnings: [...baseWarnings, ...duplicateWarnings].length ? [...baseWarnings, ...duplicateWarnings] : undefined,
            duplicateChoices: duplicateChoices.length ? duplicateChoices : undefined,
        };
    },
    async execute(input, context) {
        await assertNoExactDuplicate({ entityType: "PROJECT", ...input, idempotencyKey: context.idempotencyKey }, context.actor, context.duplicateDb ?? createPrismaDuplicateDb());
        return { ...(await createProject(input as CreateProjectInput, context.actor)), reversible: false } as any;
    },
    async verify(output, context) {
        const readBack = await getProjectForActor((output as { id: string }).id, context.actor);
        if (!readBack) {
            throw Object.assign(new Error("Project verification failed"), { status: 500, code: "VERIFY_FAILED" });
        }
        assertProjectionMatches(output, readBack);
        return preserveReversibleMarker(output, readBack) as any;
    },
    async compensate() {
        throw new Error("Project creation has no safe compensation; permanent deletion is not supported.");
    },
    summarize(output) {
        return `Created project “${(output as { name?: string }).name ?? (output as { id: string }).id}”.`;
    },
});

// ---------------------------------------------------------------------------
// projects.update
// ---------------------------------------------------------------------------

export const projectsUpdateCapability = defineCapability({
    name: "projects.update",
    version: 1,
    module: "projects",
    description: "Update a strategic project with optimistic concurrency and transactional child replacement.",
    risk: "REVERSIBLE_WRITE",
    inputSchema: updateInputSchema,
    outputSchema: z.object({ id: z.string(), reversible: z.literal(false).optional() }).passthrough(),
    async available(actor) {
        return canWrite(actor);
    },
    async authorize() {},
    async preview(input, context) {
        const current = await getProjectForActor(input.id, context.actor);
        return {
            title: `Update project “${(current as { name?: string } | null)?.name ?? input.id}”`,
            fields: updatePreviewFields(input, current),
            warnings: ["Existing child records are replaced in one transaction."],
        };
    },
    async execute(input, context) {
        const { id, expectedUpdatedAt, ...rest } = input;
        return {
            ...(await updateProject(id, rest as UpdateProjectInput, context.actor, new Date(expectedUpdatedAt))),
            reversible: false,
        } as any;
    },
    async verify(output, context) {
        const readBack = await getProjectForActor((output as { id: string }).id, context.actor);
        if (!readBack) {
            throw Object.assign(new Error("Project disappeared after update"), { status: 500, code: "VERIFY_FAILED" });
        }
        assertProjectionMatches(output, readBack);
        return preserveReversibleMarker(output, readBack) as any;
    },
    async compensate() {
        throw new Error("Project update has no safe compensation; permanent deletion is not supported.");
    },
    summarize(output) {
        return `Updated project ${(output as { name?: string }).name ?? (output as { id: string }).id}.`;
    },
});

// ---------------------------------------------------------------------------
// projects.initializeStages
// ---------------------------------------------------------------------------

const initStagesInputSchema = projectRefSchema.extend({
    stageNames: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});

function stageSeeds(input: z.infer<typeof initStagesInputSchema>): Array<{ name: string; color: string; order: number }> {
    if (input.stageNames) {
        return input.stageNames.map((name, order) => ({
            name,
            color: DEFAULT_PROJECT_STAGES[order]?.color ?? "#64748b",
            order,
        }));
    }
    return DEFAULT_PROJECT_STAGES.map((stage) => ({ ...stage }));
}

type StageProjection = { id?: string; projectId: string; name: string; order: number };

function stageProjection(stages: unknown, projectId: string): StageProjection[] {
    return (Array.isArray(stages) ? stages : []).map((stage) => {
        const value = stage as Record<string, unknown>;
        return { ...(typeof value.id === "string" ? { id: value.id } : {}), projectId, name: String(value.name), order: Number(value.order) };
    });
}

function assertStageProjectionMatches(output: unknown, project: unknown): void {
    const result = output as { projectId?: unknown; created?: unknown; stages?: unknown[] };
    const readBack = project as { id?: unknown; stages?: unknown[] };
    if (result.projectId !== readBack.id) {
        throwVerificationMismatch("projectId");
    }
    const expected = stageProjection(result.stages, String(result.projectId));
    const actual = stageProjection(readBack.stages, String(readBack.id));
    if (result.created !== actual.length) {
        throwVerificationMismatch("created");
    }
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        throwVerificationMismatch("stages");
    }
}

export const projectsInitializeStagesCapability = defineCapability({
    name: "projects.initializeStages",
    version: 1,
    module: "projects",
    description: "Initialize default (or named) stages for a project that has none yet.",
    risk: "REVERSIBLE_WRITE",
    inputSchema: initStagesInputSchema,
    outputSchema: z.object({
        created: z.number(),
        projectId: z.string(),
        stages: z.array(z.object({ id: z.string().optional(), projectId: z.string(), name: z.string(), order: z.number() })),
        reversible: z.literal(false).optional(),
    }),
    async available(actor) {
        return canWrite(actor);
    },
    async authorize() {},
    async preview(input) {
        const names = stageSeeds(input).map((stage) => stage.name);
        return {
            title: "Initialize project stages",
            fields: [{ path: "stages", current: "(none)", proposed: names.join(", ") }],
        };
    },
    async execute(input, context) {
        const result = await prisma.$transaction(
            async (tx) => {
                const project = await tx.project.findUnique({ where: { id: input.id }, select: { id: true } });
                if (!project) {
                    throw Object.assign(new Error("Project not found"), { status: 404, code: "NOT_FOUND" });
                }

                const existing = await tx.projectStage.count({ where: { projectId: input.id } });
                if (existing > 0) {
                    throw Object.assign(new Error("Project already has stages"), { status: 409, code: "STAGES_EXIST" });
                }

                const seeds = stageSeeds(input);
                await tx.projectStage.createMany({
                    data: seeds.map((stage) => ({ ...stage, projectId: input.id })),
                });
                const stages = await tx.projectStage.findMany({
                    where: { projectId: input.id },
                    orderBy: { order: "asc" },
                });
                await tx.auditLog.create({
                    data: {
                        entityType: "project",
                        entityId: input.id,
                        action: "stages_initialized",
                        actorId: context.actor.id,
                        metaJson: JSON.stringify({ stageNames: stages.map((stage) => stage.name) }),
                    },
                });
                return {
                    created: stages.length,
                    projectId: input.id,
                    stages: stageProjection(stages, input.id),
                };
            },
            { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return { ...result, reversible: false as const };
    },
    async verify(output, context) {
        const project = await getProjectForActor(output.projectId, context.actor);
        if (!project) {
            throw Object.assign(new Error("Project disappeared after stage initialization"), {
                status: 500,
                code: "VERIFY_FAILED",
            });
        }
        assertStageProjectionMatches(output, project);
        return output;
    },
    summarize(output) {
        return `Initialized ${output.created} stages.`;
    },
    async compensate() {
        throw new Error("Project stage initialization has no safe compensation; permanent deletion is not supported.");
    },
});

// ---------------------------------------------------------------------------
// projects.generateBrief
// ---------------------------------------------------------------------------

const briefInputSchema = projectRefSchema;

export const projectsGenerateBriefCapability = defineCapability({
    name: "projects.generateBrief",
    version: 1,
    module: "projects",
    description: "Compose an executive brief from a project's strategic fields.",
    risk: "READ",
    inputSchema: briefInputSchema,
    outputSchema: z.object({ projectId: z.string(), summary: z.string() }),
    async available() {
        return true;
    },
    async authorize() {},
    async preview(input) {
        return { title: "Generate project brief", fields: [{ path: "id", proposed: input.id }] };
    },
    async execute(input, context) {
        const project = (await getProjectForActor(input.id, context.actor)) as
            | (ProjectProjection & { objective?: string | null; scope?: string | null; successCriteria?: string | null; stages?: Array<{ name: string; status: string }> })
            | null;
        if (!project) {
            throw Object.assign(new Error("Project not found"), { status: 404, code: "NOT_FOUND" });
        }
        const lines = [
            `Project: ${project.name}`,
            project.objective ? `Objective: ${project.objective}` : null,
            project.scope ? `Scope: ${project.scope}` : null,
            project.successCriteria ? `Success criteria: ${project.successCriteria}` : null,
            project.stages?.length ? `Stages: ${project.stages.map((stage) => `${stage.name} (${stage.status})`).join(", ")}` : null,
        ].filter((line): line is string => line !== null);
        return { projectId: input.id, summary: lines.join("\n") };
    },
    async verify(output) {
        return output;
    },
    summarize(output) {
        return `Generated a brief for project ${output.projectId}.`;
    },
});

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export const PROJECT_CAPABILITIES = [
    projectsSearchCapability,
    projectsGetCapability,
    projectsCreateCapability,
    projectsUpdateCapability,
    projectsInitializeStagesCapability,
    projectsGenerateBriefCapability,
] as const;

export function registerProjectCapabilities(registry: { register: (definition: never) => void }): void {
    for (const capability of PROJECT_CAPABILITIES) {
        (registry.register as (definition: unknown) => void)(capability);
    }
}
