import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProposedWorkflow, WorkflowApprovalReview, WorkflowDecision, WorkflowSnapshot } from "./schemas";
import {
    proposedWorkflowSchema,
    workflowDecisionSchema,
    workflowEntityLinkSchema,
    workflowApprovalReviewSchema,
    workflowSnapshotSchema,
    isSafeWorkflowHref,
} from "./schemas";
import { runCapability, type RunnerDeps, type CapabilityRequest } from "../capabilities/runner";
import { writeCapabilityAudit, writeActivityEvent } from "../logging/log";
import { SabahForbiddenError } from "../auth/actor";
import { createPrismaDuplicateDb, findDuplicateCandidates, type DuplicateDb } from "../intelligence/duplicates";
import { parseSourceRef } from "../intelligence/indexer";
import { createPrismaGraphDb, type GraphDb } from "../intelligence/graph";
import type { SourceRef } from "../intelligence/contracts";
import { getAuthorizedEntityIds } from "../intelligence/authorized-scope";
import type { FeedbackInput } from "../feedback/contracts";
import { enqueueJob } from "../jobs/queue";
import type { JobDb, QueueJob, JsonValue } from "../jobs/contracts";
import { scanAndRedactSecrets } from "../security/secret-scan";
import type { LifecycleEventBus } from "../events/bus";
import { getSabahFlags } from "../flags";
import { canonicalizeKpiLogUpdate } from "../capabilities/kpi-canonicalizer";
import {
    CREATE_TASK_FIELD_KEYS,
    createTaskSchema,
    type CreateTaskFieldKey,
    type CreateTaskInput,
} from "@/lib/tasks/schemas";

export type WorkflowStepEnqueuer = (input: { type: "WORKFLOW_STEP"; idempotencyKey: string; priority: 1 | 2 | 3 | 4; payload: JsonValue; actorId: string; workflowId: string; stepId: string; maxAttempts: number }) => Promise<QueueJob>;
export async function enqueueWorkflowStep(input: Parameters<WorkflowStepEnqueuer>[0], db?: JobDb, enqueuer?: WorkflowStepEnqueuer): Promise<QueueJob> {
    if (!/^[A-Za-z0-9:_./-]{1,160}$/.test(input.actorId) || !/^[A-Za-z0-9:_./-]{1,160}$/.test(input.workflowId) || !/^[A-Za-z0-9:_./-]{1,160}$/.test(input.stepId) || !/^[A-Za-z0-9:_./-]{1,160}$/.test(input.idempotencyKey)) throw new Error("Invalid workflow queue identity");
    const payload = scanAndRedactSecrets(input.payload).value;
    if (JSON.stringify(payload).length > 50_000) throw new Error("workflow payload exceeds bounds");
    const bounded = { ...input, payload };
    return enqueuer ? enqueuer(bounded) : enqueueJob(db, bounded);
}

type SabahRole = "ADMIN" | "LEAD" | "MEMBER" | "VIEWER";
type WorkflowTransaction = Pick<Prisma.TransactionClient, "aiWorkflow" | "aiWorkflowStep" | "aiApproval" | "aiWorkflowEvent">;

export type SabahActor = {
    id: string;
    role: SabahRole;
    departmentIds: string[];
};
export type WorkflowFeedbackRecorder = (input: FeedbackInput, actor: SabahActor) => Promise<void> | void;

/** Service-level failure with an HTTP-style status (404 unknown resource, 409 state conflict). */
export class WorkflowServiceError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "WorkflowServiceError";
        this.status = status;
    }
}

/** Undo is intentionally unavailable until a durable, authorized reversal handler exists. */
export const workflowUndoLimitation = "UNDONE is unavailable: no durable workflow undo handler exists in this bounded scope.";
export const workflowFeedbackLimitation = "Workflow decisions remain durable when feedback capture fails; feedbackPending marks best-effort capture without automatic replay.";

// Minimal database interface for injection
export type WorkflowDatabase = Pick<
    typeof prisma,
    "aiWorkflow" | "aiWorkflowStep" | "aiApproval" | "aiWorkflowEvent" | "aiConversation"
> & {
    $transaction: <T>(callback: (transaction: WorkflowTransaction) => Promise<T>) => Promise<T>;
};

type ProposeWorkflowInput = ProposedWorkflow & { idempotencyKey?: string; conversationId?: string };

export type ApprovedWorkflowIntentRequest = {
    workflowId: string;
    conversationId: string;
    capability: string;
    input: Record<string, unknown>;
};

function scopedWorkflowKey(actorId: string, clientKey: string): string {
    return crypto.createHash("sha256").update(`workflow:${actorId}:${clientKey}`).digest("hex");
}

function workflowMatchesRequest(workflow: any, request: ProposedWorkflow, conversationId?: string): boolean {
    if (workflow.goal !== request.goal || workflow.steps.length !== request.steps.length || (workflow.conversationId ?? null) !== (conversationId ?? null)) return false;
    const storedByClientId = new Map(workflow.steps.map((step: any) => [step.clientStepId, step]));
    return request.steps.every((step) => {
        const stored: any = storedByClientId.get(step.clientStepId);
        return stored?.clientStepId === step.clientStepId
            && stored.capability === step.capability
            && (stored.capabilityVersion ?? 1) === (step.version ?? 1)
            && stored.argsJson === JSON.stringify(step.args)
            && stored.dependsOnJson === JSON.stringify(step.dependsOn)
            && stored.confidence === step.confidence
            && (stored.inferredFieldsJson ?? null) === (step.inferredFields.length ? JSON.stringify(step.inferredFields) : null)
            && (stored.evidenceRefsJson ?? null) === (step.evidenceRefs.length ? JSON.stringify(step.evidenceRefs) : null);
    });
}

const APPROVAL_BINDING_PATH = "__approval_binding_sha256";
const INLINE_PREVIEW_SUMMARY_MAX = 500;
const INLINE_APPROVAL_TITLE_MAX = 300;
const TASK_CREATE_REVIEW_PATHS = CREATE_TASK_FIELD_KEYS;
const TASK_CREATE_REVIEW_MAX_FIELDS = TASK_CREATE_REVIEW_PATHS.length;
const TASK_CREATE_REVIEW_JSON_MAX = 50_000;
const TASK_CREATE_DESCRIPTION_MAX = 4_000;
const TASK_CREATE_REFERENCE_MAX = 160;
const TASK_CREATE_ID_ARRAY_MAX = 100;
const TASK_CREATE_ID_ARRAY_VALUE_MAX = 160;
const TASK_CREATE_ID_ARRAY_JSON_MAX = 20_000;
const TASK_CREATE_REMINDER_MAX = 100;
const TASK_CREATE_REMINDER_VALUE_MAX = 1_000_000;
type TaskCreateReviewPath = CreateTaskFieldKey;

type InlinePreviewProjection = { title: string; summary: string };

function boundedInlineText(value: unknown, maxLength: number): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return normalized ? normalized.slice(0, maxLength).trim() : undefined;
}

function boundedSafeInlineText(value: unknown, maxLength: number): string | undefined {
    const scanned = scanAndRedactSecrets(value);
    return scanned.redacted ? undefined : boundedInlineText(scanned.value, maxLength);
}

/** Keep inline action text server-bound; never persist raw preview objects. */
function projectInlinePreview(preview: unknown): InlinePreviewProjection | null {
    if (!preview || typeof preview !== "object") return null;
    const candidate = preview as Record<string, unknown>;
    const title = boundedSafeInlineText(candidate.title, INLINE_APPROVAL_TITLE_MAX)
        ?? boundedSafeInlineText(candidate.summary, INLINE_APPROVAL_TITLE_MAX);
    if (!title) return null;
    return {
        title,
        summary: boundedSafeInlineText(candidate.summary, INLINE_PREVIEW_SUMMARY_MAX)
            ?? boundedSafeInlineText(candidate.title, INLINE_PREVIEW_SUMMARY_MAX)
            ?? title,
    };
}

const UNSAFE_REVIEW_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function boundedReviewString(value: unknown, maxLength: number): string | undefined {
    const scanned = scanAndRedactSecrets(value);
    if (scanned.redacted || typeof scanned.value !== "string") return undefined;
    if (scanned.value.length > maxLength || UNSAFE_REVIEW_CHARACTERS.test(scanned.value)) return undefined;
    return scanned.value;
}

function boundedReviewArray(
    value: unknown,
    maxItems: number,
    maxJsonLength: number,
    isValidItem: (item: unknown) => boolean,
): string | undefined {
    const scanned = scanAndRedactSecrets(value);
    if (scanned.redacted || !Array.isArray(scanned.value) || scanned.value.length > maxItems) return undefined;
    if (scanned.value.some((item) => !isValidItem(item))) return undefined;
    try {
        const encoded = JSON.stringify(scanned.value);
        return typeof encoded === "string" && encoded.length <= maxJsonLength ? encoded : undefined;
    } catch {
        return undefined;
    }
}

function boundedTaskCreateApprovalValue(path: TaskCreateReviewPath, value: unknown): string | undefined {
    switch (path) {
        case "title":
            return boundedReviewString(value, INLINE_PREVIEW_SUMMARY_MAX);
        case "description":
            return value === null ? "(unset)" : boundedReviewString(value, TASK_CREATE_DESCRIPTION_MAX);
        case "status":
        case "priority":
            return boundedReviewString(value, 32);
        case "startAt":
        case "dueAt":
        case "dueAtEnd":
            return value === null ? "(unset)" : boundedReviewString(value, 64);
        case "effortHours":
            if (value === null) return "(unset)";
            return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000 ? String(value) : undefined;
        case "isPrivate":
            return typeof value === "boolean" ? String(value) : undefined;
        case "projectId":
        case "caseStudyId":
        case "kpiId":
        case "stageId":
        case "parentTaskId":
        case "idempotencyKey":
        case "recurrenceKey":
            return value === null ? "(unset)" : boundedReviewString(value, TASK_CREATE_REFERENCE_MAX);
        case "assigneeIds":
        case "tagIds":
        case "dependencyIds":
            return boundedReviewArray(
                value,
                TASK_CREATE_ID_ARRAY_MAX,
                TASK_CREATE_ID_ARRAY_JSON_MAX,
                (item) => typeof item === "string"
                    && item.length <= TASK_CREATE_ID_ARRAY_VALUE_MAX
                    && !UNSAFE_REVIEW_CHARACTERS.test(item),
            );
        case "reminders":
            return boundedReviewArray(
                value,
                TASK_CREATE_REMINDER_MAX,
                TASK_CREATE_ID_ARRAY_JSON_MAX,
                (item) => typeof item === "number"
                    && Number.isInteger(item)
                    && item > 0
                    && item <= TASK_CREATE_REMINDER_VALUE_MAX,
            );
        default:
            return undefined;
    }
}

/**
 * Project the canonical parsed tasks.create input, not an arbitrary capability
 * preview object. Every provided canonical field must be representable in the
 * bounded review or the entire approval review is unavailable.
 */
function projectTaskCreateApprovalReview(input: CreateTaskInput, approvalHash: string): WorkflowApprovalReview | null {
    const fields: Array<{ path: TaskCreateReviewPath; proposed: string }> = [];
    for (const path of TASK_CREATE_REVIEW_PATHS) {
        if (!Object.prototype.hasOwnProperty.call(input, path) || input[path] === undefined) continue;
        const proposed = boundedTaskCreateApprovalValue(path, input[path]);
        if (proposed === undefined) return null;
        fields.push({ path, proposed });
    }
    if (!fields.some((field) => field.path === "title") || fields.length > TASK_CREATE_REVIEW_MAX_FIELDS) return null;
    const parsed = workflowApprovalReviewSchema.safeParse({ approvalHash, fields });
    if (!parsed.success) return null;
    try {
        return JSON.stringify(parsed.data).length <= TASK_CREATE_REVIEW_JSON_MAX ? parsed.data : null;
    } catch {
        return null;
    }
}

function storedInlineSummary(value: unknown, key: "title" | "summary"): string | undefined {
    if (typeof value !== "string") return undefined;
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        return boundedInlineText(parsed[key], INLINE_PREVIEW_SUMMARY_MAX);
    } catch {
        return undefined;
    }
}

function storedApprovalReview(value: unknown, approvalHash: string, step: { argsJson?: string }): WorkflowApprovalReview | undefined {
    if (typeof value !== "string") return undefined;
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const review = workflowApprovalReviewSchema.safeParse(parsed?.approvalReview);
        if (!review.success || review.data.approvalHash !== approvalHash) return undefined;
        if (typeof step.argsJson !== "string") return undefined;
        const canonicalArgs = createTaskSchema.safeParse(JSON.parse(step.argsJson));
        if (!canonicalArgs.success) return undefined;
        const expected = projectTaskCreateApprovalReview(canonicalArgs.data, approvalHash);
        if (!expected || JSON.stringify(review.data.fields) !== JSON.stringify(expected.fields)) return undefined;
        return expected;
    } catch {
        return undefined;
    }
}

type WorkflowEntityLink = WorkflowSnapshot["steps"][number]["entityLinks"][number];
export type WorkflowLinkVerifier = Pick<GraphDb, "getCurrentSource">;
const MAX_WORKFLOW_ENTITY_LINKS = 50;
const DEFAULT_WORKFLOW_LINK_VERIFIER: WorkflowLinkVerifier = createPrismaGraphDb();
const EMPTY_SOURCE_UPDATED_AT = new Date(0).toISOString();

function isNotFoundSourceError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "NOT_FOUND";
}

function candidateHasField(candidate: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(candidate, key) && candidate[key] !== undefined;
}

/**
 * Project only links whose current source is visible to the executing actor.
 * The graph verifier supplies the actor-bound read/canonical-source boundary;
 * this helper only handles the workflow projection and its persistence bound.
 */
async function projectVerifiedEntityLinks(
    output: unknown,
    actor: SabahActor,
    linkVerifier: WorkflowLinkVerifier,
): Promise<WorkflowEntityLink[]> {
    if (!output || typeof output !== "object" || Array.isArray(output)) return [];
    const entityLinks = (output as Record<string, unknown>).entityLinks;
    if (!Array.isArray(entityLinks)) return [];

    const projected: WorkflowEntityLink[] = [];
    const seen = new Set<string>();
    for (const candidate of entityLinks) {
        if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
        const raw = candidate as Record<string, unknown>;
        if (typeof raw.entityType === "string" && typeof raw.type === "string" && raw.entityType !== raw.type) continue;
        if (typeof raw.entityId === "string" && typeof raw.id === "string" && raw.entityId !== raw.id) continue;

        const source = parseSourceRef(raw);
        // Apply the same decode-aware URL boundary used by snapshot/UI reads
        // before any bounded projection is selected. This prevents unsafe
        // encoded entries from displacing valid links after the 50-link cap.
        if (!source || !isSafeWorkflowHref(source.href)) continue;

        const verificationRef: SourceRef = {
            ...source,
            sourceUpdatedAt: candidateHasField(raw, "sourceUpdatedAt") ? source.sourceUpdatedAt : EMPTY_SOURCE_UPDATED_AT,
            checksum: candidateHasField(raw, "checksum") ? source.checksum : "workflow-link",
        };
        let current: SourceRef | null;
        try {
            current = await linkVerifier.getCurrentSource(verificationRef, actor);
        } catch (error) {
            if (isNotFoundSourceError(error)) continue;
            throw error;
        }
        if (!current) continue;

        const verified = parseSourceRef(current as unknown as Record<string, unknown>);
        if (!verified || !isSafeWorkflowHref(verified.href)) continue;
        if (verified.entityType !== source.entityType || verified.entityId !== source.entityId || verified.href !== source.href) continue;
        if (candidateHasField(raw, "sourceUpdatedAt") && verified.sourceUpdatedAt !== source.sourceUpdatedAt) continue;
        if (candidateHasField(raw, "checksum") && verified.checksum !== source.checksum) continue;

        const key = `${verified.entityType}:${verified.entityId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        projected.push({ type: verified.entityType, id: verified.entityId, href: verified.href, label: verified.label });
        if (projected.length >= MAX_WORKFLOW_ENTITY_LINKS) break;
    }
    return projected;
}

/** Read only the persisted display projection; legacy summaries remain compatible. */
function storedEntityLinks(value: unknown): WorkflowEntityLink[] {
    if (typeof value !== "string") return [];
    try {
        const parsed = JSON.parse(value) as Record<string, unknown>;
        const entityLinks = parsed && !Array.isArray(parsed) ? parsed.entityLinks : undefined;
        if (!Array.isArray(entityLinks)) return [];
        return entityLinks
            .map((candidate) => workflowEntityLinkSchema.safeParse(candidate))
            .filter((result): result is { success: true; data: WorkflowEntityLink } => result.success)
            .map((result) => result.data)
            .slice(0, MAX_WORKFLOW_ENTITY_LINKS);
    } catch {
        return [];
    }
}

function approvalBinding(step: { capability: string; capabilityVersion?: number | null; argsJson: string }, risk: string): string {
    return crypto.createHash("sha256").update(JSON.stringify({
        capability: step.capability,
        version: step.capabilityVersion ?? 1,
        argsJson: step.argsJson,
        risk,
    })).digest("hex");
}
function storedApprovalBinding(fieldsJson: string | null | undefined): string | null {
    if (!fieldsJson) return null;
    try {
        const fields = JSON.parse(fieldsJson);
        const marker = Array.isArray(fields) ? fields.find((field) => field?.path === APPROVAL_BINDING_PATH) : null;
        return typeof marker?.proposed === "string" ? marker.proposed : null;
    } catch {
        return null;
    }
}

function workflowStepMatchesRequest(step: any, request: ApprovedWorkflowIntentRequest): boolean {
    if (step.argsJson === JSON.stringify(request.input)) return true;
    if (request.capability !== "kpis.logUpdate") return false;
    try {
        // Direct chat does not have the proposal's optimistic-concurrency
        // token. Compare the shared canonical material input, then execute the
        // persisted step so its captured token remains approval-bound.
        const stored = canonicalizeKpiLogUpdate(JSON.parse(step.argsJson));
        if (typeof stored.expectedUpdatedAt !== "string") return false;
        const requested = canonicalizeKpiLogUpdate(request.input,
            request.input.expectedUpdatedAt === undefined ? stored.expectedUpdatedAt : undefined);
        return JSON.stringify(stored) === JSON.stringify(requested);
    } catch {
        return false;
    }
}

// Helper: compute deterministic idempotency key from workflow + step info
function computeStepIdempotencyKey(
    workflowKey: string,
    clientStepId: string,
    capability: string,
    version: number | undefined,
    args: unknown
): string {
    const argsHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(args))
        .digest("hex")
        .slice(0, 16);
    return `${workflowKey}:${clientStepId}:${capability}:${version ?? 1}:${argsHash}`;
}

// Helper: topological sort with cycle detection
function topologicalOrder(steps: ProposedWorkflow["steps"]): string[] {
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();

    // Initialize
    for (const step of steps) {
        inDegree.set(step.clientStepId, 0);
    }

    // Build graph
    for (const step of steps) {
        for (const dep of step.dependsOn) {
            dependents.set(dep, [...(dependents.get(dep) ?? []), step.clientStepId]);
            inDegree.set(step.clientStepId, (inDegree.get(step.clientStepId) ?? 0) + 1);
        }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    const result: string[] = [];

    inDegree.forEach((degree, id) => {
        if (degree === 0) queue.push(id);
    });

    while (queue.length > 0) {
        const id = queue.shift()!;
        result.push(id);

        for (const depId of dependents.get(id) ?? []) {
            inDegree.set(depId, inDegree.get(depId)! - 1);
            if (inDegree.get(depId) === 0) queue.push(depId);
        }
    }

    if (result.length !== steps.length) {
        throw new Error("Circular dependency detected in workflow steps");
    }

    return result;
}

// A RUNNING step older than this is treated as abandoned by a crashed worker
// and reclaimed on the next execution attempt. Live executions refresh
// startedAt every STEP_HEARTBEAT_MS, so only dead workers cross the threshold.
const STALE_RUNNING_CLAIM_MS = 10 * 60 * 1000;
const STEP_HEARTBEAT_MS = 2 * 60 * 1000;

// Helper: check if actor can execute workflow operations
function canExecuteWorkflow(actor: SabahActor): boolean {
    return actor.role === "ADMIN" || actor.role === "LEAD" || actor.role === "MEMBER";
}

// Helper: find first PENDING step whose dependencies are VERIFIED
function findNextRunnableStep(
    steps: { clientStepId: string; status: string; dependsOn: string[] }[]
): string | null {
    // Map client step IDs to their status
    const statusMap = new Map(steps.map((s) => [s.clientStepId, s.status]));

    for (const step of steps) {
        if (step.status !== "PENDING") continue;

        // Check if all dependencies are VERIFIED
        const depsVerified = step.dependsOn.every((depId) => {
            const depStatus = statusMap.get(depId);
            return depStatus === "VERIFIED";
        });

        if (depsVerified) {
            return step.clientStepId;
        }
    }

    return null;
}

// Helper: mark dependent steps as BLOCKED
function markDependentsBlocked(
    clientStepId: string,
    steps: { clientStepId: string; status: string; dependsOn: string[] }[]
): string[] {
    return steps
        .filter((s) => s.dependsOn.includes(clientStepId) && s.status === "PENDING")
        .map((s) => s.clientStepId);
}

async function captureWorkflowFeedback(recorder: WorkflowFeedbackRecorder | undefined, input: FeedbackInput, actor: SabahActor): Promise<boolean> {
    if (!recorder) return false;
    try { await recorder(input, actor); return true; } catch { return false; }
}
async function emitLifecycle(bus: LifecycleEventBus | undefined, input: Parameters<LifecycleEventBus["publish"]>[0]): Promise<void> {
    if (bus) await bus.publish(input).catch(() => undefined);
}

function canAccessWorkflow(actor: SabahActor, workflow: { actorId: string | null }): boolean {
    return actor.role === "ADMIN" || workflow.actorId === actor.id;
}

/**
 * Re-establish approval authority after the step claim and immediately before
 * the capability call. The read is inside the claim transaction and the
 * no-op update is a CAS over every security-relevant approval field.
 */
async function revalidateApprovedExecution(
    transaction: any,
    workflowId: string,
    expectedWorkflow: any,
    expectedStep: any,
    expectedConversationId: string | null,
    actor: SabahActor,
    now: () => Date,
): Promise<boolean> {
    const freshWorkflow = await transaction.aiWorkflow.findUnique({
        where: { id: workflowId },
        include: {
            steps: { orderBy: { createdAt: "asc" } },
            approvals: true,
        },
    });
    if (!freshWorkflow || freshWorkflow.id !== workflowId || !canAccessWorkflow(actor, freshWorkflow)) {
        throw new SabahForbiddenError();
    }
    if ((freshWorkflow.conversationId ?? null) !== expectedConversationId || (freshWorkflow.conversationId ?? null) !== (expectedWorkflow.conversationId ?? null)) {
        throw new WorkflowServiceError("Workflow conversation binding changed", 409);
    }
    if (["COMPLETED", "FAILED", "CANCELED"].includes(freshWorkflow.status)) {
        throw new WorkflowServiceError("Workflow is no longer active", 409);
    }

    const freshStep = freshWorkflow.steps.find((candidate: any) => candidate.id === expectedStep.id);
    if (!freshStep || freshStep.workflowId !== workflowId || freshStep.capability !== expectedStep.capability || freshStep.argsJson !== expectedStep.argsJson) {
        throw new WorkflowServiceError("Workflow step binding changed", 409);
    }

    const approval = freshWorkflow.approvals.find((candidate: any) => candidate.workflowId === workflowId && candidate.stepId === freshStep.id && candidate.status === "APPROVED");
    const malformedApproval = freshWorkflow.approvals.some((candidate: any) => candidate.status === "APPROVED" && !candidate.stepId);
    if (malformedApproval) throw new WorkflowServiceError("The workflow approval step binding is invalid", 409);
    if (!approval) return false;
    const checkedAt = now();
    const expiresAt = new Date(approval.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= checkedAt.getTime()) {
        throw new WorkflowServiceError("The workflow approval has expired", 409);
    }
    if (!approval.requestedById || approval.requestedById !== freshWorkflow.actorId) {
        throw new WorkflowServiceError("The workflow approval actor binding is invalid", 409);
    }
    const binding = storedApprovalBinding(approval.fieldsJson);
    if (!binding || binding !== approvalBinding(freshStep, approval.risk)) {
        throw new WorkflowServiceError("The workflow approval binding is invalid", 409);
    }
    if (freshStep.capability === "tasks.create" && !storedApprovalReview(freshStep.previewJson, binding, freshStep)) {
        throw new WorkflowServiceError("Exact server-authored approval review is unavailable", 409);
    }

    const claimedApproval = await transaction.aiApproval.updateMany({
        where: {
            id: approval.id,
            workflowId,
            stepId: freshStep.id,
            status: "APPROVED",
            expiresAt: { gt: checkedAt },
            requestedById: freshWorkflow.actorId,
            fieldsJson: approval.fieldsJson,
        },
        data: { decisionReason: approval.decisionReason ?? null },
    });
    if (claimedApproval.count !== 1) throw new WorkflowServiceError("The workflow approval changed before execution", 409);
    return true;
}

function isUniqueConstraintError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Resolve a direct-chat write to an already approved workflow step.
 *
 * The workflow ID is only a lookup reference. Authorization is re-established
 * from persisted actor/conversation ownership, exact capability arguments, an
 * unexpired APPROVED row, and the same approval binding used by decide().
 */
export async function assertApprovedWorkflowIntent(
    actor: SabahActor,
    request: ApprovedWorkflowIntentRequest,
    db: WorkflowDatabase = prisma,
): Promise<{ workflowId: string; stepId: string }> {
    if (!canExecuteWorkflow(actor)) throw new SabahForbiddenError();
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(request.workflowId) || !/^[A-Za-z0-9_-]{1,128}$/.test(request.conversationId)) {
        throw new SabahForbiddenError();
    }

    const workflow = await db.aiWorkflow.findUnique({
        where: { id: request.workflowId },
        include: {
            steps: { orderBy: { createdAt: "asc" } },
            approvals: true,
        },
    });
    if (!workflow || workflow.actorId !== actor.id || workflow.conversationId !== request.conversationId) {
        throw new SabahForbiddenError();
    }
    if (!["RUNNING", "AWAITING_APPROVAL", "COMPLETED"].includes(workflow.status)) {
        throw new WorkflowServiceError("Approved workflow intent is no longer active", 409);
    }

    const step = workflow.steps.find((candidate: any) =>
        candidate.capability === request.capability && workflowStepMatchesRequest(candidate, request));
    if (!step) throw new SabahForbiddenError();

    const approval = workflow.approvals.find((candidate: any) => candidate.stepId === step.id && candidate.status === "APPROVED");
    const expiresAt = approval ? new Date(approval.expiresAt).getTime() : Number.NaN;
    if (!approval || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        throw new WorkflowServiceError("The direct write requires an unexpired workflow approval", 409);
    }
    const binding = storedApprovalBinding(approval.fieldsJson);
    if (!binding || binding !== approvalBinding(step, approval.risk)) {
        throw new WorkflowServiceError("Approved workflow intent no longer matches the proposed operation", 409);
    }
    if (step.capability === "tasks.create" && !storedApprovalReview(step.previewJson, binding, step)) {
        throw new WorkflowServiceError("Exact server-authored approval review is unavailable", 409);
    }

    return { workflowId: workflow.id, stepId: step.id };
}

/**
 * Propose a new workflow or return existing one if idempotent.
 *
 * Validates proposedWorkflowSchema, persists AiWorkflow PLANNED + steps PENDING,
 * creates AiApproval PENDING for any steps requiring approval, and emits events.
 * Idempotent via idempotencyKey unique constraint.
 */
export async function proposeWorkflow(
    actor: SabahActor,
    input: ProposeWorkflowInput,
    db: WorkflowDatabase = prisma,
    runnerDeps?: RunnerDeps
): Promise<WorkflowSnapshot> {
    if (!canExecuteWorkflow(actor)) {
        throw new SabahForbiddenError();
    }

    // A plan is durable operational state. Do not let chat or the workflow
    // route create it while the release gate has writes disabled. Tests and
    // controlled callers may inject the same governed flag through runnerDeps.
    if (!(runnerDeps?.flags?.writes ?? getSabahFlags().writes)) {
        throw new WorkflowServiceError("Workflow persistence is disabled while SABAH_WRITES_ENABLED is false", 503);
    }

    // Validate input schema
    const validated = proposedWorkflowSchema.parse(input);
    if (input.conversationId) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.conversationId)) throw new SabahForbiddenError();
        const conversation = await db.aiConversation.findUnique({ where: { id: input.conversationId }, select: { userId: true } });
        if (!conversation || conversation.userId !== actor.id) throw new SabahForbiddenError();
    }

    const workflowKey = input.idempotencyKey
        ? scopedWorkflowKey(actor.id, input.idempotencyKey)
        : crypto.randomUUID();

    // Check idempotency - return existing only when the same actor's request matches.
    if (input.idempotencyKey) {
        const existing = await db.aiWorkflow.findUnique({
            where: { idempotencyKey: workflowKey },
            include: {
                steps: {
                    orderBy: { createdAt: "asc" },
                },
                approvals: true,
            },
        });

        if (existing) {
            if (!workflowMatchesRequest(existing, validated, input.conversationId)) throw new WorkflowServiceError("Idempotency key was already used for a different workflow request", 409);
            return mapToSnapshot(existing);
        }
    }

    // Topological sort for step ordering
    const sortedStepIds = topologicalOrder(validated.steps);

    const createWorkflow = () => db.$transaction(async (transaction) => {
        const workflow = await transaction.aiWorkflow.create({
            data: {
                goal: validated.goal,
                status: "PLANNED",
                idempotencyKey: workflowKey,
                actorId: actor.id,
                conversationId: input.conversationId,
                recordVersion: 1,
            },
        });

        const createdSteps = [];
        for (const step of validated.steps) {
            computeStepIdempotencyKey(workflowKey, step.clientStepId, step.capability, step.version, step.args);
            const createdStep = await transaction.aiWorkflowStep.create({
                data: {
                    workflowId: workflow.id,
                    clientStepId: step.clientStepId,
                    capability: step.capability,
                    capabilityVersion: step.version,
                    status: "PENDING",
                    argsJson: JSON.stringify(step.args),
                    dependsOnJson: JSON.stringify(step.dependsOn),
                    confidence: step.confidence,
                    inferredFieldsJson: step.inferredFields.length ? JSON.stringify(step.inferredFields) : null,
                    evidenceRefsJson: step.evidenceRefs.length ? JSON.stringify(step.evidenceRefs) : null,
                },
            });
            createdSteps.push(createdStep);
        }

        await transaction.aiWorkflowEvent.create({
            data: {
                workflowId: workflow.id,
                eventType: "WORKFLOW_CREATED",
                level: "INFO",
                message: `Workflow proposed: ${validated.goal}`,
            },
        });
        return { workflow, createdSteps };
    });
    let created: Awaited<ReturnType<typeof createWorkflow>>;
    try {
        created = await createWorkflow();
    } catch (error) {
        if (!input.idempotencyKey || !isUniqueConstraintError(error)) throw error;
        const existing = await db.aiWorkflow.findUnique({
            where: { idempotencyKey: workflowKey },
            include: { steps: { orderBy: { createdAt: "asc" } }, approvals: true },
        });
        if (!existing) throw error;
        if (!workflowMatchesRequest(existing, validated, input.conversationId)) throw new WorkflowServiceError("Idempotency key was already used for a different workflow request", 409);
        return mapToSnapshot(existing);
    }
    const { workflow, createdSteps } = created;
    await emitLifecycle(runnerDeps?.eventBus, { name: "workflow.planned", correlationId: workflow.id, actorId: actor.id, entityRefs: [], payload: { workflowId: workflow.id, stepCount: createdSteps.length } });

    return mapToSnapshot({
        ...workflow,
        steps: createdSteps,
        approvals: [],
    });
}

/**
 * Record a workflow decision (APPROVE/REJECT/RENEW/CLARIFY/RESOLVE_DUPLICATE).
 *
 * APPROVE marks approval and allows execution.
 * REJECT marks approval REJECTED and workflow CANCELED.
 * RENEW atomically expires an expired APPROVED gate and creates a fresh
 * PENDING gate without granting execution authority.
 */
export async function decide(
    actor: SabahActor,
    workflowId: string,
    decision: WorkflowDecision,
    db: WorkflowDatabase = prisma,
    duplicateDb: DuplicateDb = createPrismaDuplicateDb(),
    feedbackRecorder?: WorkflowFeedbackRecorder,
    eventBus?: LifecycleEventBus,
): Promise<WorkflowSnapshot> {
    if (!canExecuteWorkflow(actor)) {
        throw new SabahForbiddenError();
    }

    const validated = workflowDecisionSchema.parse(decision);

    // Fetch workflow for authorization
    const workflow = await db.aiWorkflow.findUnique({
        where: { id: workflowId },
        include: {
            steps: {
                orderBy: { createdAt: "asc" },
            },
            approvals: true,
        },
    });

    if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Actor can only decide on workflows they can access (same actor or member of same departments)
    // For now, require same actor for simplicity
    if (workflow.actorId !== actor.id && actor.role !== "ADMIN") {
        throw new SabahForbiddenError();
    }

    if (validated.type === "RENEW") {
        const approvalRow = workflow.approvals.find((candidate) => candidate.id === validated.approvalId);
        if (!approvalRow) {
            throw new WorkflowServiceError(`Approval not found for workflow: ${validated.approvalId}`, 404);
        }
        if (["CANCELED", "FAILED", "COMPLETED"].includes(workflow.status)) {
            throw new WorkflowServiceError("Workflow is no longer active", 409);
        }
        const step = workflow.steps.find((candidate) => candidate.id === approvalRow.stepId);
        if (!step || step.workflowId !== workflowId || !workflow.actorId || approvalRow.requestedById !== workflow.actorId) {
            throw new WorkflowServiceError("The workflow approval actor or step binding is invalid", 409);
        }
        if (approvalRow.status !== "APPROVED") {
            throw new WorkflowServiceError("Only an expired approved workflow approval can be renewed", 409);
        }
        const renewedAt = new Date();
        const expiresAt = new Date(approvalRow.expiresAt).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt > renewedAt.getTime()) {
            throw new WorkflowServiceError("Only an expired approved workflow approval can be renewed", 409);
        }
        const binding = storedApprovalBinding(approvalRow.fieldsJson);
        if (!binding || binding !== approvalBinding(step, approvalRow.risk)) {
            throw new WorkflowServiceError("Approval no longer matches the proposed operation", 409);
        }

        const renewed = await db.$transaction(async (transaction) => {
            const expired = await transaction.aiApproval.updateMany({
                where: {
                    id: approvalRow.id,
                    workflowId,
                    stepId: step.id,
                    status: "APPROVED",
                    expiresAt: { lte: renewedAt },
                    requestedById: workflow.actorId,
                    fieldsJson: approvalRow.fieldsJson,
                },
                data: { status: "EXPIRED" },
            });
            if (expired.count !== 1) {
                throw new WorkflowServiceError("Approval is no longer an expired approved approval", 409);
            }

            const paused = await transaction.aiWorkflowStep.updateMany({
                where: {
                    id: step.id,
                    workflowId,
                    status: "PENDING",
                    capability: step.capability,
                    argsJson: step.argsJson,
                },
                data: { status: "APPROVAL_REQUIRED", startedAt: null, completedAt: null },
            });
            if (paused.count !== 1) {
                throw new WorkflowServiceError("Workflow step is no longer renewable", 409);
            }

            const awaiting = await transaction.aiWorkflow.updateMany({
                where: {
                    id: workflowId,
                    actorId: workflow.actorId,
                    conversationId: workflow.conversationId,
                    status: { in: ["PLANNED", "RUNNING", "AWAITING_APPROVAL"] },
                },
                data: { status: "AWAITING_APPROVAL" },
            });
            if (awaiting.count !== 1) {
                throw new WorkflowServiceError("Workflow is no longer active", 409);
            }

            const freshApproval = await transaction.aiApproval.create({
                data: {
                    workflowId,
                    stepId: step.id,
                    status: "PENDING",
                    title: approvalRow.title,
                    summary: approvalRow.summary,
                    risk: approvalRow.risk,
                    fieldsJson: approvalRow.fieldsJson,
                    warningsJson: approvalRow.warningsJson,
                    expiresAt: new Date(renewedAt.getTime() + 24 * 60 * 60 * 1000),
                    requestedById: workflow.actorId,
                },
            });
            await transaction.aiWorkflowEvent.create({
                data: {
                    workflowId,
                    stepId: step.id,
                    eventType: "APPROVAL_RENEWED",
                    level: "INFO",
                    message: `Approval renewed: ${approvalRow.id}`,
                    metadataJson: JSON.stringify({ oldApprovalId: approvalRow.id, newApprovalId: freshApproval.id, actorId: actor.id, conversationId: workflow.conversationId ?? null, reason: validated.reason ?? undefined }),
                },
            });
            return transaction.aiWorkflow.findUnique({
                where: { id: workflowId },
                include: { steps: { orderBy: { createdAt: "asc" } }, approvals: true },
            });
        });
        return mapToSnapshot(renewed!);
    }

    if (validated.type === "REJECT") {
        const decidedAt = new Date();
        // Cancel the workflow, mark the referenced approval REJECTED (best effort:
        // rejection stays durable even when the approval no longer exists), and
        // record the cancellation event in one atomic transaction.
        const updated = await db.$transaction(async (transaction) => {
            const canceled = await transaction.aiWorkflow.updateMany({
                where: { id: workflowId, status: { in: ["PLANNED", "RUNNING", "AWAITING_APPROVAL"] } },
                data: { status: "CANCELED", completedAt: decidedAt, recordVersion: { increment: 1 } },
            });
            if (canceled.count !== 1) {
                throw new WorkflowServiceError("Workflow is no longer active", 409);
            }
            await transaction.aiApproval.updateMany({
                where: { id: validated.approvalId, workflowId, status: "PENDING" },
                data: {
                    status: "REJECTED",
                    decidedById: actor.id,
                    decidedAt,
                    decisionType: "REJECT",
                    decisionReason: validated.reason,
                },
            });
            await transaction.aiWorkflowEvent.create({
                data: {
                    workflowId,
                    eventType: "WORKFLOW_CANCELED",
                    level: "INFO",
                    message: `Workflow rejected: ${validated.reason}`,
                    metadataJson: JSON.stringify({ reason: validated.reason ?? undefined, approvalId: validated.approvalId }),
                },
            });
            return transaction.aiWorkflow.findUnique({
                where: { id: workflowId },
                include: {
                    steps: { orderBy: { createdAt: "asc" } },
                    approvals: true,
                },
            });
        });

        const feedbackCaptured = await captureWorkflowFeedback(feedbackRecorder, { source: { kind: "WORKFLOW", id: workflowId, workflowId }, outcome: "REJECTED", reason: validated.reason ?? undefined, context: { workflow: workflowId } }, actor);
        return { ...mapToSnapshot(updated!), ...(feedbackRecorder ? { feedbackCaptured, feedbackPending: !feedbackCaptured } : {}) };
    }

    if (validated.type === "APPROVE") {
        // The approval must belong to this workflow. Its own stepId (an
        // AiWorkflowStep id, possibly null) is the only FK-safe event stepId —
        // the approval id itself must never be written to AiWorkflowEvent.stepId.
        const approvalRow = workflow.approvals.find((candidate) => candidate.id === validated.approvalId);
        if (!approvalRow) {
            throw new WorkflowServiceError(`Approval not found for workflow: ${validated.approvalId}`, 404);
        }
        const boundHash = storedApprovalBinding(approvalRow.fieldsJson);
        const boundStep = workflow.steps.find((candidate) => candidate.id === approvalRow.stepId);
        if (boundHash) {
            if (!boundStep || approvalBinding(boundStep, approvalRow.risk) !== boundHash) {
                throw new WorkflowServiceError("Approval no longer matches the proposed operation", 409);
            }
        }
        if (boundStep?.capability === "tasks.create" && (!boundHash || !storedApprovalReview(boundStep.previewJson, boundHash, boundStep))) {
            throw new WorkflowServiceError("Exact server-authored approval review is unavailable", 409);
        }

        // A stale approval card must never resurrect a stopped or finished
        // workflow; terminal workflows stay terminal.
        if (workflow.status === "CANCELED" || workflow.status === "FAILED" || workflow.status === "COMPLETED") {
            throw new WorkflowServiceError("Workflow is no longer active", 409);
        }

        const decidedAt = new Date();
        // Guarded compare-and-swap plus event write in one atomic transaction so
        // a failed event never leaves an orphaned APPROVED row.
        const updated = await db.$transaction(async (transaction) => {
            const granted = await transaction.aiApproval.updateMany({
                where: {
                    id: validated.approvalId,
                    workflowId,
                    status: "PENDING",
                    expiresAt: { gt: decidedAt },
                },
                data: {
                    status: "APPROVED",
                    decidedById: actor.id,
                    decidedAt,
                    decisionType: "APPROVE",
                    decisionReason: validated.reason,
                },
            });
            if (granted.count !== 1) {
                throw new WorkflowServiceError("Approval is no longer pending or has expired", 409);
            }

            await transaction.aiWorkflowEvent.create({
                data: {
                    workflowId,
                    eventType: "APPROVAL_GRANTED",
                    level: "INFO",
                    message: `Approval granted: ${validated.approvalId}`,
                    stepId: approvalRow.stepId ?? null,
                    metadataJson: JSON.stringify({ approvalId: validated.approvalId }),
                },
            });

            // Resume the paused step and workflow so the approved operation can
            // actually run: findNextRunnableStep selects only PENDING steps, and
            // executeNextStep marks the request approved for granted steps.
            if (approvalRow.stepId) {
                await transaction.aiWorkflowStep.updateMany({
                    where: { id: approvalRow.stepId, workflowId, status: "APPROVAL_REQUIRED" },
                    data: { status: "PENDING", completedAt: null },
                });
            }
            // Conditional so a concurrent stop/completion wins the race and the
            // whole decision rolls back instead of resurrecting the workflow.
            const resumed = await transaction.aiWorkflow.updateMany({
                where: { id: workflowId, status: { in: ["PLANNED", "RUNNING", "AWAITING_APPROVAL"] } },
                data: { status: "RUNNING" },
            });
            if (resumed.count !== 1) {
                throw new WorkflowServiceError("Workflow is no longer active", 409);
            }

            return transaction.aiWorkflow.findUnique({
                where: { id: workflowId },
                include: {
                    steps: { orderBy: { createdAt: "asc" } },
                    approvals: true,
                },
            });
        });

        const feedbackCaptured = await captureWorkflowFeedback(feedbackRecorder, { source: { kind: "WORKFLOW", id: workflowId, workflowId }, outcome: "ACCEPTED", reason: validated.reason ?? undefined, context: { workflow: workflowId } }, actor);
        return { ...mapToSnapshot(updated!), ...(feedbackRecorder ? { feedbackCaptured, feedbackPending: !feedbackCaptured } : {}) };
    }

    if (validated.type === "RESOLVE_DUPLICATE") {
        const step = workflow.steps.find((candidate) => candidate.id === validated.stepId);
        if (!step) throw new Error("Workflow step not found");
        if (validated.resolution === "CREATE_SEPARATELY" && !validated.reason?.trim()) throw new Error("A reason is required when creating separately");
        let parsedArgs: unknown;
        try {
            parsedArgs = JSON.parse(step.argsJson || "{}");
        } catch {
            throw new Error("Duplicate draft is invalid");
        }
        if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) throw new Error("Duplicate draft is invalid");
        const args = parsedArgs as Record<string, unknown>;
        const inferredType = args.entityType === "PROJECT" || args.entityType === "TASK" ? args.entityType : step.capability.toLowerCase().includes("project") ? "PROJECT" : step.capability.toLowerCase().includes("task") ? "TASK" : undefined;
        if (inferredType && validated.entityType && validated.entityType !== inferredType) throw new Error("Duplicate candidate type does not match the workflow step");
        const entityType = validated.entityType ?? inferredType;
        if (!entityType || !validated.entityId) throw new Error("A typed duplicate candidate is required");
        const metadata = { resolution: validated.resolution, entityType: entityType ?? null, entityId: validated.entityId ?? null, reason: validated.reason?.trim().slice(0, 2_000) ?? null };
        const prior = await db.aiWorkflowEvent.findFirst({ where: { workflowId, stepId: step.id, eventType: "DUPLICATE_RESOLUTION" }, orderBy: { createdAt: "asc" } });
        if (prior) {
            let priorMetadata: unknown = null; try { priorMetadata = JSON.parse(prior.metadataJson ?? "null"); } catch { /* malformed prior event is a conflict */ }
            if (JSON.stringify(priorMetadata) === JSON.stringify(metadata)) { const replay = await db.aiWorkflow.findUnique({ where: { id: workflowId }, include: { steps: { orderBy: { createdAt: "asc" } }, approvals: true } }); return mapToSnapshot(replay!); }
            throw new Error("A different duplicate resolution already exists for this step");
        }
        const candidates = await findDuplicateCandidates({ ...args, entityType }, actor, duplicateDb);
        if (!candidates.some((candidate) => candidate.source.entityType === entityType && candidate.source.entityId === validated.entityId)) throw new Error("Selected record is not a duplicate candidate");
        const authorized = await getAuthorizedEntityIds(actor, [entityType], { limit: 100 }, duplicateDb.scopeDb);
        if (!(authorized.ids[entityType] ?? []).includes(validated.entityId)) throw new SabahForbiddenError();
        const rows = await duplicateDb.loadCandidates(entityType, [validated.entityId]);
        if (rows.length !== 1 || rows[0].id !== validated.entityId || rows[0].isPrivate === true) throw new Error("Duplicate candidate is not accessible");
        const updated = await db.$transaction(async (transaction) => {
            const guarded = await transaction.aiWorkflow.updateMany({ where: { id: workflowId, recordVersion: workflow.recordVersion ?? 1 }, data: { recordVersion: { increment: 1 } } });
            if (guarded.count !== 1) throw new Error("Workflow changed while saving duplicate resolution");
            await transaction.aiWorkflowEvent.create({ data: { workflowId, stepId: step.id, eventType: "DUPLICATE_RESOLUTION", level: "INFO", message: `Duplicate resolution selected: ${validated.resolution}`, metadataJson: JSON.stringify(metadata) } });
            return transaction.aiWorkflow.findUnique({ where: { id: workflowId }, include: { steps: { orderBy: { createdAt: "asc" } }, approvals: true } });
        });
        const proposedDiffHash = crypto.createHash("sha256").update(`proposed:${step.argsJson ?? ""}`).digest("hex");
        const finalDiffHash = crypto.createHash("sha256").update(`final:${JSON.stringify(metadata)}`).digest("hex");
        const feedbackCaptured = await captureWorkflowFeedback(feedbackRecorder, { source: { kind: "WORKFLOW", id: workflowId, workflowId }, outcome: "CORRECTED", proposedDiffHash, finalDiffHash, reason: validated.reason ?? undefined, context: { workflow: workflowId } }, actor);
        return { ...mapToSnapshot(updated!), ...(feedbackRecorder ? { feedbackCaptured, feedbackPending: !feedbackCaptured } : {}) };
    }

    // CLARIFY remains a client-side clarification request until its durable contract is defined.
    throw new Error(`Decision type not yet implemented: ${validated.type}`);
}

/**
 * Get a workflow snapshot for an actor.
 *
 * Returns workflowSnapshotSchema-shaped view including steps and approvals.
 * Actor-scoped: returns 404 for inaccessible workflows.
 */
export async function getSnapshot(
    actor: SabahActor,
    workflowId: string,
    db: WorkflowDatabase = prisma
): Promise<WorkflowSnapshot> {
    const workflow = await db.aiWorkflow.findUnique({
        where: { id: workflowId },
        include: {
            steps: {
                orderBy: { createdAt: "asc" },
            },
            approvals: true,
        },
    });

    if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Actor can only view workflows they can access
    if (workflow.actorId !== actor.id && actor.role !== "ADMIN") {
        throw new SabahForbiddenError();
    }

    return mapToSnapshot(workflow);
}

/**
 * Execute the next PENDING step whose dependencies are VERIFIED.
 *
 * Finds the first runnable step, builds CapabilityRequest, calls runCapability,
 * persists step transition + AiWorkflowEvent.
 *
 * On APPROVAL_REQUIRED marks step APPROVAL_REQUIRED and stops.
 * On failure marks step FAILED and emits event.
 */
export function executeNextStep(actor: SabahActor, workflowId: string, db: WorkflowDatabase | undefined, runnerDeps: RunnerDeps): Promise<WorkflowSnapshot>;
export function executeNextStep(actor: SabahActor, workflowId: string, db: WorkflowDatabase | undefined, runnerDeps: RunnerDeps, options: { requestedStepId?: string; mode?: "inline"; signal?: AbortSignal; conversationId?: string | null; linkVerifier?: WorkflowLinkVerifier } ): Promise<WorkflowSnapshot>;
export function executeNextStep(actor: SabahActor, workflowId: string, db: WorkflowDatabase | undefined, runnerDeps: RunnerDeps, options: { requestedStepId: string; mode: "background"; conversationId?: string | null; queue?: { db?: JobDb; enqueuer?: WorkflowStepEnqueuer }; linkVerifier?: WorkflowLinkVerifier }): Promise<QueueJob>;
export async function executeNextStep(
    actor: SabahActor,
    workflowId: string,
    db: WorkflowDatabase = prisma,
    runnerDeps: RunnerDeps,
    options: { requestedStepId?: string; mode?: "inline" | "background"; conversationId?: string | null; queue?: { db?: JobDb; enqueuer?: WorkflowStepEnqueuer }; signal?: AbortSignal; linkVerifier?: WorkflowLinkVerifier } = {}
): Promise<WorkflowSnapshot | QueueJob> {
    if (!canExecuteWorkflow(actor)) {
        throw new SabahForbiddenError();
    }

    if (!runnerDeps) {
        throw new Error("runnerDeps required for executeNextStep");
    }
    options.signal?.throwIfAborted();

    // Fetch workflow with version check
    let workflow = await db.aiWorkflow.findUnique({
        where: { id: workflowId },
        include: {
            steps: {
                orderBy: { createdAt: "asc" },
            },
            approvals: true,
        },
    });

    if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Actor can only execute their own workflows (or ADMIN)
    if (workflow.actorId !== actor.id && actor.role !== "ADMIN") {
        throw new SabahForbiddenError();
    }

    // Check if workflow can execute
    if (
        workflow.status === "COMPLETED" ||
        workflow.status === "FAILED" ||
        workflow.status === "CANCELED"
    ) {
        return mapToSnapshot(workflow);
    }

    // Recover steps stranded RUNNING past the heartbeat window by a crashed
    // worker. If the durable store holds an EXECUTING intent, the external
    // write may have happened without verification — fail that step closed
    // instead of repeating the write. With a VERIFIED result (replay is safe)
    // or no record at all (never executed), return the step to PENDING.
    const staleThreshold = new Date(Date.now() - STALE_RUNNING_CLAIM_MS);
    const staleSteps = workflow.steps.filter((step) => step.status === "RUNNING" && step.startedAt && new Date(step.startedAt) < staleThreshold);
    if (staleSteps.length > 0) {
        const stateReader = runnerDeps.store as { getState?: (key: string) => Promise<string | null> } | undefined;
        for (const stale of staleSteps) {
            const intentState = stateReader?.getState
                ? await stateReader.getState(`${workflow.idempotencyKey}:${stale.clientStepId}`)
                : null;
            if (intentState === "EXECUTING") {
                // Keep the staleness predicate in the CAS: a live worker may have
                // heartbeated startedAt while getState was awaited, and its
                // in-flight execution must not be marked failed underneath it.
                await db.aiWorkflowStep.updateMany({
                    where: { id: stale.id, status: "RUNNING", startedAt: { lt: staleThreshold } },
                    data: { status: "FAILED", completedAt: new Date(), errorJson: JSON.stringify({ error: "Interrupted during execution before verification; manual review required" }) },
                });
                continue;
            }
            await db.aiWorkflowStep.updateMany({
                where: { id: stale.id, status: "RUNNING", startedAt: { lt: staleThreshold } },
                data: { status: "PENDING", startedAt: null },
            });
        }
        const reloaded = await db.aiWorkflow.findUnique({
            where: { id: workflowId },
            include: { steps: { orderBy: { createdAt: "asc" } }, approvals: true },
        });
        if (!reloaded) throw new Error(`Workflow not found: ${workflowId}`);
        workflow = reloaded;
    }

    // Find next runnable step (normalize persisted steps: dependsOn lives in dependsOnJson)
    const normalizedSteps = workflow.steps.map((s) => ({
        clientStepId: s.clientStepId,
        status: s.status,
        dependsOn: JSON.parse(s.dependsOnJson ?? "[]") as string[],
    }));
    const requested = options.requestedStepId;
    const nextStepId = requested
        ? normalizedSteps.find((step) => { const candidate = workflow.steps.find((item) => item.clientStepId === step.clientStepId); return (candidate?.id === requested || step.clientStepId === requested) && findNextRunnableStep(normalizedSteps) === step.clientStepId; })?.clientStepId ?? null
        : findNextRunnableStep(normalizedSteps);
    if (requested && !nextStepId) throw new Error("Requested workflow step is not runnable");
    if (!nextStepId) {
        // No runnable steps - check if all done
        const allVerified = workflow.steps.every((s) => s.status === "VERIFIED" || s.status === "SKIPPED");
        const hasFailed = workflow.steps.some((s) => s.status === "FAILED");

        if (allVerified) {
            await db.aiWorkflow.updateMany({
                where: { id: workflowId, status: { in: ["PLANNED", "RUNNING"] } },
                data: {
                    status: "COMPLETED",
                    completedAt: new Date(),
                    recordVersion: { increment: 1 },
                },
            });
        } else if (hasFailed) {
            await db.aiWorkflow.updateMany({
                where: { id: workflowId, status: { in: ["PLANNED", "RUNNING"] } },
                data: {
                    status: "FAILED",
                    completedAt: new Date(),
                    recordVersion: { increment: 1 },
                },
            });
        }

        // Refresh
        const updated = await db.aiWorkflow.findUnique({
            where: { id: workflowId },
            include: {
                steps: { orderBy: { createdAt: "asc" } },
                approvals: true,
            },
        });

        return mapToSnapshot(updated!);
    }

    if (options.mode === "background") {
        const queuedStepId = options.requestedStepId;
        if (!queuedStepId) throw new Error("workflow background step identity required");
        const queued = workflow.steps.find((step) => step.clientStepId === nextStepId);
        if (!queued) throw new Error("workflow background step identity invalid");
        return enqueueWorkflowStep({ type: "WORKFLOW_STEP", idempotencyKey: `${workflowId}:${nextStepId}`, priority: 2, payload: { actor: { role: actor.role, departmentIds: actor.departmentIds.slice(0, 100) } }, actorId: actor.id, workflowId, stepId: queued.id, maxAttempts: 3 }, options.queue?.db, options.queue?.enqueuer);
    }

    const nextStep = workflow.steps.find((s) => s.clientStepId === nextStepId)!;

    // Claim the step and revalidate any persisted approval in one transaction.
    // The approval check is deliberately after the PENDING CAS but before the
    // capability call; a failed check rolls the claim back atomically.
    const executionNow = runnerDeps.now();
    let approvalVerified = false;
    const claimed = await db.$transaction(async (transaction) => {
        const claim = await transaction.aiWorkflowStep.updateMany({
            where: {
                id: nextStep.id,
                status: "PENDING",
                capability: nextStep.capability,
                argsJson: nextStep.argsJson,
                workflow: { status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } },
            },
            data: {
                status: "RUNNING",
                startedAt: executionNow,
            },
        });
        if (claim.count === 1) {
            approvalVerified = await revalidateApprovedExecution(
                transaction,
                workflowId,
                workflow,
                nextStep,
                options.conversationId !== undefined ? options.conversationId : workflow.conversationId ?? null,
                actor,
                runnerDeps.now,
            );
        }
        return claim;
    });
    if (claimed.count !== 1) {
        const current = await db.aiWorkflow.findUnique({
            where: { id: workflowId },
            include: {
                steps: { orderBy: { createdAt: "asc" } },
                approvals: true,
            },
        });
        return mapToSnapshot(current!);
    }

    // Build capability request (step idempotency composes the workflow key + client step id)
    const rawArgs = JSON.parse(nextStep.argsJson) as unknown;
    const args = nextStep.capability === "tasks.create"
        ? createTaskSchema.parse(rawArgs)
        : rawArgs;
    const request: CapabilityRequest = {
        name: nextStep.capability,
        version: nextStep.capabilityVersion ?? undefined,
        input: args,
        explicitUserRequest: true,
        hasInferredReplacement: false,
        confidence: nextStep.confidence,
        itemCount: 1,
        approvalMode: "SMART",
        // The transaction above revalidated the exact approval immediately
        // before this runner call. A missing approval remains false so the
        // capability can produce its durable APPROVAL_REQUIRED preview.
        approved: approvalVerified,
        idempotencyKey: `${workflow.idempotencyKey}:${nextStep.clientStepId}`,
    };

    // Build the canonical capability context. Keep actor, conversation, and
    // request identity at the typed context boundary so domain commands can
    // bind their own idempotency keys to the same durable workflow intent.
    const requestId = `${workflow.idempotencyKey}:${nextStep.clientStepId}`;
    const context = {
        actor,
        requestId,
        stepId: nextStep.id,
        conversationId: workflow.conversationId ?? null,
        workflowId: workflow.id,
        now: executionNow,
        signal: options.signal,
        idempotencyKey: request.idempotencyKey,
    };

    // Run capability. While it executes, refresh startedAt as a heartbeat so a
    // legitimately long-running step is never mistaken for an abandoned claim.
    const heartbeat = setInterval(() => {
        void db.aiWorkflowStep
            .updateMany({ where: { id: nextStep.id, status: "RUNNING" }, data: { startedAt: new Date() } })
            .catch(() => undefined);
    }, STEP_HEARTBEAT_MS);
    let result;
    try {
        result = await runCapability(request, context as any, runnerDeps);
        options.signal?.throwIfAborted();
    } finally {
        clearInterval(heartbeat);
    }

    // Process result
    if (result.state === "VERIFIED") {
        let resultSummary = "Action completed and verified.";
        try {
            // The runner has completed execution and verification at this
            // point. Only the capability's bounded human summary crosses the
            // workflow persistence boundary; never persist result or args.
            const capability = runnerDeps.registry.resolve(nextStep.capability, nextStep.capabilityVersion ?? undefined);
            resultSummary = boundedInlineText(capability.summarize(result.output), INLINE_PREVIEW_SUMMARY_MAX) ?? resultSummary;
        } catch {
            // Verification remains durable even if display summarization fails.
        }
        let entityLinks: WorkflowEntityLink[];
        try {
            entityLinks = await projectVerifiedEntityLinks(
                result.output,
                actor,
                options.linkVerifier ?? DEFAULT_WORKFLOW_LINK_VERIFIER,
            );
        } catch (error) {
            // A source-store outage must not turn a generic capability
            // verification into a durable VERIFIED step. Mark the step failed
            // without exposing storage details, then preserve the original
            // error so callers can distinguish an outage from an inaccessible
            // (normally omitted) source.
            const failed = await db.aiWorkflowStep.updateMany({
                where: { id: nextStep.id, status: "RUNNING", workflow: { status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } } },
                data: {
                    status: "FAILED",
                    completedAt: new Date(),
                    errorJson: JSON.stringify({ error: "Verified result source authorization failed" }),
                },
            });
            if (failed.count === 1) {
                await db.aiWorkflowEvent.create({
                    data: {
                        workflowId,
                        stepId: nextStep.id,
                        eventType: "STEP_FAILED",
                        level: "ERROR",
                        message: `Step failed: ${nextStep.clientStepId} - verified result source authorization failed`,
                    },
                }).catch(() => undefined);
            }
            throw error;
        }
        const recorded = await db.aiWorkflowStep.updateMany({
            where: { id: nextStep.id, status: "RUNNING", workflow: { status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } } },
            data: {
                status: "VERIFIED",
                completedAt: new Date(),
                verifiedAt: new Date(),
                outputJson: JSON.stringify({ summary: resultSummary, entityLinks }),
            },
        });
        if (recorded.count !== 1) {
            await db.aiWorkflowStep.updateMany({
                where: { id: nextStep.id, status: "RUNNING" },
                data: { status: "SKIPPED", completedAt: new Date(), errorJson: JSON.stringify({ error: "Workflow became terminal while the capability was executing" }) },
            });
            const current = await db.aiWorkflow.findUnique({ where: { id: workflowId }, include: { steps: { orderBy: { createdAt: "asc" } }, approvals: true } });
            return mapToSnapshot(current!);
        }

        // Emit success event
        await db.aiWorkflowEvent.create({
            data: {
                workflowId,
                stepId: nextStep.id,
                eventType: "STEP_VERIFIED",
                level: "INFO",
                message: `Step verified: ${nextStep.clientStepId}`,
            },
        });

        // Update workflow to RUNNING if still PLANNED
        if (workflow.status === "PLANNED") {
            await db.aiWorkflow.updateMany({
                where: { id: workflowId, status: "PLANNED" },
                data: { status: "RUNNING", startedAt: new Date() },
            });
        }
    } else if (result.state === "APPROVAL_REQUIRED") {
        let rawApprovalPreview = result.preview;
        let approvalPreview = projectInlinePreview(rawApprovalPreview);
        if (!approvalPreview || nextStep.capability === "tasks.create") {
            try {
                // runCapability has already performed availability,
                // authorization, and approval-policy checks. Reuse the bound
                // capability only to obtain its canonical display preview;
                // the authoritative field projection below uses parsed input.
                const capability = runnerDeps.registry.resolve(nextStep.capability, nextStep.capabilityVersion ?? undefined);
                rawApprovalPreview = await capability.preview(args as never, context as never);
                approvalPreview = projectInlinePreview(rawApprovalPreview) ?? approvalPreview;
            } catch {
                if (!approvalPreview) approvalPreview = null;
            }
        }
        const fallbackTitle = `Approval required: ${nextStep.capability}`;
        const approvalRisk = "REVERSIBLE_WRITE";
        const approvalHash = approvalBinding(nextStep, approvalRisk);
        const approvalReview = nextStep.capability === "tasks.create"
            ? projectTaskCreateApprovalReview(args as CreateTaskInput, approvalHash)
            : null;
        const previewPayload = {
            ...(approvalPreview ? { title: approvalPreview.title, summary: approvalPreview.summary } : {}),
            ...(approvalReview ? { approvalReview } : {}),
        };
        const previewJson = Object.keys(previewPayload).length > 0 ? JSON.stringify(previewPayload) : null;
        // Claim the approval transition inside the transaction. If Stop or a
        // terminal outcome won while the capability was running, do not create
        // a stale approval or reopen the workflow.
        const transitioned = await db.$transaction(async (transaction) => {
            const workflowClaim = await transaction.aiWorkflow.updateMany({
                where: { id: workflowId, status: { in: ["PLANNED", "RUNNING", "AWAITING_APPROVAL"] } },
                data: { status: "AWAITING_APPROVAL" },
            });
            if (workflowClaim.count !== 1) return false;

            const stepClaim = await transaction.aiWorkflowStep.updateMany({
                where: { id: nextStep.id, status: "RUNNING" },
                data: { status: "APPROVAL_REQUIRED", completedAt: new Date(), previewJson },
            });
            if (stepClaim.count !== 1) throw new WorkflowServiceError("Workflow step is no longer awaiting approval", 409);

            await transaction.aiApproval.create({
                data: {
                    workflowId,
                    stepId: nextStep.id,
                    status: "PENDING",
                    title: approvalPreview?.title ?? fallbackTitle,
                    summary: approvalPreview?.summary ?? "This operation requires approval",
                    risk: approvalRisk,
                    fieldsJson: JSON.stringify([{ path: APPROVAL_BINDING_PATH, proposed: approvalBinding(nextStep, approvalRisk) }]),
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
                    requestedById: actor.id,
                },
            });
            await transaction.aiWorkflowEvent.create({
                data: { workflowId, stepId: nextStep.id, eventType: "APPROVAL_REQUIRED", level: "INFO", message: `Approval required: ${nextStep.clientStepId}` },
            });
            return true;
        });

        if (transitioned) {
            await emitLifecycle(runnerDeps.eventBus, { name: "approval.requested", correlationId: workflowId, actorId: actor.id, entityRefs: [], payload: { workflowId, stepId: nextStep.id } });
        } else {
            await db.aiWorkflowStep.updateMany({
                where: { id: nextStep.id, status: "RUNNING" },
                data: { status: "SKIPPED", completedAt: new Date(), errorJson: JSON.stringify({ error: "Workflow became terminal before approval could be requested" }) },
            });
        }
    } else if (result.state === "FAILED" || result.state === "FAILED_VERIFICATION") {
        const errorMsg = result.error ?? "Execution failed";

        await db.aiWorkflowStep.update({
            where: { id: nextStep.id },
            data: {
                status: "FAILED",
                completedAt: new Date(),
                errorJson: JSON.stringify({ error: errorMsg }),
            },
        });

        // Mark dependents as BLOCKED
        const dependents = markDependentsBlocked(
            nextStep.clientStepId,
            workflow.steps.map((s) => ({
                clientStepId: s.clientStepId,
                status: s.status,
                dependsOn: JSON.parse(s.dependsOnJson) as string[],
            }))
        );

        for (const depId of dependents) {
            const depStep = workflow.steps.find((s) => s.clientStepId === depId);
            if (depStep) {
                await db.aiWorkflowStep.update({
                    where: { id: depStep.id },
                    data: { status: "BLOCKED" },
                });
            }
        }

        // Emit failure event
        await db.aiWorkflowEvent.create({
            data: {
                workflowId,
                stepId: nextStep.id,
                eventType: "STEP_FAILED",
                level: "ERROR",
                message: `Step failed: ${nextStep.clientStepId} - ${errorMsg}`,
                metadataJson: JSON.stringify({ error: errorMsg }),
            },
        });
    } else {
        // BLOCKED or DISABLED - mark as failed
        await db.aiWorkflowStep.update({
            where: { id: nextStep.id },
            data: {
                status: "FAILED",
                completedAt: new Date(),
                errorJson: JSON.stringify({ error: `Capability blocked: ${result.state}` }),
            },
        });
    }

    // Refresh workflow
    let updated = await db.aiWorkflow.findUnique({
        where: { id: workflowId },
        include: {
            steps: { orderBy: { createdAt: "asc" } },
            approvals: true,
        },
    });

    // Complete the last verified step in this request, without another execute
    // round trip. CAS preserves cancellation and requires every persisted step
    // to be verified/skipped; display state is always read back from the server.
    if (updated && updated.steps.length > 0 && updated.steps.every((step) => step.status === "VERIFIED" || step.status === "SKIPPED")) {
        await db.aiWorkflow.updateMany({
            where: { id: workflowId, status: { in: ["PLANNED", "RUNNING"] }, steps: { every: { status: { in: ["VERIFIED", "SKIPPED"] } } } },
            data: { status: "COMPLETED", completedAt: new Date(), recordVersion: { increment: 1 } },
        });
        updated = await db.aiWorkflow.findUnique({ where: { id: workflowId }, include: { steps: { orderBy: { createdAt: "asc" } }, approvals: true } });
    }
    return mapToSnapshot(updated!);
}

/**
 * List workflows scoped to an actor.
 *
 * Supports filtering by status, actorId, etc.
 */
export async function listWorkflows(
    actor: SabahActor,
    filters: { status?: string; conversationId?: string; limit?: number },
    db: WorkflowDatabase = prisma
): Promise<WorkflowSnapshot[]> {
    const where: any = {};

    // Actor-scoped: only show own workflows unless ADMIN
    if (actor.role !== "ADMIN") {
        where.actorId = actor.id;
    }

    if (filters.status) {
        where.status = filters.status;
    }
    if (filters.conversationId) {
        where.conversationId = filters.conversationId;
    }

    const workflows = await db.aiWorkflow.findMany({
        where,
        include: {
            steps: {
                orderBy: { createdAt: "asc" },
            },
            approvals: true,
        },
        orderBy: { createdAt: "desc" },
        take: filters.limit ?? 50,
    });

    return workflows.map(mapToSnapshot);
}

// Helper: map database entities to snapshot shape
function mapToSnapshot(
    workflow: any
): WorkflowSnapshot {
    const steps = workflow.steps as any[];
    return {
        id: workflow.id,
        goal: workflow.goal,
        status: workflow.status,
        actorId: workflow.actorId,
        steps: steps.map((step: any) => ({
            id: step.id,
            clientStepId: step.clientStepId,
            capability: step.capability,
            status: step.status,
            dependsOn: JSON.parse(step.dependsOnJson),
            confidence: step.confidence,
            previewSummary: storedInlineSummary(step.previewJson, "summary") ?? storedInlineSummary(step.previewJson, "title"),
            resultSummary: storedInlineSummary(step.outputJson, "summary"),
            error: step.errorJson ? JSON.parse(step.errorJson).error : undefined,
            entityLinks: storedEntityLinks(step.outputJson),
            startedAt: step.startedAt?.toISOString(),
            completedAt: step.completedAt?.toISOString(),
            verifiedAt: step.verifiedAt?.toISOString(),
        })),
        approvals: workflow.approvals.map((approval: any) => {
            const step = steps.find((candidate: any) => candidate.id === approval.stepId);
            const binding = storedApprovalBinding(approval.fieldsJson);
            const currentBinding = step && binding && binding === approvalBinding(step, approval.risk) ? binding : null;
            const review = currentBinding ? storedApprovalReview(step.previewJson, currentBinding, step) : undefined;
            return {
                id: approval.id,
                stepId: approval.stepId ?? "",
                title: approval.title,
                risk: approval.risk as any,
                status: approval.status,
                expiresAt: approval.expiresAt.toISOString(),
                requestedAt: approval.createdAt.toISOString(),
                decidedAt: approval.decidedAt?.toISOString(),
                decisionType: approval.decisionType ?? undefined,
                reason: approval.decisionReason ?? undefined,
                ...(review ? { review } : {}),
            };
        }),
        createdAt: workflow.createdAt.toISOString(),
        updatedAt: workflow.updatedAt.toISOString(),
        startedAt: workflow.startedAt?.toISOString(),
        completedAt: workflow.completedAt?.toISOString(),
    };
}
