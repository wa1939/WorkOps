import { z } from "zod";

/**
 * Zod input schemas for the strategic Project model (Plan 3 Task 1).
 *
 * These validate API/copilot payloads before they reach Prisma. They mirror
 * the Prisma enums (`ProjectSponsorStatus`, `ProjectHealth`, ...) and the
 * additive child models (objectives, outputs, risks, stages).
 */

export const sponsorStatusSchema = z.enum([
    "NOT_REQUIRED",
    "DRAFT",
    "PENDING",
    "APPROVED",
    "REJECTED",
]);

export const projectHealthSchema = z.enum(["NOT_SET", "ON_TRACK", "AT_RISK", "OFF_TRACK"]);

export const projectObjectiveInputSchema = z.object({
    statement: z.string().trim().min(1).max(5_000),
    measure: z.string().trim().max(1_000).nullish(),
    target: z.string().trim().max(1_000).nullish(),
    kpiId: z.string().cuid().nullish(),
    order: z.number().int().min(0),
});

export const projectOutputInputSchema = z.object({
    title: z.string().trim().min(1).max(1_000),
    description: z.string().trim().max(5_000).nullish(),
    acceptanceCriteria: z.string().trim().max(5_000).nullish(),
    ownerId: z.string().cuid().nullish(),
    dueAt: z.string().datetime().nullish(),
    status: z.enum(["PLANNED", "IN_PROGRESS", "DELIVERED", "ACCEPTED"]).default("PLANNED"),
    order: z.number().int().min(0),
});

export const projectRiskInputSchema = z.object({
    title: z.string().trim().min(1).max(1_000),
    description: z.string().trim().max(5_000).nullish(),
    likelihood: z.number().int().min(1).max(5),
    impact: z.number().int().min(1).max(5),
    mitigation: z.string().trim().max(5_000).nullish(),
    ownerId: z.string().cuid().nullish(),
    status: z.enum(["OPEN", "MITIGATING", "CLOSED"]).default("OPEN"),
});

export const projectStageInputSchema = z.object({
    name: z.string().trim().min(1).max(300),
    order: z.number().int().min(0),
    color: z.string().trim().max(40).nullish(),
    startAt: z.string().datetime().nullish(),
    dueAt: z.string().datetime().nullish(),
    gateCriteria: z.string().trim().max(5_000).nullish(),
    status: z.enum(["PLANNED", "ACTIVE", "COMPLETE", "BLOCKED"]).default("PLANNED"),
});

export const projectMetadataSchema = z
    .object({
        externalReference: z.string().trim().max(500).optional(),
        methodology: z.string().trim().max(2_000).optional(),
        measurementCadence: z.string().trim().max(500).optional(),
    })
    .strict();

export const projectBaseObjectSchema = z.object({
    name: z.string().trim().min(1).max(300),
    description: z.string().trim().max(20_000).nullish(),
    status: z.string().trim().min(1).default("Active"),
    startAt: z.string().datetime().nullish(),
    dueAt: z.string().datetime().nullish(),
    dueAtEnd: z.string().datetime().nullish(),
    ownerId: z.string().cuid().nullish(),
    managerId: z.string().cuid().nullish(),
    responsibleDepartmentId: z.string().cuid().nullish(),
    sponsorId: z.string().cuid().nullish(),
    sponsorStatus: sponsorStatusSchema.default("NOT_REQUIRED"),
    objective: z.string().trim().max(20_000).nullish(),
    scope: z.string().trim().max(20_000).nullish(),
    successCriteria: z.string().trim().max(20_000).nullish(),
    projectType: z.string().trim().max(120).nullish(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
    health: projectHealthSchema.default("NOT_SET"),
    workAreaId: z.string().cuid().nullish(),
    memberIds: z.array(z.string().cuid()).max(100).default([]),
    objectives: z.array(projectObjectiveInputSchema).max(100).default([]),
    outputs: z.array(projectOutputInputSchema).max(100).default([]),
    risks: z.array(projectRiskInputSchema).max(100).default([]),
    stages: z.array(projectStageInputSchema).max(100).default([]),
    metadata: projectMetadataSchema.default({}),
});

/** Structural subset the cross-field validator needs. */
interface ProjectFieldsToValidate {
    startAt?: string | null;
    dueAt?: string | null;
    dueAtEnd?: string | null;
    objectives?: Array<{ order: number }>;
    outputs?: Array<{ order: number }>;
    stages?: Array<{ order: number; startAt?: string | null; dueAt?: string | null }>;
}

function toTime(value: string | null | undefined): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
}

function findDuplicateOrder(items: Array<{ order: number }>): number | null {
    const seen = new Set<number>();
    for (const item of items) {
        if (seen.has(item.order)) {
            return item.order;
        }
        seen.add(item.order);
    }
    return null;
}

export function validateProjectDatesAndOrders(
    project: ProjectFieldsToValidate,
    ctx: z.RefinementCtx,
): void {
    const start = toTime(project.startAt);
    const due = toTime(project.dueAt);
    const dueEnd = toTime(project.dueAtEnd);

    if (start !== null && due !== null && start > due) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dueAt"],
            message: "startAt must be on or before dueAt",
        });
    }

    if (due !== null && dueEnd !== null && due > dueEnd) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["dueAtEnd"],
            message: "dueAt must be on or before dueAtEnd",
        });
    }

    for (const [field, items] of [
        ["objectives", project.objectives],
        ["outputs", project.outputs],
        ["stages", project.stages],
    ] as const) {
        if (!items) {
            continue;
        }
        const duplicate = findDuplicateOrder(items);
        if (duplicate !== null) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [field],
                message: `Duplicate order ${duplicate} in ${field}`,
            });
        }
    }

    const stages = project.stages ?? [];
    for (let index = 0; index < stages.length; index += 1) {
        const stage = stages[index];
        const stageStart = toTime(stage.startAt);
        const stageDue = toTime(stage.dueAt);
        if (stageStart !== null && stageDue !== null && stageStart > stageDue) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["stages", index, "dueAt"],
                message: "stage startAt must be on or before stage dueAt",
            });
        }
    }
}

export const createProjectSchema = projectBaseObjectSchema.superRefine(
    validateProjectDatesAndOrders,
);

export const updateProjectSchema = projectBaseObjectSchema
    .partial()
    .superRefine(validateProjectDatesAndOrders);

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectObjectiveInput = z.infer<typeof projectObjectiveInputSchema>;
export type ProjectOutputInput = z.infer<typeof projectOutputInputSchema>;
export type ProjectRiskInput = z.infer<typeof projectRiskInputSchema>;
export type ProjectStageInput = z.infer<typeof projectStageInputSchema>;
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;
