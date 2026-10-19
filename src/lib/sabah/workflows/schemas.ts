import { z } from "zod";
import { assertCapabilityAllowed } from "../security/hard-boundaries";
import { CREATE_TASK_FIELD_KEYS, type CreateTaskFieldKey } from "@/lib/tasks/schemas";

const CAPABILITY_REGEX = /^[a-z][a-z0-9-]*(\.[a-z][a-zA-Z0-9-]*)+$/;
const UNSAFE_HREF_CHARS = /[\u0000-\u001f\u007f\\]/;
const SCHEME_PREFIX = /^[\/]*(?:[a-z][a-z\d+.-]*:)/i;

/** One URL boundary for workflow results and display-only links. */
export function isSafeWorkflowHref(value: unknown): value is string {
    if (typeof value !== "string" || value.length < 2 || value.length > 256 || UNSAFE_HREF_CHARS.test(value)) return false;
    let decoded = value;
    try {
        decoded = decodeURIComponent(value);
    } catch {
        return false;
    }
    if (UNSAFE_HREF_CHARS.test(decoded)) return false;
    if (decoded.startsWith("/") && !decoded.startsWith("//") && !SCHEME_PREFIX.test(decoded)) return true;
    if (!/^https:\/\//i.test(decoded)) return false;
    try {
        const parsed = new URL(decoded);
        return parsed.protocol === "https:" && parsed.hostname.length > 0;
    } catch {
        return false;
    }
}

/** Same-origin internal href (the first isSafeWorkflowHref branch). Internal
 *  entity links additionally require verified tool-result grounding before
 *  they may be presented as navigation; this predicate only classifies them. */
export function isInternalWorkflowHref(value: unknown, origin?: string): value is string {
    if (!isSafeWorkflowHref(value)) return false;
    let decoded = value;
    try {
        decoded = decodeURIComponent(value);
        if (origin !== undefined) return new URL(value, origin).origin === origin;
        return decoded.startsWith("/") && !decoded.startsWith("//");
    } catch {
        return false;
    }
}

export const workflowEntityLinkSchema = z.object({
    type: z.string().min(1).max(80),
    id: z.string().min(1).max(256),
    href: z.string().max(256).refine(isSafeWorkflowHref, "Unsafe workflow link"),
    label: z.string().min(1).max(256),
});

export const proposedWorkflowStepSchema = z.object({
    clientStepId: z.string().min(1).max(80),
    capability: z.string().regex(CAPABILITY_REGEX),
    version: z.number().int().positive().optional(),
    args: z.record(z.unknown()),
    dependsOn: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
    inferredFields: z.array(z.string()).default([]),
    evidenceRefs: z.array(z.string()).default([]),
}).superRefine((data, context) => {
    try {
        assertCapabilityAllowed(data.capability);
    } catch {
        context.addIssue({ code: z.ZodIssueCode.custom, message: "Capability is blocked by immutable security boundary", path: ["capability"] });
    }
});

export const proposedWorkflowSchema = z
    .object({
        goal: z.string().min(1).max(500),
        steps: z.array(proposedWorkflowStepSchema).min(1),
    })
    .refine((data) => {
        // Check for duplicate client step IDs
        const ids = new Set<string>();
        for (const step of data.steps) {
            if (ids.has(step.clientStepId)) {
                return false;
            }
            ids.add(step.clientStepId);
        }
        return true;
    }, "Duplicate clientStepId found in steps")
    .refine((data) => {
        // Check that all dependencies refer to existing steps
        const idSet = new Set(data.steps.map((s) => s.clientStepId));
        for (const step of data.steps) {
            for (const dep of step.dependsOn) {
                if (!idSet.has(dep)) {
                    return false;
                }
            }
        }
        return true;
    }, "Dependency refers to unknown step")
    .refine((data) => {
        // Check for circular dependencies using topological sort
        const idSet = new Set(data.steps.map((s) => s.clientStepId));
        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        function hasCycle(clientStepId: string): boolean {
            visited.add(clientStepId);
            recursionStack.add(clientStepId);

            const step = data.steps.find((s) => s.clientStepId === clientStepId);
            if (step) {
                for (const dep of step.dependsOn) {
                    if (!visited.has(dep)) {
                        if (hasCycle(dep)) {
                            return true;
                        }
                    } else if (recursionStack.has(dep)) {
                        return true;
                    }
                }
            }

            recursionStack.delete(clientStepId);
            return false;
        }

        for (const step of data.steps) {
            if (!visited.has(step.clientStepId)) {
                if (hasCycle(step.clientStepId)) {
                    return false;
                }
            }
        }
        return true;
    }, "Circular dependency detected in steps");

export const approvalPreviewSchema = z.object({
    id: z.string().cuid(),
    workflowId: z.string().cuid(),
    stepIds: z.array(z.string().cuid()).min(1),
    title: z.string().min(1).max(300),
    summary: z.string().max(4_000),
    risk: z.enum(["REVERSIBLE_WRITE", "BULK_WRITE", "SENSITIVE_WRITE"]),
    fields: z
        .array(
            z.object({
                path: z.string(),
                current: z.unknown().optional(),
                proposed: z.unknown().optional(),
            })
        )
        .max(200),
    warnings: z.array(z.string().max(1_000)).max(50).default([]),
    expiresAt: z.string().datetime(),
});

const workflowApprovalReviewPathSchema = z.enum(
    CREATE_TASK_FIELD_KEYS as [CreateTaskFieldKey, ...CreateTaskFieldKey[]],
);

/**
 * Display-only, server-authored review data for the bounded dashboard task
 * creation flow. It is deliberately not an args projection: only canonical
 * createTaskSchema fields are allowed across this DTO boundary.
 */
export const workflowApprovalReviewSchema = z.object({
    approvalHash: z.string().regex(/^[a-f0-9]{64}$/),
    fields: z.array(z.object({
        path: workflowApprovalReviewPathSchema,
        proposed: z.string().max(20_000),
    })).min(1).max(CREATE_TASK_FIELD_KEYS.length),
});

export const clarificationRequestSchema = z.object({
    id: z.string().cuid(),
    question: z.string().min(1).max(2_000),
    choices: z
        .array(
            z.object({
                id: z.string().min(1).max(80),
                label: z.string().min(1).max(500),
            })
        )
        .max(4)
        .default([]),
    multiSelect: z.boolean().default(false),
    allowFreeText: z.boolean().default(true),
});

export const workflowDecisionSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("APPROVE"),
        approvalId: z.string().cuid(),
        reason: z.string().max(2_000).nullish(),
    }),
    z.object({
        type: z.literal("REJECT"),
        approvalId: z.string().cuid(),
        reason: z.string().min(1).max(2_000),
    }),
    z.object({
        type: z.literal("RENEW"),
        approvalId: z.string().cuid(),
        reason: z.string().max(2_000).nullish(),
    }),
    z.object({
        type: z.literal("CLARIFY"),
        clarificationId: z.string().cuid(),
        choiceIds: z.array(z.string()).max(4),
        freeText: z.string().max(4_000).nullish(),
    }),
    z.object({
        type: z.literal("RESOLVE_DUPLICATE"),
        stepId: z.string().cuid(),
        resolution: z.enum([
            "USE_EXISTING",
            "UPDATE_EXISTING",
            "LINK",
            "MERGE",
            "CREATE_SEPARATELY",
        ]),
        entityType: z.enum(["PROJECT", "TASK"]).nullish(),
        entityId: z.string().cuid().nullish(),
        reason: z.string().max(2_000).nullish(),
    }),
]);

export const workflowSnapshotSchema = z.object({
    id: z.string().min(1),
    goal: z.string().min(1).max(500),
    status: z.enum([
        "PLANNED",
        "AWAITING_APPROVAL",
        "RUNNING",
        "COMPLETED",
        "FAILED",
        "CANCELED",
    ]),
    actorId: z.string().optional(),
    steps: z.array(
        z.object({
            id: z.string().min(1),
            clientStepId: z.string().min(1).max(80),
            capability: z.string(),
            status: z.enum([
                "PENDING",
                "APPROVAL_REQUIRED",
                "RUNNING",
                "VERIFIED",
                "FAILED",
                "BLOCKED",
                "SKIPPED",
            ]),
            dependsOn: z.array(z.string()).default([]),
            confidence: z.number().min(0).max(1),
            previewSummary: z.string().max(500).optional(),
            resultSummary: z.string().max(500).optional(),
            error: z.string().max(1_000).optional(),
            entityLinks: z
                .array(workflowEntityLinkSchema)
                .max(50)
                .default([]),
            startedAt: z.string().datetime().optional(),
            completedAt: z.string().datetime().optional(),
            verifiedAt: z.string().datetime().optional(),
        })
    ),
    approvals: z.array(
        z.object({
            id: z.string().cuid(),
            stepId: z.string().cuid(),
            title: z.string(),
            risk: z.enum(["REVERSIBLE_WRITE", "BULK_WRITE", "SENSITIVE_WRITE"]),
            status: z.enum(["PENDING", "APPROVED", "REJECTED", "EXPIRED"]),
            expiresAt: z.string().datetime(),
            requestedAt: z.string().datetime(),
            decidedAt: z.string().datetime().optional(),
            decisionType: z.enum(["APPROVE", "REJECT"]).optional(),
            reason: z.string().optional(),
            review: workflowApprovalReviewSchema.optional(),
        })
    ),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional(),
    feedbackCaptured: z.boolean().optional(),
    feedbackPending: z.boolean().optional(),
});

export type ProposedWorkflowStep = z.infer<typeof proposedWorkflowStepSchema>;
export type ProposedWorkflow = z.infer<typeof proposedWorkflowSchema>;
export type ApprovalPreview = z.infer<typeof approvalPreviewSchema>;
export type WorkflowApprovalReview = z.infer<typeof workflowApprovalReviewSchema>;
export type ClarificationRequest = z.infer<typeof clarificationRequestSchema>;
export type WorkflowDecision = z.infer<typeof workflowDecisionSchema>;
export type WorkflowSnapshot = z.infer<typeof workflowSnapshotSchema>;
