import type { PrismaClient } from "@prisma/client";
import type { SabahCapability, CapabilityContext } from "./contracts";
import { CapabilityRegistry } from "./registry";
import { evaluateApproval } from "../policy/approval-policy";
import { writeOperationalLog, writeActivityEvent, writeCapabilityAudit } from "../logging/log";
import type { SabahFlags } from "../flags";
import type { SourceRef, WorkspaceEntityType } from "../intelligence/contracts";
import { indexEntity, parseSourceRef, sanitizeErrorCode } from "../intelligence/indexer";
import type { IndexDb } from "../intelligence/indexer";
import { prisma } from "@/lib/prisma";
import { assertCapabilityAllowed } from "../security/hard-boundaries";
import type { LifecycleEventBus } from "../events/bus";

// Result states per brief
export type CapabilityRunState =
    | "ALLOWED_PREVIEW"
    | "APPROVAL_REQUIRED"
    | "BLOCKED"
    | "DISABLED"
    | "VERIFIED"
    | "FAILED"
    | "FAILED_VERIFICATION";

export type CapabilityRunResult = {
    state: CapabilityRunState;
    output?: unknown;
    preview?: unknown;
    error?: string;
    idempotencyKey?: string;
};

// Store interface for idempotency
export interface CapabilityResultStore {
    getPriorResult(key: string): Promise<{ state: CapabilityRunState; output: unknown } | null>;
    claimExecution?(key: string): Promise<{ state: "CLAIMED" | "BUSY"; output?: never } | { state: "VERIFIED"; output: unknown }>;
    saveResult(key: string, result: { state: CapabilityRunState; output: unknown }): Promise<void>;
    markCompensated(key: string): Promise<void>;
    isCompensated(key: string): boolean | Promise<boolean>;
}

// Dependencies for injection
export type RunnerDeps = {
    registry: CapabilityRegistry;
    db: Pick<PrismaClient, "aiOperationalLog" | "aiWorkflowEvent">;
    indexDb?: IndexDb;
    store?: CapabilityResultStore;
    now: () => Date;
    flags: SabahFlags;
    indexEntity?: (ref: SourceRef, db: IndexDb) => Promise<unknown>;
    scheduleIndexRetry?: (ref: SourceRef, errorCode: string) => Promise<void>;
    retryDb?: Pick<PrismaClient, "aiWorkflow" | "aiWorkflowEvent">;
    eventBus?: LifecycleEventBus;
};

// Request structure
export type CapabilityRequest = {
    name: string;
    version?: number;
    input: unknown;
    explicitUserRequest: boolean;
    hasInferredReplacement: boolean;
    confidence: number;
    itemCount: number;
    approvalMode: "SMART" | "MANUAL" | "FAST";
    approved?: boolean;
    idempotencyKey?: string;
};

// Internal log helpers
async function logOperational(
    deps: RunnerDeps,
    context: CapabilityContext,
    level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SECURITY",
    category: "RETRIEVAL" | "PLANNING" | "CAPABILITY" | "PROVIDER" | "EXTRACTION" | "JOB" | "SECURITY",
    message: string,
    metadata?: unknown,
): Promise<void> {
    await writeOperationalLog(
        {
            level,
            category,
            message,
            correlationId: context.requestId,
            conversationId: context.conversationId ?? undefined,
            workflowId: context.workflowId ?? undefined,
            actorId: context.actor.id,
            metadata,
            expiresAt: deps.now(),
        },
        deps.db,
    );
}

async function logActivity(
    deps: RunnerDeps,
    context: CapabilityContext,
    level: "DEBUG" | "INFO" | "WARN" | "ERROR" | "SECURITY",
    message: string,
    metadata?: unknown,
): Promise<void> {
    await writeActivityEvent(
        {
            level,
            category: "CAPABILITY",
            message,
            correlationId: context.requestId,
            conversationId: context.conversationId ?? undefined,
            workflowId: context.workflowId ?? undefined,
            stepId: context.stepId,
            actorId: context.actor.id,
            metadata,
            expiresAt: deps.now(),
        },
        deps.db,
    );
}

async function publishStepFailure(deps: RunnerDeps, context: CapabilityContext, capability: string, error: string): Promise<void> {
    if (deps.eventBus) await deps.eventBus.publish({ name: "step.failed", correlationId: context.requestId, actorId: context.actor.id, entityRefs: [], payload: { capability, error } }).catch(() => undefined);
}

async function logAudit(
    deps: RunnerDeps,
    context: CapabilityContext,
    level: "DEBUG" | "WARN" | "INFO" | "ERROR" | "SECURITY",
    message: string,
    metadata?: unknown,
): Promise<void> {
    await writeCapabilityAudit(
        {
            level,
            category: "CAPABILITY",
            message,
            correlationId: context.requestId,
            conversationId: context.conversationId ?? undefined,
            workflowId: context.workflowId ?? undefined,
            stepId: context.stepId,
            actorId: context.actor.id,
            metadata,
            expiresAt: deps.now(),
        },
        deps.db,
    );
}

// Helper: get risk from capability (static or dynamic)
async function getRisk<I, O>(
    capability: SabahCapability<I, O>,
    input: I,
    context: CapabilityContext,
): Promise<string> {
    const risk = capability.risk;
    if (typeof risk === "function") {
        return await risk(input, context);
    }
    return risk;
}

// Step 1: Resolve capability from registry
function resolveCapability(
    registry: CapabilityRegistry,
    name: string,
    version?: number,
): SabahCapability<unknown, unknown> {
    assertCapabilityAllowed(name);
    return registry.resolve(name, version);
}

// Step 2: Parse input using inputSchema
async function parseInput<I, O>(
    capability: SabahCapability<I, O>,
    rawInput: unknown,
): Promise<I> {
    return capability.inputSchema.parse(rawInput) as I;
}

// Step 3: Check availability and authorize
async function authorizeCapability<I, O>(
    capability: SabahCapability<I, O>,
    input: I,
    context: CapabilityContext,
): Promise<void> {
    const isAvailable = await capability.available(context.actor);
    if (!isAvailable) {
        throw new Error("Capability not available for actor");
    }

    await capability.authorize(input, context);
}

// Step 4-5: Determine risk and evaluate policy
async function evaluatePolicyDecision<I, O>(
    capability: SabahCapability<I, O>,
    risk: string,
    request: CapabilityRequest,
): Promise<"ALLOW" | "REQUIRE_APPROVAL" | "BLOCK"> {
    // Some sensitive operations must never be fast-pathed. Keep this in the
    // runner (rather than only in previews) so approval is executable.
    if (capability.requiresExplicitApproval && !request.approved) {
        return "REQUIRE_APPROVAL";
    }
    return evaluateApproval({
        mode: request.approvalMode,
        risk: risk as any,
        explicitUserRequest: request.explicitUserRequest,
        hasInferredReplacement: request.hasInferredReplacement,
        confidence: request.confidence,
        itemCount: request.itemCount,
    });
}

// Step 6: Preview the capability
async function previewCapabilityOperation<I, O>(
    capability: SabahCapability<I, O>,
    input: I,
    context: CapabilityContext,
    deps: RunnerDeps,
): Promise<CapabilityRunResult> {
    const preview = await capability.preview(input, context);

    await logOperational(deps, context, "INFO", "CAPABILITY", `Preview generated: ${capability.name}`, { preview });
    await logActivity(deps, context, "INFO", `Capability preview: ${capability.name}`);

    return {
        state: "ALLOWED_PREVIEW",
        preview,
    };
}

// Step 7: Execute the capability
async function executeCapability<I, O>(
    capability: SabahCapability<I, O>,
    input: I,
    context: CapabilityContext,
    deps: RunnerDeps,
): Promise<O> {
    const output = await capability.execute(input, context);

    await logOperational(deps, context, "INFO", "CAPABILITY", `Capability executed: ${capability.name}`, { outputType: typeof output });

    return output;
}

// Step 8: Parse output using outputSchema
async function parseOutput<I, O>(
    capability: SabahCapability<I, O>,
    rawOutput: unknown,
): Promise<O> {
    return capability.outputSchema.parse(rawOutput) as O;
}

// Step 9: Verify the output
async function verifyOutput<I, O>(
    capability: SabahCapability<I, O>,
    input: I,
    output: O,
    context: CapabilityContext,
): Promise<O> {
    return await capability.verify(output, { ...context, input });
}

// Step 10: Persist result (idempotency)
async function persistResult(
    deps: RunnerDeps,
    request: CapabilityRequest,
    result: CapabilityRunResult,
): Promise<void> {
    if (request.idempotencyKey && deps.store) {
        await deps.store.saveResult(request.idempotencyKey, {
            state: result.state,
            output: result.output,
        });
    }
}

// Step 11: Audit
async function auditExecution(
    deps: RunnerDeps,
    context: CapabilityContext,
    capabilityName: string,
    state: CapabilityRunState,
    metadata?: unknown,
): Promise<void> {
    await logAudit(deps, context, "INFO", `Capability execution: ${capabilityName} -> ${state}`, metadata);
}

function validSourceRef(item: Record<string, unknown>): SourceRef | null {
    return parseSourceRef(item);
}
async function indexVerifiedLinks(deps: RunnerDeps, context: CapabilityContext, output: unknown): Promise<void> {
    if (!output || typeof output !== "object") return;
    const links = (output as { entityLinks?: unknown }).entityLinks;
    if (!Array.isArray(links)) return;
    const indexDb = deps.indexDb ?? (prisma as unknown as IndexDb);
    const index = deps.indexEntity ?? ((ref: SourceRef, db: IndexDb) => indexEntity(ref, db));
    const schedule = deps.scheduleIndexRetry ?? (async (ref: SourceRef, errorCode: string) => {
        const metadata = { entityType: ref.entityType, entityId: ref.entityId, href: ref.href, label: ref.label, sourceUpdatedAt: ref.sourceUpdatedAt, checksum: ref.checksum, errorCode };
        if (context.workflowId) {
            await deps.db.aiWorkflowEvent.create({ data: { workflowId: context.workflowId, stepId: context.stepId, eventType: "WORKSPACE_INDEX_RETRY", level: "WARN", message: "Verified entity indexing retry scheduled", metadataJson: JSON.stringify(metadata) } });
            return;
        }
        const retryDb = deps.retryDb ?? (prisma as unknown as Pick<PrismaClient, "aiWorkflow" | "aiWorkflowEvent">);
        const workflowId = (await retryDb.aiWorkflow.create({ data: { goal: "Workspace index retry", status: "PLANNED", idempotencyKey: `workspace-index-retry:${context.requestId}:${ref.entityType}:${ref.entityId}` } })).id;
        await retryDb.aiWorkflowEvent.create({ data: { workflowId, stepId: context.stepId, eventType: "WORKSPACE_INDEX_RETRY", level: "WARN", message: "Verified entity indexing retry scheduled", metadataJson: JSON.stringify(metadata) } });
    });
    for (const link of links) {
        if (!link || typeof link !== "object") continue;
        const ref = validSourceRef(link as Record<string, unknown>);
        if (!ref) continue;
        try { await index(ref, indexDb); }
        catch (error) {
            const errorCode = sanitizeErrorCode(error);
            try { await logOperational(deps, context, "WARN", "JOB", "Verified entity indexing deferred", { entityType: ref.entityType, entityId: ref.entityId, checksum: ref.checksum, errorCode }); } catch { /* indexing must not roll back verification */ }
            try { await schedule(ref, errorCode); } catch { /* retry scheduling is best effort */ }
        }
    }
}

// Main: Preview capability
export async function previewCapability(
    request: CapabilityRequest,
    context: CapabilityContext,
    deps: RunnerDeps,
): Promise<CapabilityRunResult> {
    try {
        await logOperational(deps, context, "DEBUG", "CAPABILITY", `Preview requested: ${request.name}`, { request });

        // Step 1: Resolve
        const capability = resolveCapability(deps.registry, request.name, request.version);

        // Step 2: Parse input
        const input = await parseInput(capability, request.input);
        const capabilityContext = { ...context, idempotencyKey: request.idempotencyKey };

        // Step 3: Check availability and authorize
        await authorizeCapability(capability, input, capabilityContext);

        // Step 4-5: Determine risk and evaluate policy
        const risk = await getRisk(capability, input, capabilityContext);
        const decision = await evaluatePolicyDecision(capability, risk, request);

        // Handle blocked/require-approval states
        if (decision === "BLOCK") {
            await logAudit(deps, context, "WARN", `Capability blocked by policy: ${request.name}`, { risk, decision });
            await logOperational(deps, context, "WARN", "CAPABILITY", `Capability blocked: ${request.name}`, { risk, decision });
            return { state: "BLOCKED" };
        }

        if (decision === "REQUIRE_APPROVAL") {
            await logOperational(deps, context, "INFO", "CAPABILITY", `Approval required: ${request.name}`, { risk, decision });
            return { state: "APPROVAL_REQUIRED" };
        }

        // Step 6: Preview
        return await previewCapabilityOperation(capability, input, capabilityContext, deps);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await logOperational(deps, context, "ERROR", "CAPABILITY", `Preview failed: ${request.name}`, { error: errorMsg });
        throw error;
    }
}

// Main: Run capability
export async function runCapability(
    request: CapabilityRequest,
    context: CapabilityContext,
    deps: RunnerDeps,
): Promise<CapabilityRunResult> {
    try {
        await logOperational(deps, context, "DEBUG", "CAPABILITY", `Execution requested: ${request.name}`, { request });

        // Check writes flag
        if (!deps.flags.writes) {
            await logOperational(deps, context, "WARN", "CAPABILITY", "Writes disabled by flags", { flags: deps.flags });
            await logAudit(deps, context, "WARN", "Capability execution blocked: writes disabled");
            await publishStepFailure(deps, context, request.name, "Writes disabled by flags");
            return { state: "DISABLED" };
        }

        // Check idempotency - return prior result if exists
        if (request.idempotencyKey && deps.store) {
            const prior = await deps.store.getPriorResult(request.idempotencyKey);
            if (prior && prior.state === "VERIFIED") {
                await logOperational(deps, context, "INFO", "CAPABILITY", `Idempotent replay: ${request.name}`, { idempotencyKey: request.idempotencyKey });
                return { state: "VERIFIED", output: prior.output, idempotencyKey: request.idempotencyKey };
            }
        }

        // Step 1: Resolve
        const capability = resolveCapability(deps.registry, request.name, request.version);

        // Step 2: Parse input
        const input = await parseInput(capability, request.input);
        const capabilityContext = { ...context, idempotencyKey: request.idempotencyKey };

        // Step 3: Check availability and authorize
        await authorizeCapability(capability, input, capabilityContext);

        // Step 4-5: Determine risk and evaluate policy
        const risk = await getRisk(capability, input, capabilityContext);
        const decision = await evaluatePolicyDecision(capability, risk, request);

        // Handle blocked state - never execute
        if (decision === "BLOCK") {
            await logAudit(deps, context, "WARN", `Capability blocked by policy: ${request.name}`, { risk, decision });
            await logOperational(deps, context, "WARN", "CAPABILITY", `Capability blocked: ${request.name}`, { risk, decision });
            await publishStepFailure(deps, context, request.name, "Capability blocked by policy");
            return { state: "BLOCKED" };
        }

        // Handle require-approval state - never execute unless explicitly approved
        if (decision === "REQUIRE_APPROVAL") {
            if (!request.approved) {
                await logOperational(deps, context, "INFO", "CAPABILITY", `Approval required: ${request.name}`, { risk, decision });
                return { state: "APPROVAL_REQUIRED" };
            }
            // Proceed with explicit approval
            await logOperational(deps, context, "INFO", "CAPABILITY", `Proceeding with explicit approval: ${request.name}`, { approved: true });
        }

        // Record an execution intent so crash recovery can distinguish "never
        // executed" (no row) from "may have written externally but was never
        // verified" (EXECUTING row). Replay ignores non-VERIFIED states.
        if (request.idempotencyKey && deps.store) {
            if (deps.store.claimExecution) {
                const claim = await deps.store.claimExecution(request.idempotencyKey);
                if (claim.state === "VERIFIED") return { state: "VERIFIED", output: claim.output, idempotencyKey: request.idempotencyKey };
                if (claim.state === "BUSY") return { state: "FAILED", error: "Capability execution is already in progress", idempotencyKey: request.idempotencyKey };
            } else {
                await deps.store.saveResult(request.idempotencyKey, { state: "EXECUTING" as CapabilityRunState, output: undefined });
            }
        }

        // Step 7: Execute
        context.signal?.throwIfAborted();
        const rawOutput = await executeCapability(capability, input, capabilityContext, deps);
        context.signal?.throwIfAborted();

        // Step 8: Parse output
        let parsedOutput: unknown;
        try {
            parsedOutput = await parseOutput(capability, rawOutput);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            await logAudit(deps, context, "ERROR", `Output validation failed: ${request.name}`, { error: errorMsg });
            await publishStepFailure(deps, context, request.name, errorMsg);
            return { state: "FAILED", error: errorMsg };
        }

        // Step 9: Verify
        let verifiedOutput: unknown;
        try {
            context.signal?.throwIfAborted();
            verifiedOutput = await verifyOutput(capability, input as any, parsedOutput as any, capabilityContext);
            context.signal?.throwIfAborted();
        } catch (error) {
            if (context.signal?.aborted) throw error;
            const errorMsg = error instanceof Error ? error.message : String(error);
            await logAudit(deps, context, "ERROR", `Verification failed: ${request.name}`, { error: errorMsg });
            await publishStepFailure(deps, context, request.name, errorMsg);
            return { state: "FAILED_VERIFICATION", error: errorMsg };
        }

        // Step 10: Persist result
        const result: CapabilityRunResult = {
            state: "VERIFIED",
            output: verifiedOutput,
            idempotencyKey: request.idempotencyKey,
        };
        context.signal?.throwIfAborted();
        await persistResult(deps, request, result);
        if (deps.eventBus) {
            await deps.eventBus.publish({ name: "step.completed", correlationId: context.requestId, actorId: context.actor.id, entityRefs: [], payload: { capability: request.name, state: result.state } }).catch(() => undefined);
        }
        await indexVerifiedLinks(deps, context, verifiedOutput);

        // Step 11: Audit
        await auditExecution(deps, context, request.name, "VERIFIED", { risk, decision });

        // Log activity for user visibility
        const summary = capability.summarize(verifiedOutput as any);
        await logActivity(deps, context, "INFO", summary);

        return result;
    } catch (error) {
        if (context.signal?.aborted) throw error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        await logAudit(deps, context, "ERROR", `Capability execution failed: ${request.name}`, { error: errorMsg });
        await logOperational(deps, context, "ERROR", "CAPABILITY", `Execution failed: ${request.name}`, { error: errorMsg });
        await publishStepFailure(deps, context, request.name, errorMsg);
        return { state: "FAILED", error: errorMsg };
    }
}

// Main: Compensate capability
export async function compensateCapability(
    request: CapabilityRequest,
    context: CapabilityContext,
    deps: RunnerDeps & { output: unknown },
): Promise<{ state: "COMPENSATED"; error?: string }> {
    try {
        await logOperational(deps, context, "DEBUG", "CAPABILITY", `Compensation requested: ${request.name}`, { request });

        // Check if already compensated
        if (deps.store && request.idempotencyKey) {
            const isCompensated = await deps.store.isCompensated(request.idempotencyKey);
            if (isCompensated) {
                await logOperational(deps, context, "INFO", "CAPABILITY", `Already compensated: ${request.name}`, { idempotencyKey: request.idempotencyKey });
                return { state: "COMPENSATED" };
            }
        }

        // Resolve capability
        const capability = resolveCapability(deps.registry, request.name, request.version);

        // Check if compensate is defined
        if (!capability.compensate) {
            await logOperational(deps, context, "WARN", "CAPABILITY", `Compensation not supported: ${request.name}`);
            return { state: "COMPENSATED", error: "Compensation not supported" };
        }

        // Execute compensation
        await capability.compensate(deps.output as any, context);

        // Mark as compensated
        if (deps.store && request.idempotencyKey) {
            await deps.store.markCompensated(request.idempotencyKey);
        }

        await logAudit(deps, context, "INFO", `Capability compensated: ${request.name}`);
        await logOperational(deps, context, "INFO", "CAPABILITY", `Compensated: ${request.name}`);

        return { state: "COMPENSATED" };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await logAudit(deps, context, "ERROR", `Compensation failed: ${request.name}`, { error: errorMsg });
        await logOperational(deps, context, "ERROR", "CAPABILITY", `Compensation failed: ${request.name}`, { error: errorMsg });
        return { state: "COMPENSATED", error: errorMsg };
    }
}
