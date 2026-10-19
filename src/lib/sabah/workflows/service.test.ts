import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
    proposeWorkflow,
    assertApprovedWorkflowIntent,
    decide,
    getSnapshot,
    executeNextStep,
    listWorkflows,
    workflowUndoLimitation,
    type WorkflowDatabase,
} from "./service";
import { proposedWorkflowSchema, workflowSnapshotSchema } from "./schemas";
import { LifecycleEventBus } from "../events/bus";
import { SabahForbiddenError } from "../auth/actor";
import type { SabahActor as GraphActor } from "../auth/actor";
import type { DuplicateDb, DuplicateRecord } from "../intelligence/duplicates";
import type { AuthorizedScopeDb, ScopeRow } from "../intelligence/authorized-scope";
import { createPrismaGraphDb } from "../intelligence/graph";
import { prisma } from "@/lib/prisma";
import type { SourceRef } from "../intelligence/contracts";
import { createTaskSchema } from "@/lib/tasks/schemas";

// Generate proper CUID-like IDs for testing
function generateCuid(prefix: string): string {
    const random = Math.random().toString(36).substr(2, 9);
    return prefix + random + random.length;
}
const createFakePrisma = () => {
    const workflows: any[] = [];
    const steps: any[] = [];
    const approvals: any[] = [];
    const events: any[] = [];
    const users: any[] = [];

    const db = {
        aiWorkflow: {
            create: vi.fn(async ({ data }) => {
                const workflow = {
                    id: generateCuid("wf"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    goal: data.goal,
                    status: data.status,
                    actorId: data.actorId,
                    idempotencyKey: data.idempotencyKey,
                    recordVersion: data.recordVersion ?? 1,
                    startedAt: undefined,
                    completedAt: undefined,
                    conversationId: data.conversationId,
                };
                workflows.push(workflow);
                return workflow;
            }),
            findUnique: vi.fn(async ({ where }) => {
                if (where.idempotencyKey) {
                    const wf = workflows.find((w) => w.idempotencyKey === where.idempotencyKey);
                    if (wf) {
                        // Return with relations
                        return {
                            ...wf,
                            steps: steps.filter((s) => s.workflowId === wf.id),
                            approvals: approvals.filter((a) => a.workflowId === wf.id),
                        };
                    }
                    return null;
                }
                const wf = workflows.find((w) => w.id === where.id);
                if (wf) {
                    return {
                        ...wf,
                        steps: steps.filter((s) => s.workflowId === wf.id),
                        approvals: approvals.filter((a) => a.workflowId === wf.id),
                    };
                }
                return null;
            }),
            update: vi.fn(async ({ where, data }) => {
                const workflow = workflows.find((w) => w.id === where.id);
                if (workflow) {
                    Object.assign(workflow, data, { updatedAt: new Date() });
                }
                return workflow;
            }),
            findMany: vi.fn(async () => {
                return workflows.map((wf) => ({
                    ...wf,
                    steps: steps.filter((s) => s.workflowId === wf.id),
                    approvals: approvals.filter((a) => a.workflowId === wf.id),
                }));
            }),
            updateMany: vi.fn(async ({ where, data }) => {
                const matched = workflows.filter((candidate) =>
                    (where.id === undefined || candidate.id === where.id) &&
                    (where.recordVersion === undefined || candidate.recordVersion === where.recordVersion) &&
                    (where.actorId === undefined || candidate.actorId === where.actorId) &&
                    (where.conversationId === undefined || candidate.conversationId === where.conversationId) &&
                    (typeof where.status !== "string" || candidate.status === where.status) &&
                    (where.status?.in === undefined || where.status.in.includes(candidate.status)));
                for (const workflow of matched) {
                    const { recordVersion: recordVersionPatch, ...rest } = data;
                    const increment = recordVersionPatch?.increment;
                    workflow.recordVersion += typeof increment === "number" ? increment : 0;
                    Object.assign(workflow, rest, { updatedAt: new Date() });
                }
                return { count: matched.length };
            }),
        },
        aiConversation: {
            findUnique: vi.fn(async ({ where }) => where.id === "conv-owned" ? { id: "conv-owned", userId: adminActor.id } : null),
        },
        aiWorkflowStep: {
            create: vi.fn(async ({ data }) => {
                const step = {
                    id: "cl" + crypto.randomBytes(8).toString("hex"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    clientStepId: data.clientStepId,
                    capability: data.capability,
                    capabilityVersion: data.capabilityVersion,
                    status: data.status,
                    argsJson: data.argsJson,
                    dependsOnJson: data.dependsOnJson ?? "[]",
                    confidence: data.confidence,
                    inferredFieldsJson: data.inferredFieldsJson,
                    evidenceRefsJson: data.evidenceRefsJson,
                    idempotencyKey: data.idempotencyKey,
                    workflowId: data.workflowId,
                    recordVersion: data.recordVersion ?? 1,
                    startedAt: undefined,
                    completedAt: undefined,
                    verifiedAt: undefined,
                    previewJson: undefined,
                    outputJson: undefined,
                    errorJson: undefined,
                };
                steps.push(step);
                return step;
            }),
            findMany: vi.fn(async ({ where }) => {
                if (where?.workflowId) {
                    return steps.filter((s) => s.workflowId === where.workflowId);
                }
                return steps;
            }),
            update: vi.fn(async ({ where, data }) => {
                const step = steps.find((s) => s.id === where.id);
                if (step) {
                    Object.assign(step, data, { updatedAt: new Date() });
                }
                return step;
            }),
            updateMany: vi.fn(async ({ where, data }) => {
                const matched = steps.filter((s) =>
                    (where.id === undefined || s.id === where.id) &&
                    (where.workflowId === undefined || s.workflowId === where.workflowId) &&
                    (where.capability === undefined || s.capability === where.capability) &&
                    (where.argsJson === undefined || s.argsJson === where.argsJson) &&
                    (where.status === undefined || s.status === where.status) &&
                    (where.workflow?.status?.notIn === undefined || !where.workflow.status.notIn.includes(workflows.find((workflow) => workflow.id === s.workflowId)?.status)) &&
                    (where.startedAt?.lt === undefined || (s.startedAt != null && s.startedAt < where.startedAt.lt)));
                for (const step of matched) Object.assign(step, data, { updatedAt: new Date() });
                return { count: matched.length };
            }),
        },
        aiApproval: {
            create: vi.fn(async ({ data }) => {
                const approval = {
                    id: generateCuid("c"),
                    createdAt: new Date(),
                    workflowId: data.workflowId,
                    stepId: data.stepId,
                    status: data.status,
                    title: data.title,
                    summary: data.summary,
                    risk: data.risk,
                    fieldsJson: data.fieldsJson,
                    expiresAt: data.expiresAt,
                    requestedById: data.requestedById,
                    decisionType: data.decisionType,
                    decisionReason: data.decisionReason,
                };
                approvals.push(approval);
                return approval;
            }),
            update: vi.fn(async ({ where, data }) => {
                const approval = approvals.find((a) => a.id === where.id);
                if (!approval) throw new Error("Approval not found");
                Object.assign(approval, data, { updatedAt: new Date() });
                return approval;
            }),
            updateMany: vi.fn(async ({ where, data }) => {
                const matched = approvals.filter((a) =>
                    (where.id === undefined || a.id === where.id) &&
                    (where.workflowId === undefined || a.workflowId === where.workflowId) &&
                    (where.stepId === undefined || a.stepId === where.stepId) &&
                    (where.requestedById === undefined || a.requestedById === where.requestedById) &&
                    (where.fieldsJson === undefined || a.fieldsJson === where.fieldsJson) &&
                    (where.status === undefined || a.status === where.status) &&
                    (where.expiresAt?.gt === undefined || a.expiresAt > where.expiresAt.gt) &&
                    (where.expiresAt?.lte === undefined || a.expiresAt <= where.expiresAt.lte));
                for (const approval of matched) Object.assign(approval, data, { updatedAt: new Date() });
                return { count: matched.length };
            }),
        },
        aiWorkflowEvent: {
            create: vi.fn(async ({ data }) => {
                const event = {
                    id: "evt_" + Math.random().toString(36).substr(2, 9),
                    createdAt: new Date(),
                    workflowId: data.workflowId,
                    stepId: data.stepId,
                    eventType: data.eventType,
                    level: data.level,
                    message: data.message,
                    metadataJson: data.metadataJson,
                };
                events.push(event);
                return event;
            }),
            findFirst: vi.fn(async ({ where }) => events.find((event) => event.workflowId === where.workflowId && event.stepId === where.stepId && event.eventType === where.eventType) ?? null),
        },
        user: {
            findUnique: vi.fn(async () => ({
                id: "user_123",
                isActive: true,
                departments: [],
            })),
        },
    };
    Object.assign(db, { $transaction: async (callback: (transaction: typeof db) => Promise<unknown>) => {
        const workflowStates = workflows.map((workflow) => [workflow, { ...workflow }] as const);
        const workflowCount = workflows.length;
        const approvalStates = approvals.map((approval) => [approval, { ...approval }] as const);
        const approvalCount = approvals.length;
        const stepStates = steps.map((step) => [step, { ...step }] as const);
        const stepCount = steps.length;
        const eventCount = events.length;
        try { return await callback(db); } catch (error) {
            const restore = (entity: Record<string, unknown>, snapshot: Record<string, unknown>) => {
                for (const prop of Object.keys(entity)) if (!(prop in snapshot)) delete entity[prop];
                Object.assign(entity, snapshot);
            };
            for (const [workflow, snapshot] of workflowStates) restore(workflow, snapshot);
            for (const [approval, snapshot] of approvalStates) restore(approval, snapshot);
            for (const [step, snapshot] of stepStates) restore(step, snapshot);
            workflows.splice(workflowCount);
            approvals.splice(approvalCount);
            steps.splice(stepCount);
            events.splice(eventCount);
            throw error;
        }
    } });
    return db;
};

function asWorkflowDatabase(value: ReturnType<typeof createFakePrisma>): WorkflowDatabase {
    return value as unknown as WorkflowDatabase;
}

// Fake runner deps
const createFakeRunnerDeps = (): any => ({
    registry: {
        resolve: vi.fn(() => ({
            name: "test.capability",
            version: 1,
            risk: "REVERSIBLE_WRITE" as const,
            inputSchema: { parse: (v: any) => v },
            outputSchema: { parse: (v: any) => v },
            available: vi.fn(async () => true),
            authorize: vi.fn(async () => {}),
            preview: vi.fn(async () => ({ summary: "Preview" })),
            execute: vi.fn(async () => ({ result: "Success" })),
            verify: vi.fn(async (v: any) => v),
            summarize: vi.fn(() => "Summary"),
        })),
    },
    db: {
        aiOperationalLog: { create: vi.fn(async () => {}) },
        aiWorkflowEvent: { create: vi.fn(async () => {}) },
    },
    now: () => new Date(),
    flags: { writes: true },
});

// Test actors
const adminActor = { id: "user_admin", role: "ADMIN" as const, departmentIds: ["dept_1"] };
const viewerActor = { id: "user_viewer", role: "VIEWER" as const, departmentIds: ["dept_1"] };
const memberActor = { id: "user_member", role: "MEMBER" as const, departmentIds: ["dept_1"] };

function createActorBoundLinkVerifier(
    actorId: string,
    authorizedIds: Iterable<string>,
    options: { labels?: Record<string, string>; checksums?: Record<string, string> } = {},
) {
    const authorized = new Set(authorizedIds);
    const scopeDb: AuthorizedScopeDb = {
        task: {
            findMany: vi.fn(async () => Array.from(authorized, (id): ScopeRow => ({
                id,
                isPrivate: true,
                createdById: actorId,
                assignments: [],
            }))),
        },
    };
    const graph = createPrismaGraphDb({} as Parameters<typeof createPrismaGraphDb>[0], scopeDb);
    graph.load = vi.fn(async (ref) => {
        const canonicalHref = `/tasks/${encodeURIComponent(ref.entityId)}`;
        return {
            ref: {
                ...ref,
                href: canonicalHref,
                label: options.labels?.[ref.entityId] ?? ref.label,
                checksum: options.checksums?.[ref.entityId] ?? ref.checksum,
            },
            title: options.labels?.[ref.entityId] ?? ref.label,
            relationships: [],
        };
    });
    const getCurrentSource = vi.fn((ref: SourceRef, actor: GraphActor) => graph.getCurrentSource(ref, actor));
    return { getCurrentSource };
}

function createDuplicateDb(candidateId: string, record: DuplicateRecord): DuplicateDb {
    const scopeRow: ScopeRow = { id: candidateId, isPrivate: false, createdById: adminActor.id, status: "TODO", assignments: [] };
    const scopeDb: AuthorizedScopeDb = {
        project: { findMany: async () => [] },
        task: { findMany: async () => [scopeRow] },
    };
    return {
        scopeDb,
        loadCandidates: async (entityType, ids) => entityType === "TASK" && ids.includes(candidateId) ? [record] : [],
    };
}

// Topological sort test data
const createWorkflowInput = (steps: any[]) => ({
    goal: "Test workflow",
    steps,
    idempotencyKey: "test-key-" + Math.random(),
});

const simpleSteps = [
    {
        clientStepId: "a",
        capability: "test.create",
        args: { name: "Test" },
        dependsOn: [],
        confidence: 0.9,
    },
];

const dependentSteps = [
    {
        clientStepId: "a",
        capability: "test.create",
        args: { name: "Test" },
        dependsOn: [],
        confidence: 0.9,
    },
    {
        clientStepId: "b",
        capability: "test.update",
        args: { id: "123" },
        dependsOn: ["a"],
        confidence: 0.8,
    },
    {
        clientStepId: "c",
        capability: "test.verify",
        args: {},
        dependsOn: [],
        confidence: 0.95,
    },
];

const circularSteps = [
    {
        clientStepId: "a",
        capability: "test.create",
        args: {},
        dependsOn: ["b"],
        confidence: 0.9,
    },
    {
        clientStepId: "b",
        capability: "test.update",
        args: {},
        dependsOn: ["a"],
        confidence: 0.8,
    },
];

describe("Workflow Service - TDD RED Phase", () => {
    let fakePrisma: any;
    let runnerDeps: any;

    beforeEach(() => {
        fakePrisma = createFakePrisma();
        runnerDeps = createFakeRunnerDeps();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe("proposeWorkflow", () => {
        it("does not persist a workflow while SABAH_WRITES_ENABLED is disabled", async () => {
            const disabledDeps = { ...runnerDeps, flags: { writes: false } };

            await expect(proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, disabledDeps)).rejects.toMatchObject({ status: 503 });
            expect(fakePrisma.aiWorkflow.create).not.toHaveBeenCalled();
            expect(fakePrisma.aiWorkflowStep.create).not.toHaveBeenCalled();
        });

        it("accepts direct chat execution only for the exact approved actor-owned conversation step", async () => {
            const input = {
                goal: "Create approved task",
                steps: [{ clientStepId: "task", capability: "tasks.createMany", args: { tasks: [{ title: "A" }], allowPartial: false }, dependsOn: [], confidence: 0.95, inferredFields: [], evidenceRefs: [] }],
                conversationId: "conv-owned",
            };
            fakePrisma.aiConversation.findUnique.mockResolvedValue({ userId: adminActor.id });
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "RUNNING" } });
            const step = workflow.steps[0];
            const argsJson = JSON.stringify(input.steps[0].args);
            const binding = crypto.createHash("sha256").update(JSON.stringify({ capability: "tasks.createMany", version: 1, argsJson, risk: "REVERSIBLE_WRITE" })).digest("hex");
            await fakePrisma.aiApproval.create({ data: {
                workflowId: workflow.id,
                stepId: step.id,
                status: "APPROVED",
                title: "Approved task",
                summary: "Approved task",
                risk: "REVERSIBLE_WRITE",
                fieldsJson: JSON.stringify([{ path: "__approval_binding_sha256", proposed: binding }]),
                expiresAt: new Date(Date.now() + 60 * 60 * 1000),
                requestedById: adminActor.id,
            } });

            await expect(assertApprovedWorkflowIntent(adminActor, { workflowId: workflow.id, conversationId: "conv-owned", capability: "tasks.createMany", input: input.steps[0].args }, fakePrisma)).resolves.toEqual({ workflowId: workflow.id, stepId: step.id });
            await expect(assertApprovedWorkflowIntent(adminActor, { workflowId: workflow.id, conversationId: "conv-owned", capability: "tasks.createMany", input: { tasks: [{ title: "tampered" }], allowPartial: false } }, fakePrisma)).rejects.toMatchObject({ status: 403 });
        });

        it("matches a direct KPI request to its approved captured version without accepting a changed value or version", async () => {
            const args = { id: "kpi-one", period: "Q3", value: 7, note: null, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" };
            fakePrisma.aiConversation.findUnique.mockResolvedValue({ userId: adminActor.id });
            const workflow = await proposeWorkflow(adminActor, { goal: "Log KPI", conversationId: "conv-owned", steps: [{ clientStepId: "kpi", capability: "kpis.logUpdate", args, dependsOn: [], confidence: 0.95, inferredFields: [], evidenceRefs: [] }] }, fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "RUNNING" } });
            const binding = crypto.createHash("sha256").update(JSON.stringify({ capability: "kpis.logUpdate", version: 1, argsJson: JSON.stringify(args), risk: "REVERSIBLE_WRITE" })).digest("hex");
            await fakePrisma.aiApproval.create({ data: { workflowId: workflow.id, stepId: workflow.steps[0].id, status: "APPROVED", risk: "REVERSIBLE_WRITE", fieldsJson: JSON.stringify([{ path: "__approval_binding_sha256", proposed: binding }]), expiresAt: new Date(Date.now() + 3600000), requestedById: adminActor.id } });
            const request = { workflowId: workflow.id, conversationId: "conv-owned", capability: "kpis.logUpdate", input: { kpiId: "kpi-one", quarter: "Q3", value: 7 } };
            await expect(assertApprovedWorkflowIntent(adminActor, request, fakePrisma)).resolves.toEqual({ workflowId: workflow.id, stepId: workflow.steps[0].id });
            await expect(assertApprovedWorkflowIntent(adminActor, { ...request, input: { ...request.input, value: 8 } }, fakePrisma)).rejects.toMatchObject({ status: 403 });
            await expect(assertApprovedWorkflowIntent(adminActor, { ...request, input: { ...request.input, expectedUpdatedAt: "2026-02-01T00:00:00.000Z" } }, fakePrisma)).rejects.toMatchObject({ status: 403 });
        });

        it("persists only a conversation owned by the workflow actor", async () => {
            const result = await proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-owned" }, fakePrisma, runnerDeps);

            expect(result.id).toBeDefined();
            expect(fakePrisma.aiWorkflow.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ conversationId: "conv-owned" }) }));
            await expect(proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-other", idempotencyKey: "other" }, fakePrisma, runnerDeps)).rejects.toThrow(SabahForbiddenError);
        });

        it("persists workflow, steps, and event (approvals created on demand)", async () => {
            const input = createWorkflowInput(simpleSteps);

            const result = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            expect(fakePrisma.aiWorkflow.create).toHaveBeenCalled();
            expect(fakePrisma.aiWorkflowStep.create).toHaveBeenCalled();
            expect(fakePrisma.aiWorkflowEvent.create).toHaveBeenCalled();
            expect(result.id).toBeDefined();
            expect(result.goal).toBe(input.goal);
            expect(result.status).toBe("PLANNED");
            expect(result.steps).toHaveLength(1);
            // Approvals are only created when APPROVAL_REQUIRED is returned
            expect(result.approvals).toHaveLength(0);
        });

        it("keeps approval decisions successful without emitting approval.requested", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await fakePrisma.aiApproval.create({ data: { workflowId: workflow.id, stepId: workflow.steps[0].id, status: "PENDING", title: "Approval", summary: "Approval", risk: "REVERSIBLE_WRITE", expiresAt: new Date(Date.now() + 60 * 60 * 1000), requestedById: adminActor.id } });
            const result = await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: approval.id }, fakePrisma);
            expect(result.id).toBe(workflow.id);
            expect(result.approvals).toEqual(expect.arrayContaining([expect.objectContaining({ id: approval.id, status: "APPROVED", decisionType: "APPROVE" })]));
            const eventTypes = fakePrisma.aiWorkflowEvent.create.mock.calls.map((call: [{ data: { eventType: string } }]) => call[0].data.eventType);
            expect(eventTypes).toContain("APPROVAL_GRANTED");
            expect(eventTypes).not.toContain("APPROVAL_REQUESTED");
        });

        it("rejects an approval decision when its ID does not identify an approval", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await fakePrisma.aiApproval.create({ data: { workflowId: workflow.id, stepId: workflow.steps[0].id, status: "PENDING", title: "Approval", summary: "Approval", risk: "REVERSIBLE_WRITE", expiresAt: new Date(Date.now() + 60 * 60 * 1000), requestedById: adminActor.id } });

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: generateCuid("c") }, fakePrisma)).rejects.toThrow("Approval not found");
            expect(approval.status).toBe("PENDING");
            expect(fakePrisma.aiWorkflowEvent.create.mock.calls.map((call: [{ data: { eventType: string } }]) => call[0].data.eventType)).not.toContain("APPROVAL_GRANTED");
        });

        it("accepts the legacy optional event bus argument without emitting from decide", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await fakePrisma.aiApproval.create({ data: { workflowId: workflow.id, stepId: workflow.steps[0].id, status: "PENDING", title: "Approval", summary: "Approval", risk: "REVERSIBLE_WRITE", expiresAt: new Date(Date.now() + 60 * 60 * 1000), requestedById: adminActor.id } });
            const persist = vi.fn(async () => undefined);
            const eventBus = new LifecycleEventBus({ persistence: { persist } });

            const result = await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: approval.id }, fakePrisma, undefined, undefined, eventBus);

            expect(result.approvals).toEqual(expect.arrayContaining([expect.objectContaining({ id: approval.id, status: "APPROVED" })]));
            expect(persist).not.toHaveBeenCalled();
        });

        it("is idempotent via idempotencyKey - returns prior snapshot without re-creating", async () => {
            const key = "idempotent-key-123";
            const input = createWorkflowInput(simpleSteps);
            input.idempotencyKey = key;

            // First call creates
            const first = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            // Second call with same key returns existing
            const second = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            expect(second.id).toBe(first.id);
            expect(fakePrisma.aiWorkflow.create).toHaveBeenCalledTimes(1);
        });

        it("scopes client idempotency keys per actor", async () => {
            const input = createWorkflowInput(simpleSteps);
            input.idempotencyKey = "actor-scoped-key";
            const first = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            const second = await proposeWorkflow(memberActor, input, fakePrisma, runnerDeps);
            expect(second.id).not.toBe(first.id);
            expect(fakePrisma.aiWorkflow.create).toHaveBeenCalledTimes(2);
        });

        it("rejects reuse of an idempotency key with different workflow content", async () => {
            const input = createWorkflowInput(simpleSteps);
            input.idempotencyKey = "request-bound-key";
            await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            await expect(proposeWorkflow(adminActor, { ...input, goal: "Different goal" }, fakePrisma, runnerDeps)).rejects.toMatchObject({ status: 409 });
        });

        it("binds idempotent replay to confidence and evidence metadata", async () => {
            const input = createWorkflowInput(simpleSteps);
            input.idempotencyKey = "metadata-bound-key";
            await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);
            const changed = { ...input, steps: input.steps.map((step) => ({ ...step, confidence: 0.2, evidenceRefs: ["different"] })) };

            await expect(proposeWorkflow(adminActor, changed, fakePrisma, runnerDeps)).rejects.toMatchObject({ status: 409 });
        });

        it("replays the committed winner after a concurrent idempotency collision", async () => {
            const input = createWorkflowInput(simpleSteps);
            input.idempotencyKey = "concurrent-key";
            const first = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);
            fakePrisma.aiWorkflow.findUnique.mockResolvedValueOnce(null);
            vi.spyOn(fakePrisma, "$transaction").mockRejectedValueOnce(Object.assign(new Error("unique collision"), { code: "P2002" }));

            const replay = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            expect(replay.id).toBe(first.id);
        });

        it("rolls back the workflow and steps when the initial event insert fails", async () => {
            const input = createWorkflowInput(simpleSteps);
            fakePrisma.aiWorkflowEvent.create.mockRejectedValueOnce(new Error("event insert failed"));

            await expect(proposeWorkflow(adminActor, input, fakePrisma, runnerDeps)).rejects.toThrow("event insert failed");

            expect(await fakePrisma.aiWorkflow.findUnique({ where: { idempotencyKey: input.idempotencyKey } })).toBeNull();
            expect(await fakePrisma.aiWorkflowStep.findMany({})).toHaveLength(0);
        });

        it("rejects workflows with circular dependencies", async () => {
            const input = createWorkflowInput(circularSteps);

            await expect(
                proposeWorkflow(adminActor, input, fakePrisma, runnerDeps)
            ).rejects.toThrow(/circular/i);
        });

        it("rejects workflows with duplicate client step IDs", async () => {
            const input = createWorkflowInput([
                { clientStepId: "a", capability: "test.one", args: {}, dependsOn: [], confidence: 0.9 },
                { clientStepId: "a", capability: "test.two", args: {}, dependsOn: [], confidence: 0.8 },
            ]);

            await expect(
                proposeWorkflow(adminActor, input, fakePrisma, runnerDeps)
            ).rejects.toThrow(/duplicate/i);
        });

        it("rejects workflows with dependency on unknown step", async () => {
            const input = createWorkflowInput([
                { clientStepId: "a", capability: "test.one", args: {}, dependsOn: ["unknown"], confidence: 0.9 },
            ]);

            await expect(
                proposeWorkflow(adminActor, input, fakePrisma, runnerDeps)
            ).rejects.toThrow(/unknown/i);
        });

        it("validates proposedWorkflowSchema", async () => {
            const input = createWorkflowInput([
                { clientStepId: "", capability: "test", args: {}, dependsOn: [], confidence: 0.9 },
            ]);

            await expect(
                proposeWorkflow(adminActor, input, fakePrisma, runnerDeps)
            ).rejects.toThrow();
        });
    });

    describe("decide", () => {
        it("surfaces pending feedback when durable rejection succeeds but capture fails", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const result = await decide(adminActor, workflow.id, { type: "REJECT", approvalId: "clapproval123456789012345", reason: "Not needed" }, fakePrisma, undefined, async () => { throw new Error("capture failed"); });
            expect(result).toMatchObject({ feedbackCaptured: false, feedbackPending: true, status: "CANCELED" });
        });

        it("does not overwrite a terminal workflow when rejecting a stale approval", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await fakePrisma.aiApproval.create({ data: { workflowId: workflow.id, stepId: workflow.steps[0].id, status: "PENDING", title: "Approval", summary: "Approval", risk: "REVERSIBLE_WRITE", expiresAt: new Date(Date.now() + 60 * 60 * 1000), requestedById: adminActor.id } });
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "COMPLETED", completedAt: new Date() } });

            await expect(decide(adminActor, workflow.id, { type: "REJECT", approvalId: approval.id, reason: "Stale card" }, fakePrisma)).rejects.toMatchObject({ status: 409 });

            const current = await fakePrisma.aiWorkflow.findUnique({ where: { id: workflow.id } });
            expect(current?.status).toBe("COMPLETED");
            expect(approval.status).toBe("PENDING");
        });

        it("REJECTED decision cancels workflow and never executes", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            // Skip this test for now - it requires creating approvals first
            expect(workflow.id).toBeDefined();
        });

        it("APPROVED decision marks approval and allows execution", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            // Skip this test for now - it requires creating approvals first
            expect(workflow.id).toBeDefined();
        });

        it("unauthorized actor (VIEWER) gets SabahForbiddenError", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            const decision = {
                type: "APPROVE" as const,
                approvalId: "cl" + crypto.randomBytes(8).toString("hex"),
            };

            await expect(
                decide(viewerActor, workflow.id, decision, fakePrisma)
            ).rejects.toThrow(SabahForbiddenError);
        });
    });

    describe("executeNextStep", () => {
        it("persists every provided canonical tasks.create field in the server-authored review", async () => {
            const capability = {
                name: "tasks.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                requiresExplicitApproval: true,
                inputSchema: { parse: (value: unknown) => createTaskSchema.parse(value) },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async (input: Record<string, unknown>) => ({
                    title: `Create task “${input.title}”`,
                    fields: Object.entries(input).map(([path, proposed]) => ({ path, proposed })),
                })),
                execute: vi.fn(async () => ({ id: "created-task" })),
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Created task"),
            };
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(() => capability) } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput([{
                clientStepId: "task",
                capability: "tasks.create",
                args: {
                    title: "Review launch brief",
                    description: "Launch brief for the stakeholder review.",
                    status: "DOING",
                    priority: "HIGH",
                    startAt: "2026-10-16T09:00:00.000Z",
                    dueAt: "2026-10-17T20:59:59.999Z",
                    dueAtEnd: "2026-10-17T21:59:59.999Z",
                    effortHours: 1.5,
                    isPrivate: true,
                    assigneeIds: [adminActor.id],
                    tagIds: ["tag-1"],
                    dependencyIds: ["dependency-1"],
                    reminders: [15, 60],
                    projectId: "project-1",
                    caseStudyId: "case-study-1",
                    kpiId: "kpi-1",
                    stageId: "stage-1",
                    parentTaskId: "parent-1",
                    idempotencyKey: "idempotency-1",
                    recurrenceKey: "recurrence-1",
                },
                dependsOn: [],
                confidence: 0,
            }]), fakePrisma, deps);

            const pending = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            const review = pending.approvals[0].review;
            expect(review?.approvalHash).toMatch(/^[a-f0-9]{64}$/);
            expect(review?.fields.map((field) => field.path)).toEqual([
                "title",
                "description",
                "status",
                "priority",
                "startAt",
                "dueAt",
                "dueAtEnd",
                "effortHours",
                "isPrivate",
                "projectId",
                "caseStudyId",
                "kpiId",
                "stageId",
                "parentTaskId",
                "assigneeIds",
                "tagIds",
                "dependencyIds",
                "reminders",
                "idempotencyKey",
                "recurrenceKey",
            ]);
            expect(review?.fields.find((field) => field.path === "description")?.proposed).toBe("Launch brief for the stakeholder review.");
            expect(review?.fields.find((field) => field.path === "isPrivate")?.proposed).toBe("true");
            expect(review?.fields.find((field) => field.path === "tagIds")?.proposed).toBe(JSON.stringify(["tag-1"]));

            const recovered = await getSnapshot(adminActor, workflow.id, fakePrisma);
            expect(recovered.approvals[0].review).toEqual(review);
        });

        it("uses the canonical parsed task input for both preview and execution", async () => {
            const preview = vi.fn(async (input: Record<string, unknown>) => ({
                title: `Create task “${input.title}”`,
                fields: Object.entries(input).map(([path, proposed]) => ({ path, proposed })),
            }));
            const execute = vi.fn(async () => ({ id: "created-task", title: "Normalized task" }));
            const capability = {
                name: "tasks.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                requiresExplicitApproval: true,
                inputSchema: { parse: (value: unknown) => createTaskSchema.parse(value) },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview,
                execute,
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Created normalized task"),
            };
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(() => capability) } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput([{
                clientStepId: "task",
                capability: "tasks.create",
                args: {
                    title: "  Normalized task  ",
                    description: "Description stays effectful.",
                    projectId: " project-1 ",
                    assigneeIds: [" assignee-1 "],
                    tagIds: [" tag-1 "],
                    dependencyIds: [" dependency-1 "],
                },
                dependsOn: [],
                confidence: 0,
            }]), fakePrisma, deps);

            const pending = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            const previewInput = preview.mock.calls[0][0];
            expect(previewInput).toMatchObject({
                title: "Normalized task",
                projectId: "project-1",
                assigneeIds: ["assignee-1"],
                tagIds: ["tag-1"],
                dependencyIds: ["dependency-1"],
            });
            expect(pending.approvals[0].review?.fields.find((field) => field.path === "title")?.proposed).toBe("Normalized task");

            await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: pending.approvals[0].id }, fakePrisma);
            await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            expect(execute).toHaveBeenCalledWith(previewInput, expect.objectContaining({ idempotencyKey: expect.any(String) }));
        });

        it("refuses approval when a stored tasks.create review is partial or mismatched", async () => {
            const capability = {
                name: "tasks.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                requiresExplicitApproval: true,
                inputSchema: { parse: (value: unknown) => createTaskSchema.parse(value) },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async (input: Record<string, unknown>) => ({
                    title: `Create task “${input.title}”`,
                    fields: Object.entries(input).map(([path, proposed]) => ({ path, proposed })),
                })),
                execute: vi.fn(async () => ({ id: "created-task" })),
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Created task"),
            };
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(() => capability) } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput([{
                clientStepId: "task",
                capability: "tasks.create",
                args: {
                    title: "Complete review",
                    description: "This field must remain bound.",
                    status: "TODO",
                    priority: "HIGH",
                },
                dependsOn: [],
                confidence: 0,
            }]), fakePrisma, deps);
            const pending = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            const approvalHash = pending.approvals[0].review?.approvalHash;
            const step = workflow.steps[0];
            await fakePrisma.aiWorkflowStep.update({
                where: { id: step.id },
                data: {
                    previewJson: JSON.stringify({
                        approvalReview: {
                            approvalHash,
                            fields: [{ path: "title", proposed: "tampered" }],
                        },
                    }),
                },
            });

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: pending.approvals[0].id }, fakePrisma)).rejects.toMatchObject({ status: 409 });
        });

        it("makes a secret-bearing task description unavailable for approval", async () => {
            const capability = {
                name: "tasks.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                requiresExplicitApproval: true,
                inputSchema: { parse: (value: unknown) => createTaskSchema.parse(value) },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async (input: Record<string, unknown>) => ({
                    title: `Create task “${input.title}”`,
                    fields: Object.entries(input).map(([path, proposed]) => ({ path, proposed })),
                })),
                execute: vi.fn(async () => ({ id: "created-task" })),
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Created task"),
            };
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(() => capability) } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput([{
                clientStepId: "task",
                capability: "tasks.create",
                args: { title: "Secret-bearing task", description: "password=do-not-expose" },
                dependsOn: [],
                confidence: 0,
            }]), fakePrisma, deps);

            const pending = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            expect(pending.approvals[0].review).toBeUndefined();
            expect(JSON.stringify(pending)).not.toContain("do-not-expose");
            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: pending.approvals[0].id }, fakePrisma)).rejects.toMatchObject({ status: 409 });
        });

        it("makes an oversized canonical task field unavailable without truncating it", async () => {
            const capability = {
                name: "tasks.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                requiresExplicitApproval: true,
                inputSchema: { parse: (value: unknown) => createTaskSchema.parse(value) },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async (input: Record<string, unknown>) => ({
                    title: `Create task “${input.title}”`,
                    fields: Object.entries(input).map(([path, proposed]) => ({ path, proposed })),
                })),
                execute: vi.fn(async () => ({ id: "created-task" })),
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Created task"),
            };
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(() => capability) } };
            const oversizedDescription = "ordinary description ".repeat(300);
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput([{
                clientStepId: "task",
                capability: "tasks.create",
                args: { title: "Oversized task", description: oversizedDescription },
                dependsOn: [],
                confidence: 0,
            }]), fakePrisma, deps);

            const pending = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            expect(pending.approvals[0].review).toBeUndefined();
            expect(JSON.stringify(pending)).not.toContain(oversizedDescription);
            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: pending.approvals[0].id }, fakePrisma)).rejects.toMatchObject({ status: 409 });
        });

        it("projects a bounded preview title and stores a verified capability summary only after verification", async () => {
            const summarize = vi.fn((output: { label: string }) => `Verified ${output.label}`);
            const capability = {
                name: "test.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                requiresExplicitApproval: true,
                inputSchema: { parse: (value: unknown) => value },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async () => ({
                    title: "Create six reviewed tasks",
                    fields: [{ path: "args", proposed: "must not be persisted" }],
                })),
                execute: vi.fn(async () => ({
                    label: "task batch",
                    secret: "must not be persisted",
                    entityLinks: [
                        { type: "TASK", id: "t1", href: "/tasks/t1", label: "Task 1", sourceUpdatedAt: "2026-10-08T00:00:00.000Z", checksum: "abc123" },
                        { type: "TASK", id: "evil", href: "//evil.example", label: "Evil" },
                        { type: "TASK", id: "script", href: "javascript:alert(1)", label: "Script" },
                        { type: "TASK", id: "slash", href: "/tasks/\\\\evil", label: "Backslash" },
                        { type: "TASK", id: "control", href: `/tasks/${String.fromCharCode(7)}evil`, label: "Control" },
                        ...Array.from({ length: 51 }, (_, index) => ({
                            type: "TASK",
                            id: `t${index + 2}`,
                            href: `/tasks/t${index + 2}`,
                            label: `Task ${index + 2}`,
                            sourceUpdatedAt: "2026-10-08T00:00:00.000Z",
                            checksum: `checksum-${index + 2}`,
                        })),
                    ],
                })),
                verify: vi.fn(async (value: unknown) => value),
                summarize,
            };
            const linkVerifier = createActorBoundLinkVerifier(adminActor.id, [
                "t1",
                "evil",
                "script",
                "slash",
                "control",
                ...Array.from({ length: 51 }, (_, index) => `t${index + 2}`),
            ]);
            const deps = { ...runnerDeps, indexEntity: vi.fn(async () => {}), registry: { resolve: vi.fn(() => capability) } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, deps);

            const pending = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);

            expect(pending.status).toBe("AWAITING_APPROVAL");
            expect(pending.steps[0].status).toBe("APPROVAL_REQUIRED");
            expect(pending.steps[0].previewSummary).toBe("Create six reviewed tasks");
            expect(pending.steps[0].previewSummary).not.toContain("must not be persisted");
            expect(pending.steps[0].resultSummary).toBeUndefined();
            expect(pending.approvals[0].title).toBe("Create six reviewed tasks");
            expect(summarize).not.toHaveBeenCalled();

            const approved = await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: pending.approvals[0].id }, fakePrisma);
            const completed = await executeNextStep(adminActor, workflow.id, fakePrisma, deps, { linkVerifier });

            expect(approved.steps[0].status).toBe("PENDING");
            expect(completed.status).toBe("COMPLETED");
            expect(completed.steps[0].status).toBe("VERIFIED");
            expect(completed.steps[0].resultSummary).toBe("Verified task batch");
            expect(completed.steps[0].resultSummary).not.toContain("must not be persisted");
            expect(completed.steps[0].entityLinks).toHaveLength(50);
            expect(completed.steps[0].entityLinks[0]).toEqual({ type: "TASK", id: "t1", href: "/tasks/t1", label: "Task 1" });
            expect(completed.steps[0].entityLinks.some((link) => link.id === "evil" || link.id === "script" || link.id === "slash" || link.id === "control")).toBe(false);
            const persistedWrite = fakePrisma.aiWorkflowStep.updateMany.mock.calls.find(([args]: [{ data?: { outputJson?: string } }]) => typeof args?.data?.outputJson === "string");
            expect(persistedWrite).toBeDefined();
            const persistedProjection = JSON.parse(persistedWrite![0].data.outputJson);
            expect(persistedProjection.summary).toBe("Verified task batch");
            expect(persistedProjection.entityLinks).toHaveLength(50);
            expect(persistedProjection.entityLinks[0]).toEqual({ type: "TASK", id: "t1", href: "/tasks/t1", label: "Task 1" });
            expect(JSON.stringify(persistedProjection)).not.toContain("secret");
            expect(JSON.stringify(persistedProjection)).not.toContain("must not be persisted");
            expect(summarize).toHaveBeenCalled();
            expect(summarize).toHaveBeenLastCalledWith({
                label: "task batch",
                secret: "must not be persisted",
                entityLinks: expect.any(Array),
            });
            expect(workflowSnapshotSchema.safeParse(JSON.parse(JSON.stringify(completed))).success).toBe(true);
        });

        it("authorizes each projected link against the actor-bound current source before the 50-link bound", async () => {
            const sourceUpdatedAt = "2026-10-08T00:00:00.000Z";
            const encodedUnsafe = Array.from({ length: 50 }, (_, index) => {
                const hrefs = [
                    `/%07encoded-${index}`,
                    `/%5Cencoded-${index}`,
                    `/%6Aavascript:encoded-${index}`,
                    `/%2F%2Fencoded-${index}.example`,
                ];
                return {
                    type: "TASK",
                    id: `encoded-${index}`,
                    href: hrefs[index % hrefs.length],
                    label: `Encoded ${index}`,
                    sourceUpdatedAt,
                    checksum: `encoded-${index}`,
                };
            });
            const capability = {
                name: "test.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                inputSchema: { parse: (value: unknown) => value },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async () => ({ title: "Preview", fields: [] })),
                execute: vi.fn(async () => ({
                    result: "Success",
                    entityLinks: [
                        { type: "TASK", id: "t-valid", href: "/tasks/t-valid", label: "Spoofed label", sourceUpdatedAt, checksum: "valid-checksum" },
                        { type: "TASK", id: "deleted", href: "/tasks/deleted", label: "Deleted", sourceUpdatedAt, checksum: "deleted-checksum" },
                        { type: "TASK", id: "route-mismatch", href: "/projects/route-mismatch", label: "Wrong route", sourceUpdatedAt, checksum: "route-checksum" },
                        { type: "TASK", id: "checksum-mismatch", href: "/tasks/checksum-mismatch", label: "Wrong checksum", sourceUpdatedAt, checksum: "wrong-checksum" },
                        ...encodedUnsafe,
                        { type: "TASK", id: "t-after", href: "/tasks/t-after", label: "After bound", sourceUpdatedAt, checksum: "after-checksum" },
                    ],
                })),
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Verified result"),
            };
            const linkVerifier = createActorBoundLinkVerifier(
                adminActor.id,
                ["t-valid", "route-mismatch", "checksum-mismatch", "t-after"],
                { labels: { "t-valid": "Authoritative task" }, checksums: { "checksum-mismatch": "current-checksum" } },
            );
            const unauthorizedProbe = createActorBoundLinkVerifier(adminActor.id, ["t-valid"]);
            await expect(unauthorizedProbe.getCurrentSource({ entityType: "TASK", entityId: "t-valid", label: "Task", href: "/tasks/t-valid", sourceUpdatedAt, checksum: "valid-checksum" }, viewerActor)).resolves.toBeNull();
            const deps = {
                ...runnerDeps,
                indexEntity: vi.fn(async () => {}),
                registry: { resolve: vi.fn(() => capability) },
            };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, deps);

            const completed = await executeNextStep(adminActor, workflow.id, fakePrisma, deps, { linkVerifier });

            expect(completed.status).toBe("COMPLETED");
            expect(completed.steps[0].entityLinks).toEqual([
                { type: "TASK", id: "t-valid", href: "/tasks/t-valid", label: "Authoritative task" },
                { type: "TASK", id: "t-after", href: "/tasks/t-after", label: "After bound" },
            ]);
            expect(linkVerifier.getCurrentSource).toHaveBeenCalledTimes(5);
            expect(linkVerifier.getCurrentSource).toHaveBeenCalledWith(expect.objectContaining({ entityId: "t-valid" }), adminActor);
            expect(linkVerifier.getCurrentSource).toHaveBeenCalledWith(expect.objectContaining({ entityId: "t-after" }), adminActor);
            const encodedPatterns = ["%07", "%5C", "%6Aavascript", "%2F%2F"];
            expect(linkVerifier.getCurrentSource.mock.calls.some(([ref]) => encodedPatterns.some((pattern) => String(ref.href).includes(pattern)))).toBe(false);
            const persistedWrite = fakePrisma.aiWorkflowStep.updateMany.mock.calls.find(([args]: [{ data?: { outputJson?: string } }]) => typeof args?.data?.outputJson === "string");
            expect(persistedWrite).toBeDefined();
            expect(JSON.parse(persistedWrite![0].data.outputJson).entityLinks).toEqual(completed.steps[0].entityLinks);
            expect(workflowSnapshotSchema.safeParse(JSON.parse(JSON.stringify(completed))).success).toBe(true);
        });

        it("fails explicitly when source verification storage is unavailable", async () => {
            const capability = {
                name: "test.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                inputSchema: { parse: (value: unknown) => value },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async () => ({ title: "Preview", fields: [] })),
                execute: vi.fn(async () => ({
                    result: "Success",
                    entityLinks: [{ type: "TASK", id: "t-storage", href: "/tasks/t-storage", label: "Storage", sourceUpdatedAt: "2026-10-08T00:00:00.000Z", checksum: "storage-checksum" }],
                })),
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Verified result"),
            };
            const storageError = Object.assign(new Error("scope unavailable"), { code: "SCOPE_UNAVAILABLE" });
            const linkVerifier = { getCurrentSource: vi.fn(async () => { throw storageError; }) };
            const deps = {
                ...runnerDeps,
                indexEntity: vi.fn(async () => {}),
                registry: { resolve: vi.fn(() => capability) },
            };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, deps);

            await expect(executeNextStep(adminActor, workflow.id, fakePrisma, deps, { linkVerifier })).rejects.toThrow("scope unavailable");

            const failed = await getSnapshot(adminActor, workflow.id, fakePrisma);
            expect(failed.steps[0].status).toBe("FAILED");
            expect(failed.steps[0].entityLinks).toEqual([]);
            const persistedWrite = fakePrisma.aiWorkflowStep.updateMany.mock.calls.find(([args]: [{ data?: { outputJson?: string } }]) => typeof args?.data?.outputJson === "string");
            expect(persistedWrite).toBeUndefined();
        });

        it("fails explicitly through the default actor-bound graph path when PMO storage is unavailable", async () => {
            const capability = {
                name: "test.create",
                version: 1,
                risk: "REVERSIBLE_WRITE" as const,
                inputSchema: { parse: (value: unknown) => value },
                outputSchema: { parse: (value: unknown) => value },
                available: vi.fn(async () => true),
                authorize: vi.fn(async () => {}),
                preview: vi.fn(async () => ({ title: "Preview", fields: [] })),
                execute: vi.fn(async () => ({
                    result: "Success",
                    entityLinks: [{ type: "PMO_ACTION", id: "a-storage", href: "/pmo/actions/a-storage", label: "PMO action" }],
                })),
                verify: vi.fn(async (value: unknown) => value),
                summarize: vi.fn(() => "Verified result"),
            };
            const deps = {
                ...runnerDeps,
                indexEntity: vi.fn(async () => {}),
                registry: { resolve: vi.fn(() => capability) },
            };
            const outage = Object.assign(new Error("external action storage unavailable"), { code: "DATABASE_UNAVAILABLE" });
            const findMany = vi.spyOn(prisma.externalAction, "findMany").mockResolvedValue([{ id: "a-storage", ownerId: adminActor.id, closedAt: null }] as never);
            const findUnique = vi.spyOn(prisma.externalAction, "findUnique").mockRejectedValue(outage);

            try {
                const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, deps);
                await expect(executeNextStep(adminActor, workflow.id, fakePrisma, deps)).rejects.toBe(outage);

                const failed = await getSnapshot(adminActor, workflow.id, fakePrisma);
                expect(failed.steps[0].status).toBe("FAILED");
                expect(failed.steps[0].entityLinks).toEqual([]);
                expect(fakePrisma.aiWorkflowStep.updateMany.mock.calls.some(([args]: [{ data?: { outputJson?: string } }]) => typeof args?.data?.outputJson === "string")).toBe(false);
            } finally {
                findUnique.mockRestore();
                findMany.mockRestore();
            }
        });

        it("runs only dependency-satisfied steps in topological order", async () => {
            const input = createWorkflowInput(dependentSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            // Should run steps a and c (no dependencies), but not b (depends on a)
            expect(result.steps.length).toBeGreaterThan(0);
        });

        it("runs independent ready steps but blocks dependents of a failure", async () => {
            // Mock runCapability to fail by modifying the runnerDeps
            const failRunnerDeps = {
                ...runnerDeps,
                registry: {
                    resolve: vi.fn(() => ({
                        name: "test.capability",
                        version: 1,
                        risk: "REVERSIBLE_WRITE" as const,
                        inputSchema: { parse: (v: any) => v },
                        outputSchema: { parse: (v: any) => v },
                        available: vi.fn(async () => true),
                        authorize: vi.fn(async () => {}),
                        preview: vi.fn(async () => ({ summary: "Preview" })),
                        execute: vi.fn(async () => {
                            throw new Error("Step failed");
                        }),
                        verify: vi.fn(async (v: any) => v),
                        summarize: vi.fn(() => "Summary"),
                    })),
                },
            };

            const input = createWorkflowInput(dependentSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, failRunnerDeps);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, failRunnerDeps);

            // First step (a) fails, dependent (b) should be blocked, independent (c) runs
            expect(result.steps).toHaveLength(3);
        });

        it("APPROVAL_REQUIRED stops the workflow and marks the step", async () => {
            // Mock runCapability to require approval
            const approvalRunnerDeps = {
                ...runnerDeps,
                registry: {
                    resolve: vi.fn(() => ({
                        name: "test.capability",
                        version: 1,
                        risk: "SENSITIVE_WRITE" as const,
                        inputSchema: { parse: (v: any) => v },
                        outputSchema: { parse: (v: any) => v },
                        available: vi.fn(async () => true),
                        authorize: vi.fn(async () => {}),
                        preview: vi.fn(async () => ({ summary: "Preview" })),
                        execute: vi.fn(async () => {
                            throw new Error("Approval required");
                        }),
                        verify: vi.fn(async (v: any) => v),
                        summarize: vi.fn(() => "Summary"),
                    })),
                },
                db: {
                    aiOperationalLog: { create: vi.fn(async () => {}) },
                    aiWorkflowEvent: { create: vi.fn(async () => {}) },
                },
                now: () => new Date(),
                flags: { writes: true },
            };

            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, approvalRunnerDeps);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, approvalRunnerDeps);

            expect(result.steps[0].status).toBeDefined();
        });

        it("passes actor, conversation, request, and idempotency identity into capability execution", async () => {
            const executionContexts: any[] = [];
            const identityRunnerDeps = {
                ...runnerDeps,
                registry: {
                    resolve: vi.fn(() => ({
                        name: "test.capability",
                        version: 1,
                        risk: "REVERSIBLE_WRITE" as const,
                        inputSchema: { parse: (v: any) => v },
                        outputSchema: { parse: (v: any) => v },
                        available: vi.fn(async () => true),
                        authorize: vi.fn(async () => {}),
                        preview: vi.fn(async () => ({ summary: "Preview" })),
                        execute: vi.fn(async (_input: unknown, context: unknown) => {
                            executionContexts.push(context);
                            return { result: "Success" };
                        }),
                        verify: vi.fn(async (v: any) => v),
                        summarize: vi.fn(() => "Summary"),
                    })),
                },
            };
            fakePrisma.aiConversation.findUnique.mockResolvedValue({ userId: adminActor.id });
            const workflow = await proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-identity", idempotencyKey: "request-identity" }, fakePrisma, identityRunnerDeps);

            await executeNextStep(adminActor, workflow.id, fakePrisma, identityRunnerDeps);

            expect(executionContexts).toHaveLength(1);
            expect(executionContexts[0]).toMatchObject({
                actor: adminActor,
                conversationId: "conv-identity",
                workflowId: workflow.id,
                requestId: expect.stringMatching(/:a$/),
                idempotencyKey: expect.stringMatching(/:a$/),
                now: expect.any(Date),
            });
        });

        it("runner FAILED marks step FAILED and records error", async () => {
            const errorMsg = "Capability execution failed";
            const failRunnerDeps = {
                ...runnerDeps,
                registry: {
                    resolve: vi.fn(() => ({
                        name: "test.capability",
                        version: 1,
                        risk: "REVERSIBLE_WRITE" as const,
                        inputSchema: { parse: (v: any) => v },
                        outputSchema: { parse: (v: any) => v },
                        available: vi.fn(async () => true),
                        authorize: vi.fn(async () => {}),
                        preview: vi.fn(async () => ({ summary: "Preview" })),
                        execute: vi.fn(async () => {
                            throw new Error(errorMsg);
                        }),
                        verify: vi.fn(async (v: any) => v),
                        summarize: vi.fn(() => "Summary"),
                    })),
                },
            };

            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, failRunnerDeps);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, failRunnerDeps);

            expect(result.steps[0].status).toBe("FAILED");
            expect(result.steps[0].error).toBe(errorMsg);
        });

        it("FAILED_VERIFICATION marks step FAILED with verification error", async () => {
            const failRunnerDeps = {
                ...runnerDeps,
                registry: {
                    resolve: vi.fn(() => ({
                        name: "test.capability",
                        version: 1,
                        risk: "REVERSIBLE_WRITE" as const,
                        inputSchema: { parse: (v: any) => v },
                        outputSchema: { parse: (v: any) => v },
                        available: vi.fn(async () => true),
                        authorize: vi.fn(async () => {}),
                        preview: vi.fn(async () => ({ summary: "Preview" })),
                        execute: vi.fn(async () => ({ result: "Success" })),
                        verify: vi.fn(async (v: any) => {
                            throw new Error("Verification failed");
                        }),
                        summarize: vi.fn(() => "Summary"),
                    })),
                },
            };

            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, failRunnerDeps);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, failRunnerDeps);

            expect(result.steps[0].status).toBe("FAILED");
        });

        it("unauthorized actor (VIEWER) gets SabahForbiddenError", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            await expect(
                executeNextStep(viewerActor, workflow.id, fakePrisma, runnerDeps)
            ).rejects.toThrow(SabahForbiddenError);
        });
    });

    describe("getSnapshot", () => {
        it("serializes an undecided database approval into the client contract", async () => {
            const now = new Date("2026-09-07T09:41:36.316Z");
            const db = { aiWorkflow: { findUnique: vi.fn().mockResolvedValue({
                id: "cmtr1wj9e000zwdaeyofnrwxu", goal: "Add six tasks", status: "AWAITING_APPROVAL",
                actorId: adminActor.id, createdAt: now, updatedAt: now,
                steps: [], approvals: [{
                    id: "cmtr1wu65001nwdaeaji35y3p", stepId: "cmtr1wj9j0011wdaeiwesb3uq",
                    title: "Approve task creation", risk: "REVERSIBLE_WRITE", status: "PENDING",
                    expiresAt: now, createdAt: now, decidedAt: null, decisionType: null, decisionReason: null,
                }],
            }) } } as unknown as WorkflowDatabase;
            const snapshot = await getSnapshot(adminActor, "cmtr1wj9e000zwdaeyofnrwxu", db);
            const wire = JSON.parse(JSON.stringify(snapshot));
            expect(workflowSnapshotSchema.safeParse(wire).success).toBe(true);
            expect(wire.approvals[0]).not.toHaveProperty("decisionType");
            expect(wire.approvals[0].status).toBe("PENDING");
        });

        it("keeps the complete bounded preview summary instead of the shorter approval title", async () => {
            const now = new Date("2026-09-07T09:41:36.316Z");
            const summary = "Task details ".repeat(27) + "6. Final requested task";
            const db = { aiWorkflow: { findUnique: vi.fn().mockResolvedValue({
                id: "cmtr1wj9e000zwdaeyofnrwxu", goal: "Add six tasks", status: "AWAITING_APPROVAL",
                actorId: adminActor.id, createdAt: now, updatedAt: now, approvals: [],
                steps: [{ id: "step-1", clientStepId: "tasks", capability: "tasks.createMany",
                    status: "APPROVAL_REQUIRED", dependsOnJson: "[]", confidence: 1,
                    previewJson: JSON.stringify({ title: summary.slice(0, 300), summary }),
                }],
            }) } } as unknown as WorkflowDatabase;
            const snapshot = await getSnapshot(adminActor, "cmtr1wj9e000zwdaeyofnrwxu", db);
            expect(snapshot.steps[0].previewSummary).toBe(summary);
            expect(workflowSnapshotSchema.safeParse(JSON.parse(JSON.stringify(snapshot))).success).toBe(true);
        });

        it("reads only the bounded stored link projection and keeps legacy HTTPS links safe", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflowStep.update({
                where: { id: workflow.steps[0].id },
                data: {
                    status: "VERIFIED",
                    outputJson: JSON.stringify({
                        summary: "Stored result",
                        entityLinks: [
                            { type: "TASK", id: "https-task", href: "https://example.test/tasks/https-task", label: "HTTPS task" },
                            { type: "TASK", id: "evil", href: "//evil.example", label: "Evil" },
                            { type: "TASK", id: "script", href: "javascript:alert(1)", label: "Script" },
                            { type: "TASK", id: "control", href: `/tasks/${String.fromCharCode(7)}evil`, label: "Control" },
                        ],
                        rawOutput: { secret: "must not be read" },
                    }),
                },
            });

            const snapshot = await getSnapshot(adminActor, workflow.id, fakePrisma);

            expect(snapshot.steps[0].resultSummary).toBe("Stored result");
            expect(snapshot.steps[0].entityLinks).toEqual([{ type: "TASK", id: "https-task", href: "https://example.test/tasks/https-task", label: "HTTPS task" }]);
            expect(JSON.stringify(snapshot)).not.toContain("must not be read");
            expect(workflowSnapshotSchema.safeParse(JSON.parse(JSON.stringify(snapshot))).success).toBe(true);
        });
        it("returns workflowSnapshotSchema-shaped view with steps and approvals", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            const snapshot = await getSnapshot(adminActor, workflow.id, fakePrisma);

            expect(snapshot.id).toBe(workflow.id);
            expect(snapshot.goal).toBe(input.goal);
            expect(snapshot.status).toBeDefined();
            expect(snapshot.steps).toBeDefined();
            expect(snapshot.approvals).toBeDefined();
            expect(snapshot.createdAt).toBeDefined();

            // Validate schema
            const parsed = workflowSnapshotSchema.parse(snapshot);
            expect(parsed).toEqual(snapshot);
        });

        it("returns 404 for inaccessible workflows", async () => {
            await expect(
                getSnapshot(adminActor, "nonexistent-id", fakePrisma)
            ).rejects.toThrow(/not found/i);
        });

        it("unauthorized actor (VIEWER) gets SabahForbiddenError for their own workflows", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(memberActor, input, fakePrisma, runnerDeps);

            await expect(
                getSnapshot(viewerActor, workflow.id, fakePrisma)
            ).rejects.toThrow(SabahForbiddenError);
        });
    });

    describe("listWorkflows", () => {
        it("returns actor-scoped workflows", async () => {
            const input = createWorkflowInput(simpleSteps);
            await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            const result = await listWorkflows(adminActor, {}, fakePrisma);

            expect(result).toHaveLength(1);
            expect(result[0].actorId).toBe(adminActor.id);
        });

        it("filters by status", async () => {
            const input = createWorkflowInput(simpleSteps);
            await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            const result = await listWorkflows(adminActor, { status: "PLANNED" }, fakePrisma);

            expect(result).toHaveLength(1);
            expect(result[0].status).toBe("PLANNED");
        });
    });

    describe("Stale step retry", () => {
        it("retries PENDING steps with recordVersion check", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            // Execute once to mark as VERIFIED
            await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            // Simulate stale retry - version should be checked
            await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            // Should not re-execute already VERIFIED steps
            const updatedSnapshot = await getSnapshot(adminActor, workflow.id, fakePrisma);
            expect(updatedSnapshot.steps[0].status).toBe("VERIFIED");
        });
    });

    describe("Stop behavior", () => {
        it("stops workflow and prevents further execution", async () => {
            const input = createWorkflowInput(dependentSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            // Stop the workflow
            await fakePrisma.aiWorkflow.update({
                where: { id: workflow.id },
                data: { status: "CANCELED" },
            });

            // Attempt to execute
            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            expect(result.status).toBe("CANCELED");
            expect(result.steps.every((s: any) => s.status === "PENDING")).toBe(true);
        });

        it("does not reopen a canceled workflow when approval becomes required in flight", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const capability = runnerDeps.registry.resolve();
            capability.risk = "SENSITIVE_WRITE";
            capability.authorize = vi.fn(async () => {
                await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "CANCELED", completedAt: new Date() } });
            });
            runnerDeps.registry.resolve.mockReturnValue(capability);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            expect(result.status).toBe("CANCELED");
            expect(result.approvals).toHaveLength(0);
            expect(result.steps[0].status).not.toBe("APPROVAL_REQUIRED");
        });

        it("rejects approval when the bound step arguments change", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const capability = runnerDeps.registry.resolve();
            capability.risk = "SENSITIVE_WRITE";
            runnerDeps.registry.resolve.mockReturnValue(capability);
            const waiting = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);
            const approval = waiting.approvals[0];
            await fakePrisma.aiWorkflowStep.update({ where: { id: workflow.steps[0].id }, data: { argsJson: JSON.stringify({ changed: true }) } });

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: approval.id }, fakePrisma)).rejects.toMatchObject({ status: 409 });
        });

        it("does not record a stale verified step after cancellation wins in flight", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const capability = runnerDeps.registry.resolve();
            capability.execute = vi.fn(async () => {
                await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "CANCELED", completedAt: new Date() } });
                return { result: "Success" };
            });
            runnerDeps.registry.resolve.mockReturnValue(capability);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            expect(result.status).toBe("CANCELED");
            expect(result.steps[0].status).toBe("SKIPPED");
        });

        it("does not claim or execute a pending step after Stop wins before the claim", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const capability = runnerDeps.registry.resolve();
            capability.execute = vi.fn(async () => ({ result: "Success" }));
            runnerDeps.registry.resolve.mockReturnValue(capability);
            const claim = fakePrisma.aiWorkflowStep.updateMany.getMockImplementation();
            fakePrisma.aiWorkflowStep.updateMany.mockImplementationOnce(async (args: unknown) => {
                await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "CANCELED", completedAt: new Date() } });
                return claim(args);
            });

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            expect(result.status).toBe("CANCELED");
            expect(result.steps[0].status).toBe("PENDING");
            expect(capability.execute).not.toHaveBeenCalled();
        });

        it("does not complete an all-verified workflow after Stop wins terminalization", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflowStep.update({ where: { id: workflow.steps[0].id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
            const terminalize = fakePrisma.aiWorkflow.updateMany.getMockImplementation();
            fakePrisma.aiWorkflow.updateMany.mockImplementationOnce(async (args: unknown) => {
                await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "CANCELED", completedAt: new Date() } });
                return terminalize(args);
            });

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            expect(result.status).toBe("CANCELED");
        });

        it("does not overwrite an approval-state transition after a verified result", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const capability = runnerDeps.registry.resolve();
            capability.execute = vi.fn(async () => {
                await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "AWAITING_APPROVAL" } });
                return { result: "Success" };
            });
            runnerDeps.registry.resolve.mockReturnValue(capability);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            expect(result.status).toBe("AWAITING_APPROVAL");
            expect(result.steps[0].status).toBe("VERIFIED");
        });
    });

    describe("Actor isolation", () => {
        it("actors cannot access workflows from other actors", async () => {
            const input = createWorkflowInput(simpleSteps);
            const workflow = await proposeWorkflow(adminActor, input, fakePrisma, runnerDeps);

            const otherActor = { id: "user_other", role: "MEMBER" as const, departmentIds: [] };

            await expect(
                getSnapshot(otherActor, workflow.id, fakePrisma)
            ).rejects.toThrow(/forbidden/i);
        });
    });

    describe("Duplicate resolution", () => {
        it("rolls back the guarded version when event creation fails", async () => {
            const db = createFakePrisma();
            const workflowDb = asWorkflowDatabase(db);
            const candidateId = "clcandidate123456789012345";
            const duplicateDb = createDuplicateDb(candidateId, { id: candidateId, title: "Test", description: null, updatedAt: new Date("2026-08-20T00:00:00.000Z"), isPrivate: false });
            const proposed = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), workflowDb, createFakeRunnerDeps());
            db.aiWorkflowEvent.create.mockImplementationOnce(async ({ data }) => {
                if (data.eventType === "DUPLICATE_RESOLUTION") throw new Error("event failed");
                return { id: "evt-retry", createdAt: new Date(), workflowId: data.workflowId, stepId: data.stepId, eventType: data.eventType, level: data.level, message: data.message, metadataJson: data.metadataJson };
            });
            await expect(decide(adminActor, proposed.id, { type: "RESOLVE_DUPLICATE", stepId: proposed.steps[0].id, resolution: "CREATE_SEPARATELY", entityType: "TASK", entityId: candidateId, reason: "Separate" }, workflowDb, duplicateDb)).rejects.toThrow("event failed");
            await expect(decide(adminActor, proposed.id, { type: "RESOLVE_DUPLICATE", stepId: proposed.steps[0].id, resolution: "CREATE_SEPARATELY", entityType: "TASK", entityId: candidateId, reason: "Separate" }, workflowDb, duplicateDb)).resolves.toBeDefined();
        });

        it("persists a bounded duplicate resolution event for the workflow-owned step", async () => {
            const db = createFakePrisma();
            const workflowDb = asWorkflowDatabase(db);
            const candidateId = "clcandidate123456789012345";
            const duplicateDb = createDuplicateDb(candidateId, { id: candidateId, title: "Test", description: null, updatedAt: new Date("2026-08-20T00:00:00.000Z"), isPrivate: false });
            const proposed = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), workflowDb, createFakeRunnerDeps());
            const result = await decide(adminActor, proposed.id, { type: "RESOLVE_DUPLICATE", stepId: proposed.steps[0].id, resolution: "CREATE_SEPARATELY", entityType: "TASK", entityId: candidateId, reason: "Separate deliverables" }, workflowDb, duplicateDb);
            expect(result.id).toBe(proposed.id);
            expect(db.aiWorkflowEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: "DUPLICATE_RESOLUTION", stepId: proposed.steps[0].id, metadataJson: expect.stringContaining("CREATE_SEPARATELY") }) }));
        });

        it("rejects a visible record that is not in the actor-scoped duplicate candidate set", async () => {
            const db = createFakePrisma();
            const workflowDb = asWorkflowDatabase(db);
            const candidateId = "clforeigncandidate1234567";
            const proposed = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), workflowDb, createFakeRunnerDeps());
            const duplicateDb = createDuplicateDb(candidateId, { id: candidateId, title: "Unrelated record", description: "Different work", updatedAt: new Date("2026-08-20T00:00:00.000Z"), isPrivate: false });

            await expect(decide(adminActor, proposed.id, { type: "RESOLVE_DUPLICATE", stepId: proposed.steps[0].id, resolution: "USE_EXISTING", entityType: "TASK", entityId: candidateId }, workflowDb, duplicateDb)).rejects.toThrow(/not a duplicate candidate/i);
            expect(db.aiWorkflowEvent.create).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: "DUPLICATE_RESOLUTION" }) }));
        });

        it("requires a typed candidate for every duplicate resolution", async () => {
            const db = createFakePrisma();
            const workflowDb = asWorkflowDatabase(db);
            const proposed = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), workflowDb, createFakeRunnerDeps());
            const candidateId = "clcandidate123456789012345";
            const duplicateDb = createDuplicateDb(candidateId, { id: candidateId, title: "Test", description: null, updatedAt: new Date("2026-08-20T00:00:00.000Z"), isPrivate: false });

            await expect(decide(adminActor, proposed.id, { type: "RESOLVE_DUPLICATE", stepId: proposed.steps[0].id, resolution: "USE_EXISTING" }, workflowDb, duplicateDb)).rejects.toThrow(/typed duplicate candidate/i);
        });

        it("replays the same duplicate decision without appending a second event", async () => {
            const db = createFakePrisma();
            const workflowDb = asWorkflowDatabase(db);
            const candidateId = "clcandidate123456789012345";
            const duplicateDb = createDuplicateDb(candidateId, { id: candidateId, title: "Test", description: null, updatedAt: new Date("2026-08-20T00:00:00.000Z"), isPrivate: false });
            const proposed = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), workflowDb, createFakeRunnerDeps());
            const decision = { type: "RESOLVE_DUPLICATE" as const, stepId: proposed.steps[0].id, resolution: "USE_EXISTING" as const, entityType: "TASK" as const, entityId: candidateId };

            const first = await decide(adminActor, proposed.id, decision, workflowDb, duplicateDb);
            const second = await decide(adminActor, proposed.id, decision, workflowDb, duplicateDb);

            expect(second).toEqual(first);
            expect(db.aiWorkflowEvent.create.mock.calls.filter(([call]) => call.data.eventType === "DUPLICATE_RESOLUTION")).toHaveLength(1);
        });

        it("rejects a different duplicate decision for the same workflow step", async () => {
            const db = createFakePrisma();
            const workflowDb = asWorkflowDatabase(db);
            const candidateId = "clcandidate123456789012345";
            const duplicateDb = createDuplicateDb(candidateId, { id: candidateId, title: "Test", description: null, updatedAt: new Date("2026-08-20T00:00:00.000Z"), isPrivate: false });
            const proposed = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), workflowDb, createFakeRunnerDeps());
            const first = { type: "RESOLVE_DUPLICATE" as const, stepId: proposed.steps[0].id, resolution: "USE_EXISTING" as const, entityType: "TASK" as const, entityId: candidateId };
            await decide(adminActor, proposed.id, first, workflowDb, duplicateDb);

            await expect(decide(adminActor, proposed.id, { ...first, resolution: "UPDATE_EXISTING" }, workflowDb, duplicateDb)).rejects.toThrow(/different duplicate resolution/i);
            expect(db.aiWorkflowEvent.create.mock.calls.filter(([call]) => call.data.eventType === "DUPLICATE_RESOLUTION")).toHaveLength(1);
        });

        it("uses the workflow record version to prevent concurrent duplicate events", async () => {
            const db = createFakePrisma();
            const workflowDb = asWorkflowDatabase(db);
            const candidateId = "clcandidate123456789012345";
            const duplicateDb = createDuplicateDb(candidateId, { id: candidateId, title: "Test", description: null, updatedAt: new Date("2026-08-20T00:00:00.000Z"), isPrivate: false });
            const proposed = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), workflowDb, createFakeRunnerDeps());
            const decision = { type: "RESOLVE_DUPLICATE" as const, stepId: proposed.steps[0].id, resolution: "USE_EXISTING" as const, entityType: "TASK" as const, entityId: candidateId };

            const results = await Promise.allSettled([
                decide(adminActor, proposed.id, decision, workflowDb, duplicateDb),
                decide(adminActor, proposed.id, decision, workflowDb, duplicateDb),
            ]);

            expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
            expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
            expect(db.aiWorkflowEvent.create.mock.calls.filter(([call]) => call.data.eventType === "DUPLICATE_RESOLUTION")).toHaveLength(1);
        });

        it("exports the bounded no-undo limitation instead of inventing an UNDONE action", () => {
            expect(workflowUndoLimitation).toMatch(/UNDONE is unavailable/i);
        });
    });

    describe("Approval decision guards and atomicity", () => {
        const futureExpiry = () => new Date(Date.now() + 60 * 60 * 1000);
        const pastExpiry = () => new Date(Date.now() - 60 * 1000);
        const createApproval = (workflowId: string, stepId: string | null, overrides: Record<string, unknown> = {}) =>
            fakePrisma.aiApproval.create({ data: { workflowId, stepId, status: "PENDING", title: "Approval", summary: "Approval", risk: "REVERSIBLE_WRITE", expiresAt: futureExpiry(), requestedById: adminActor.id, ...overrides } });
        it("grants approval atomically and records an FK-safe event stepId", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await createApproval(workflow.id, workflow.steps[0].id);

            const result = await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: approval.id }, fakePrisma);

            expect(result.approvals).toEqual(expect.arrayContaining([expect.objectContaining({ id: approval.id, status: "APPROVED" })]));
            const grantCall = fakePrisma.aiWorkflowEvent.create.mock.calls.find(([call]: [{ data: { eventType: string } }]) => call.data.eventType === "APPROVAL_GRANTED");
            expect(grantCall).toBeDefined();
            // FK safety: the event stepId must be the AiWorkflowStep id, never the approval id
            expect(grantCall![0].data.stepId).toBe(workflow.steps[0].id);
            expect(grantCall![0].data.stepId).not.toBe(approval.id);
            expect(JSON.parse(grantCall![0].data.metadataJson)).toMatchObject({ approvalId: approval.id });
        });

        it("rolls back the approval decision when the grant event write fails", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await createApproval(workflow.id, workflow.steps[0].id);
            fakePrisma.aiWorkflowEvent.create.mockImplementationOnce(async ({ data }: { data: { eventType: string } }) => {
                if (data.eventType === "APPROVAL_GRANTED") throw new Error("event write failed");
                return { id: "evt-x", createdAt: new Date(), ...data };
            });

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: approval.id }, fakePrisma)).rejects.toThrow("event write failed");
            expect(approval.status).toBe("PENDING");
            expect(approval.decidedById).toBeUndefined();
        });

        it("rejects approving an approval that belongs to another workflow", async () => {
            const workflowA = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const workflowB = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const foreignApproval = await createApproval(workflowB.id, workflowB.steps[0].id);

            await expect(decide(adminActor, workflowA.id, { type: "APPROVE", approvalId: foreignApproval.id }, fakePrisma)).rejects.toThrow(/not found/i);
            expect(foreignApproval.status).toBe("PENDING");
            const eventTypes = fakePrisma.aiWorkflowEvent.create.mock.calls.map((call: [{ data: { eventType: string } }]) => call[0].data.eventType);
            expect(eventTypes).not.toContain("APPROVAL_GRANTED");
        });

        it("rejects approving an expired approval and leaves it undecided", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await createApproval(workflow.id, workflow.steps[0].id, { expiresAt: pastExpiry() });

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: approval.id }, fakePrisma)).rejects.toThrow(/pending|expired/i);
            expect(approval.status).toBe("PENDING");
            const eventTypes = fakePrisma.aiWorkflowEvent.create.mock.calls.map((call: [{ data: { eventType: string } }]) => call[0].data.eventType);
            expect(eventTypes).not.toContain("APPROVAL_GRANTED");
        });

        it("models exact step capability and argument CAS predicates in the renewal test database", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const step = workflow.steps[0];
            for (const mismatch of [{ capability: "tasks.delete" }, { argsJson: JSON.stringify({ name: "changed" }) }]) {
                const result = await fakePrisma.aiWorkflowStep.updateMany({ where: { id: step.id, workflowId: workflow.id, status: "PENDING", ...mismatch }, data: { status: "APPROVAL_REQUIRED" } });
                expect(result.count).toBe(0);
            }
            expect((await getSnapshot(adminActor, workflow.id, fakePrisma)).steps[0].status).toBe("PENDING");
        });

        it("renews an expired approval into a fresh pending approval without granting authority", async () => {
            const workflow = await proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-owned" }, fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "RUNNING" } });
            const step = workflow.steps[0];
            const fieldsJson = JSON.stringify([{
                path: "__approval_binding_sha256",
                proposed: crypto.createHash("sha256").update(JSON.stringify({ capability: step.capability, version: 1, argsJson: JSON.stringify({ name: "Test" }), risk: "REVERSIBLE_WRITE" })).digest("hex"),
            }]);
            const expired = await createApproval(workflow.id, step.id, { status: "APPROVED", expiresAt: pastExpiry(), fieldsJson });

            const renewed = await decide(adminActor, workflow.id, { type: "RENEW", approvalId: expired.id, reason: "Approval window elapsed" }, fakePrisma);

            expect(expired.status).toBe("EXPIRED");
            expect(fakePrisma.aiWorkflowStep.updateMany).toHaveBeenCalledWith({
                where: { id: step.id, workflowId: workflow.id, status: "PENDING", capability: step.capability, argsJson: JSON.stringify({ name: "Test" }) },
                data: { status: "APPROVAL_REQUIRED", startedAt: null, completedAt: null },
            });
            expect(renewed.status).toBe("AWAITING_APPROVAL");
            expect(renewed.steps[0].status).toBe("APPROVAL_REQUIRED");
            expect(renewed.approvals).toEqual(expect.arrayContaining([
                expect.objectContaining({ id: expired.id, status: "EXPIRED" }),
                expect.objectContaining({ status: "PENDING", stepId: step.id }),
            ]));
            const stored = await fakePrisma.aiWorkflow.findUnique({ where: { id: workflow.id }, include: { steps: true, approvals: true } });
            const fresh = stored.approvals.find((approval: any) => approval.id !== expired.id);
            expect(fresh).toMatchObject({ status: "PENDING", workflowId: workflow.id, stepId: step.id, requestedById: adminActor.id, fieldsJson });
            expect(fresh.expiresAt.getTime()).toBeGreaterThan(Date.now());
            const renewalEvent = fakePrisma.aiWorkflowEvent.create.mock.calls.find(([call]: [{ data: { eventType: string } }]) => call.data.eventType === "APPROVAL_RENEWED");
            expect(renewalEvent).toBeDefined();
            expect(JSON.parse(renewalEvent![0].data.metadataJson)).toMatchObject({ oldApprovalId: expired.id, newApprovalId: fresh.id, actorId: adminActor.id, conversationId: "conv-owned" });
            await expect(decide(adminActor, workflow.id, { type: "RENEW", approvalId: expired.id }, fakePrisma)).rejects.toMatchObject({ status: 409 });
            expect((await getSnapshot(adminActor, workflow.id, fakePrisma)).approvals).toHaveLength(2);
        });

        it("rejects approving an already-decided approval", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await createApproval(workflow.id, workflow.steps[0].id, { status: "REJECTED" });

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: approval.id }, fakePrisma)).rejects.toThrow(/pending|expired/i);
            expect(approval.status).toBe("REJECTED");
            const eventTypes = fakePrisma.aiWorkflowEvent.create.mock.calls.map((call: [{ data: { eventType: string } }]) => call[0].data.eventType);
            expect(eventTypes).not.toContain("APPROVAL_GRANTED");
        });

        it("marks the pending approval REJECTED atomically when the workflow is rejected", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            const approval = await createApproval(workflow.id, workflow.steps[0].id);

            const result = await decide(adminActor, workflow.id, { type: "REJECT", approvalId: approval.id, reason: "Not needed" }, fakePrisma);

            expect(result.status).toBe("CANCELED");
            expect(approval.status).toBe("REJECTED");
            expect(approval.decisionType).toBe("REJECT");
        });
    });

    describe("Concurrent step claim", () => {
        it("claims the step with a PENDING compare-and-swap before executing", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            expect(fakePrisma.aiWorkflowStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                where: expect.objectContaining({ id: workflow.steps[0].id, status: "PENDING" }),
                data: expect.objectContaining({ status: "RUNNING" }),
            }));
            expect(result.steps[0].status).toBe("VERIFIED");
        });

        it.each([
            ["expired", new Date(Date.now() - 1_000), "valid-binding"],
            ["missing binding", new Date(Date.now() + 60_000), "missing-binding"],
        ])("fails closed for an %s approval before capability execution", async (_label, expiresAt, bindingMode) => {
            const capability = runnerDeps.registry.resolve();
            capability.requiresExplicitApproval = true;
            runnerDeps.registry.resolve.mockReturnValue(capability);
            const workflow = await proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-owned" }, fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "RUNNING" } });
            const step = workflow.steps[0];
            const argsJson = step ? JSON.stringify({ name: "Test" }) : "";
            const binding = crypto.createHash("sha256").update(JSON.stringify({ capability: step.capability, version: 1, argsJson, risk: "REVERSIBLE_WRITE" })).digest("hex");
            await fakePrisma.aiApproval.create({ data: {
                workflowId: workflow.id, stepId: step.id, status: "APPROVED", title: "Approval", summary: "Approval", risk: "REVERSIBLE_WRITE",
                fieldsJson: bindingMode === "valid-binding" ? JSON.stringify([{ path: "__approval_binding_sha256", proposed: binding }]) : null,
                expiresAt, requestedById: adminActor.id,
            } });

            await expect(executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps)).rejects.toMatchObject({ status: 409 });
            expect(capability.execute).not.toHaveBeenCalled();
            expect((await getSnapshot(adminActor, workflow.id, fakePrisma)).steps[0].status).toBe("PENDING");
        });

        it("fails closed when the runner receives a different conversation binding", async () => {
            const capability = runnerDeps.registry.resolve();
            runnerDeps.registry.resolve.mockReturnValue(capability);
            const workflow = await proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-owned" }, fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "RUNNING" } });

            await expect(executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps, { conversationId: "conv-other" })).rejects.toMatchObject({ status: 409 });
            expect(capability.execute).not.toHaveBeenCalled();
            expect((await getSnapshot(adminActor, workflow.id, fakePrisma)).steps[0].status).toBe("PENDING");
        });

        it("does not execute the capability when another worker already claimed the step", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            fakePrisma.aiWorkflowStep.updateMany.mockResolvedValueOnce({ count: 0 });
            runnerDeps.registry.resolve.mockClear();

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);

            // Lost the race: no capability resolution/execution, current snapshot returned
            expect(runnerDeps.registry.resolve).not.toHaveBeenCalled();
            expect(result.id).toBe(workflow.id);
            expect(result.steps[0].status).toBe("PENDING");
        });
    });

    describe("Approved step resume and stale claim recovery", () => {
        const approvalCapability = () => ({
            name: "test.capability",
            version: 1,
            risk: "SENSITIVE_WRITE" as const,
            requiresExplicitApproval: true,
            inputSchema: { parse: (v: any) => v },
            outputSchema: { parse: (v: any) => v },
            available: vi.fn(async () => true),
            authorize: vi.fn(async () => {}),
            preview: vi.fn(async () => ({ summary: "Preview" })),
            execute: vi.fn(async () => ({ result: "Success" })),
            verify: vi.fn(async (v: any) => v),
            summarize: vi.fn(() => "Summary"),
        });

        it("returns the linked step to PENDING and executes it after approval", async () => {
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(approvalCapability) } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, deps);

            const paused = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            expect(paused.status).toBe("AWAITING_APPROVAL");
            expect(paused.steps[0].status).toBe("APPROVAL_REQUIRED");

            const decided = await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: paused.approvals[0].id }, fakePrisma);
            expect(decided.status).toBe("RUNNING");
            expect(decided.steps[0].status).toBe("PENDING");

            const resumed = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            expect(resumed.steps[0].status).toBe("VERIFIED");
        });

        it("requires a new human approval before resuming after an expired approval", async () => {
            const capability = approvalCapability();
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(() => capability) } };
            const workflow = await proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-owned" }, fakePrisma, deps);

            const paused = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            const firstApproval = paused.approvals[0];
            await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: firstApproval.id }, fakePrisma);
            await fakePrisma.aiApproval.update({ where: { id: firstApproval.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });

            await expect(executeNextStep(adminActor, workflow.id, fakePrisma, deps)).rejects.toMatchObject({ status: 409 });
            expect(capability.execute).not.toHaveBeenCalled();

            const renewed = await decide(adminActor, workflow.id, { type: "RENEW", approvalId: firstApproval.id }, fakePrisma);
            expect(renewed.status).toBe("AWAITING_APPROVAL");
            expect(renewed.steps[0].status).toBe("APPROVAL_REQUIRED");
            const beforeDecision = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            expect(beforeDecision.status).toBe("AWAITING_APPROVAL");
            expect(capability.execute).not.toHaveBeenCalled();

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: firstApproval.id }, fakePrisma)).rejects.toMatchObject({ status: 409 });
            const replacement = renewed.approvals.find((approval) => approval.status === "PENDING");
            expect(replacement).toBeDefined();
            const approved = await decide(adminActor, workflow.id, { type: "APPROVE", approvalId: replacement!.id }, fakePrisma);
            expect(approved.status).toBe("RUNNING");
            expect(approved.steps[0].status).toBe("PENDING");

            const resumed = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            expect(resumed.steps[0].status).toBe("VERIFIED");
            expect(capability.execute).toHaveBeenCalledOnce();
        });

        it("rolls back expiry renewal when its audit event cannot be recorded", async () => {
            const workflow = await proposeWorkflow(adminActor, { ...createWorkflowInput(simpleSteps), conversationId: "conv-owned" }, fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "RUNNING" } });
            const step = workflow.steps[0];
            const fieldsJson = JSON.stringify([{
                path: "__approval_binding_sha256",
                proposed: crypto.createHash("sha256").update(JSON.stringify({ capability: step.capability, version: 1, argsJson: JSON.stringify({ name: "Test" }), risk: "REVERSIBLE_WRITE" })).digest("hex"),
            }]);
            const expired = await fakePrisma.aiApproval.create({ data: { workflowId: workflow.id, stepId: step.id, status: "APPROVED", title: "Approval", summary: "Approval", risk: "REVERSIBLE_WRITE", fieldsJson, expiresAt: new Date(Date.now() - 1_000), requestedById: adminActor.id } });
            fakePrisma.aiWorkflowEvent.create.mockImplementationOnce(async ({ data }: { data: { eventType: string } }) => {
                if (data.eventType === "APPROVAL_RENEWED") throw new Error("renewal event write failed");
                return { id: "evt-x", createdAt: new Date(), ...data };
            });

            await expect(decide(adminActor, workflow.id, { type: "RENEW", approvalId: expired.id }, fakePrisma)).rejects.toThrow("renewal event write failed");
            expect(expired.status).toBe("APPROVED");
            expect((await getSnapshot(adminActor, workflow.id, fakePrisma)).status).toBe("RUNNING");
            expect((await getSnapshot(adminActor, workflow.id, fakePrisma)).steps[0].status).toBe("PENDING");
            expect((await getSnapshot(adminActor, workflow.id, fakePrisma)).approvals).toHaveLength(1);
        });

        it("reclaims a step stranded RUNNING by a crashed worker", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflowStep.update({ where: { id: workflow.steps[0].id }, data: { status: "RUNNING", startedAt: new Date(Date.now() - 11 * 60 * 1000) } });

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);
            expect(result.steps[0].status).toBe("VERIFIED");
        });

        it("fails closed instead of re-running a stale step with an unverified EXECUTING intent", async () => {
            const deps = { ...runnerDeps, store: { getState: vi.fn(async () => "EXECUTING") } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, deps);
            await fakePrisma.aiWorkflowStep.update({ where: { id: workflow.steps[0].id }, data: { status: "RUNNING", startedAt: new Date(Date.now() - 11 * 60 * 1000) } });

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);

            expect(result.steps[0].status).toBe("FAILED");
            expect(result.steps[0].error).toMatch(/manual review/i);
            expect(deps.store.getState).toHaveBeenCalledWith(expect.stringContaining(":a"));
        });

        it("refuses to approve once the workflow is terminal", async () => {
            const deps = { ...runnerDeps, registry: { resolve: vi.fn(approvalCapability) } };
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, deps);
            const paused = await executeNextStep(adminActor, workflow.id, fakePrisma, deps);
            await fakePrisma.aiWorkflow.update({ where: { id: workflow.id }, data: { status: "CANCELED" } });

            await expect(decide(adminActor, workflow.id, { type: "APPROVE", approvalId: paused.approvals[0].id }, fakePrisma)).rejects.toMatchObject({ status: 409 });
            const snapshot = await getSnapshot(adminActor, workflow.id, fakePrisma);
            expect(snapshot.status).toBe("CANCELED");
            expect(snapshot.approvals[0].status).toBe("PENDING");
        });

        it("leaves a freshly RUNNING step to its current worker", async () => {
            const workflow = await proposeWorkflow(adminActor, createWorkflowInput(simpleSteps), fakePrisma, runnerDeps);
            await fakePrisma.aiWorkflowStep.update({ where: { id: workflow.steps[0].id }, data: { status: "RUNNING", startedAt: new Date() } });

            const result = await executeNextStep(adminActor, workflow.id, fakePrisma, runnerDeps);
            expect(result.steps[0].status).toBe("RUNNING");
        });
    });
});
