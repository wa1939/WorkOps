import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { runTool, WRITE_TOOL_CAPABILITIES } from "./executors";
import { logAiAction } from "@/lib/ai/audit";
import { createTask, createTasks, listTasksForActor } from "@/lib/tasks/commands";
import { assertCapabilityAllowed } from "@/lib/sabah/security/hard-boundaries";
import { assertApprovedWorkflowIntent, executeNextStep, proposeWorkflow } from "@/lib/sabah/workflows/service";
import { toSabahActor } from "@/lib/sabah/auth/actor";

import { prisma } from "@/lib/prisma";
vi.mock("@/lib/prisma", () => ({ prisma: { task: { groupBy: vi.fn() } } }));
vi.mock("@/lib/ai/audit", () => ({ logAiAction: vi.fn(async () => undefined) }));
vi.mock("@/lib/tasks/commands", () => ({
    createTask: vi.fn(),
    createTasks: vi.fn(),
    cancelCreatedTasks: vi.fn(),
    updateTaskStatus: vi.fn(),
    getTaskForActor: vi.fn(),
    listTasksForActor: vi.fn(),
    reassignTask: vi.fn(),
    updateTask: vi.fn(),
}));
vi.mock("@/lib/ai/pmo-executors", () => ({
    executeListPmoActions: vi.fn(),
    executeGetPmoAction: vi.fn(),
    executeDraftPmoFollowUp: vi.fn(),
}));
vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: vi.fn(),
    SabahForbiddenError: class extends Error { status = 403; code = "SABAH_FORBIDDEN"; },
}));
vi.mock("@/lib/sabah/capabilities/register-workspace", () => ({ registerWorkspaceCapabilitySet: vi.fn() }));
vi.mock("@/lib/sabah/capabilities/register-operational", () => ({ registerOperationalCapabilities: vi.fn() }));
vi.mock("@/lib/sabah/capabilities/modules/learning", () => ({
    createLearningCapabilities: vi.fn(),
    getLearningDependencies: vi.fn(),
    registerLearningCapabilities: vi.fn(),
    learningContext: {},
}));
vi.mock("@/lib/sabah/capabilities/registry", () => ({ capabilityRegistry: { resolve: vi.fn() } }));
vi.mock("@/lib/sabah/workflows/service", () => ({
    assertApprovedWorkflowIntent: vi.fn(),
    executeNextStep: vi.fn(),
    proposeWorkflow: vi.fn(),
}));
vi.mock("@/lib/sabah/tools/meta-tools", () => ({
    listCapabilities: vi.fn(),
    getCapabilityDetails: vi.fn(),
    ListCapabilitiesInputSchema: { parse: (value: unknown) => value },
    GetCapabilityDetailsInputSchema: { parse: (value: unknown) => value },
}));

import { listCapabilities, getCapabilityDetails } from "@/lib/sabah/tools/meta-tools";

const ctx = { userId: "u1", userRole: "LEAD", conversationId: "conv-owned" };

const WRITE_TOOL_ARGS: Record<string, string> = {
    createTask: JSON.stringify({ title: "T" }),
    createTasks: JSON.stringify({ tasks: [{ title: "T" }] }),
    cancelCreatedTasks: JSON.stringify({ taskIds: ["t1"] }),
    updateTaskStatus: JSON.stringify({ taskId: "t1", status: "DONE" }),
    reassignTask: JSON.stringify({ taskId: "t1", assigneeIds: ["u2"] }),
    updateTaskFields: JSON.stringify({ taskId: "t1", priority: "HIGH" }),
    logKpiUpdate: JSON.stringify({ kpiId: "k1", quarter: "Q1", value: 1 }),
};

let savedWritesFlag: string | undefined;

describe("runTool write gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(toSabahActor).mockResolvedValue({ id: "u1", role: "LEAD", departmentIds: [] });
        vi.mocked(assertApprovedWorkflowIntent).mockResolvedValue({ workflowId: "wf-1", stepId: "step-1" });
        vi.mocked(executeNextStep).mockResolvedValue({ id: "wf-1", status: "COMPLETED", steps: [{ id: "step-1", status: "VERIFIED", resultSummary: "Verified" }] } as never);
        savedWritesFlag = process.env.SABAH_WRITES_ENABLED;
        delete process.env.SABAH_WRITES_ENABLED;
    });

    afterEach(() => {
        if (savedWritesFlag === undefined) delete process.env.SABAH_WRITES_ENABLED;
        else process.env.SABAH_WRITES_ENABLED = savedWritesFlag;
    });

    it("covers exactly the write tools reachable from chat", () => {
        expect(Object.keys(WRITE_TOOL_CAPABILITIES).sort()).toEqual([
            "cancelCreatedTasks",
            "createTask",
            "createTasks",
            "logKpiUpdate",
            "reassignTask",
            "updateTaskFields",
            "updateTaskStatus",
        ]);
        // proposeMemoryOrPlaybookUpdate is deliberately excluded: it routes
        // through capability.authorize/execute and only forwards a proposal.
        expect(WRITE_TOOL_CAPABILITIES).not.toHaveProperty("proposeMemoryOrPlaybookUpdate");
    });

    it("maps every write tool to a capability name that passes the hard boundary", () => {
        for (const capabilityName of Object.values(WRITE_TOOL_CAPABILITIES)) {
            expect(() => assertCapabilityAllowed(capabilityName)).not.toThrow();
        }
    });

    it.each(Object.keys(WRITE_TOOL_ARGS))(
        "returns a structured error for %s when SABAH_WRITES_ENABLED is unset",
        async (tool) => {
            const result = await runTool(tool, WRITE_TOOL_ARGS[tool], ctx);
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error).toMatch(/writes?.*disabled|disabled.*writes?/i);
            expect(vi.mocked(createTask)).not.toHaveBeenCalled();
            expect(vi.mocked(logAiAction)).toHaveBeenCalledWith(expect.objectContaining({ tool, result: "error" }));
        },
    );

    it("rejects a model-supplied direct write when no server-approved workflow exists", async () => {
        process.env.SABAH_WRITES_ENABLED = "true";
        const result = await runTool("createTasks", WRITE_TOOL_ARGS.createTasks, ctx);

        expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/approved workflow/i) }));
        if (!result.ok) {
            expect(result.error).not.toMatch(/Plan tab/i);
            expect(result.error).toContain("inline confirmation");
        }
        expect(vi.mocked(assertApprovedWorkflowIntent)).not.toHaveBeenCalled();
        expect(vi.mocked(createTasks)).not.toHaveBeenCalled();
    });

    it("executes a direct write only for the exact server-approved workflow intent", async () => {
        process.env.SABAH_WRITES_ENABLED = "true";
        const result = await runTool("createTask", WRITE_TOOL_ARGS.createTask, { ...ctx, approvedWorkflowId: "wf-1" });

        expect(result).toEqual(expect.objectContaining({ ok: true }));
        expect(vi.mocked(createTask)).not.toHaveBeenCalled();
        expect(vi.mocked(assertApprovedWorkflowIntent)).toHaveBeenCalledWith(
            { id: "u1", role: "LEAD", departmentIds: [] },
            {
                workflowId: "wf-1",
                conversationId: "conv-owned",
                capability: "tasks.create",
                input: { title: "T", assigneeIds: ["u1"], dueAt: null },
            },
        );
        expect(vi.mocked(executeNextStep)).toHaveBeenCalledWith(
            { id: "u1", role: "LEAD", departmentIds: [] },
            "wf-1",
            undefined,
            expect.anything(),
            { requestedStepId: "step-1", conversationId: "conv-owned" },
        );
    });

    it.each(["FAILED", "FAILED_VERIFICATION", "DISABLED"])("reports a structured failure when the approved step is %s", async (status) => {
        process.env.SABAH_WRITES_ENABLED = "true";
        vi.mocked(executeNextStep).mockResolvedValueOnce({ id: "wf-1", status: "RUNNING", steps: [{ id: "step-1", status }] } as never);

        const result = await runTool("createTask", WRITE_TOOL_ARGS.createTask, { ...ctx, approvedWorkflowId: "wf-1" });

        expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/not verified|failed|disabled/i) }));
    });

    it("does not report success for a verified step without a result", async () => {
        process.env.SABAH_WRITES_ENABLED = "true";
        vi.mocked(executeNextStep).mockResolvedValueOnce({ id: "wf-1", status: "RUNNING", steps: [{ id: "step-1", status: "VERIFIED" }] } as never);

        const result = await runTool("createTask", WRITE_TOOL_ARGS.createTask, { ...ctx, approvedWorkflowId: "wf-1" });

        expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.stringMatching(/not verified/i) }));
    });

    it("creates a six-task Riyadh batch for the persisted actor and records a verified outcome", async () => {
        process.env.SABAH_WRITES_ENABLED = "true";
        vi.mocked(createTasks).mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({
            ok: true,
            index,
            data: {
                id: `task-${index + 1}`,
                title: `مهمة ${index + 1}`,
                status: "TODO",
                priority: "MEDIUM",
                dueAt: index < 2 ? "2026-09-06T23:59:59+03:00" : "2026-09-07T23:59:59+03:00",
                assignments: [{ userId: "u1" }],
            },
        })) as never);

        const result = await runTool("createTasks", JSON.stringify({
            tasks: [
                { title: "مهمة 1", dueAt: "2026-09-06T23:59:59+03:00", assigneeIds: ["@me"] },
                { title: "مهمة 2", dueAt: "2026-09-06T23:59:59+03:00" },
                { title: "مهمة 3", dueAt: "2026-09-07T23:59:59+03:00" },
                { title: "مهمة 4", dueAt: "2026-09-07T23:59:59+03:00" },
                { title: "مهمة 5", dueAt: "2026-09-07T23:59:59+03:00" },
                { title: "مهمة 6", dueAt: "2026-09-07T23:59:59+03:00" },
            ],
        }), { ...ctx, approvedWorkflowId: "wf-1" });

        expect(result).toEqual(expect.objectContaining({
            ok: true,
            data: expect.objectContaining({ id: "wf-1", status: "COMPLETED" }),
        }));
        const approvalCall = vi.mocked(assertApprovedWorkflowIntent).mock.calls[0];
        expect(approvalCall?.[0]).toEqual({ id: "u1", role: "LEAD", departmentIds: [] });
        expect(approvalCall?.[1]).toEqual(expect.objectContaining({
            workflowId: "wf-1",
            conversationId: "conv-owned",
            capability: "tasks.createMany",
        }));
        const inputs = ((approvalCall?.[1] as unknown as { input: { tasks: Array<Record<string, unknown>> } }).input.tasks);
        expect(inputs).toHaveLength(6);
        expect(inputs.map((input) => input.assigneeIds)).toEqual(Array.from({ length: 6 }, () => ["u1"]));
        expect(inputs.slice(0, 2).map((input) => input.dueAt)).toEqual([
            "2026-09-06T23:59:59+03:00",
            "2026-09-06T23:59:59+03:00",
        ]);
        expect(inputs.slice(2).every((input) => input.dueAt === "2026-09-07T23:59:59+03:00")).toBe(true);
        expect(vi.mocked(logAiAction)).toHaveBeenCalledWith(expect.objectContaining({ tool: "createTasks", result: "ok" }));
    });

    it("rejects a viewer even when the chat request references an approved workflow", async () => {
        process.env.SABAH_WRITES_ENABLED = "true";
        const viewer = { id: "u1", role: "VIEWER" as const, departmentIds: [] };
        vi.mocked(toSabahActor).mockResolvedValueOnce(viewer);
        vi.mocked(assertApprovedWorkflowIntent).mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403, code: "FORBIDDEN" }));
        const result = await runTool("createTasks", JSON.stringify({ tasks: [{ title: "غير مصرح" }] }), { ...ctx, userRole: "VIEWER", approvedWorkflowId: "wf-1" });
        expect(result).toEqual({ ok: false, error: "Forbidden" });
        expect(vi.mocked(createTasks)).not.toHaveBeenCalled();
        expect(vi.mocked(assertApprovedWorkflowIntent)).toHaveBeenCalledWith(
            viewer,
            expect.objectContaining({ workflowId: "wf-1", conversationId: "conv-owned", capability: "tasks.createMany" }),
        );
        expect(vi.mocked(logAiAction)).toHaveBeenCalledWith(expect.objectContaining({ tool: "createTasks", result: "error", error: "Forbidden" }));
    });

    it.each(["listMyTasks", "searchTasks"])("labels %s as a bounded actor-scoped sample with lookahead", async (name) => {
        vi.mocked(listTasksForActor).mockResolvedValue([
            { id: "t1", title: "Visible", status: "TODO", priority: "HIGH" },
            { id: "t2", title: "Next", status: "TODO", priority: "MEDIUM" },
        ] as never);
        const result = await runTool(name, JSON.stringify({ limit: 1, ...(name === "searchTasks" ? { query: "test" } : {}) }), ctx);
        expect(result).toMatchObject({ ok: true, data: {
            returnedCount: 1, limit: 1, hasMore: true, countsScope: "returned_items_only",
            items: [{ id: "t1", url: "/tasks/t1" }],
        } });
        expect(listTasksForActor).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }), expect.objectContaining({ id: "u1" }), expect.anything());
    });

    it("aggregates complete assigned status and open-priority counts without overwriting status groups", async () => {
        vi.mocked(prisma.task.groupBy).mockResolvedValue([
            { status: "TODO", priority: "HIGH", _count: 2 },
            { status: "TODO", priority: "MEDIUM", _count: 4 },
            { status: "BLOCKED", priority: "MEDIUM", _count: 3 },
            { status: "DONE", priority: "HIGH", _count: 1 },
            { status: "CANCELED", priority: "LOW", _count: 5 },
        ] as never);
        const result = await runTool("getTaskStats", "{}", ctx);
        expect(result).toEqual({ ok: true, data: {
            total: 15, byStatus: { TODO: 6, BLOCKED: 3, DONE: 1, CANCELED: 5 },
            openTotal: 9, byPriority: { HIGH: 3, MEDIUM: 7, LOW: 5 },
            openByPriority: { HIGH: 2, MEDIUM: 7 }, countsScope: "all_assigned_tasks",
        } });
        expect(prisma.task.groupBy).toHaveBeenCalledWith(expect.objectContaining({
            by: ["status", "priority"], where: { assignments: { some: { userId: "u1" } } },
        }));
    });

    it("lets read tools through regardless of the writes flag", async () => {
        vi.mocked(listTasksForActor).mockResolvedValue([] as never);
        const result = await runTool("listMyTasks", "{}", ctx);
        expect(result.ok).toBe(true);
        expect(vi.mocked(listTasksForActor)).toHaveBeenCalledTimes(1);
    });

    it("exposes actor-scoped capability discovery through the chat executor", async () => {
        vi.mocked(listCapabilities).mockResolvedValue({ ok: true, data: { items: [], total: 0, hasMore: false } });
        const result = await runTool("listCapabilities", JSON.stringify({ query: "projects" }), ctx);
        expect(result).toEqual({ ok: true, data: { items: [], total: 0, hasMore: false } });
        expect(vi.mocked(listCapabilities)).toHaveBeenCalledWith(
            { id: "u1", role: "LEAD", departmentIds: [] },
            expect.objectContaining({ query: "projects" }),
        );
    });

    it("exposes bounded capability details through the chat executor", async () => {
        vi.mocked(getCapabilityDetails).mockResolvedValue({ ok: true, data: { name: "projects.search" } } as never);
        const result = await runTool("getCapabilityDetails", JSON.stringify({ name: "projects.search" }), ctx);
        expect(result).toEqual({ ok: true, data: { name: "projects.search" } });
        expect(vi.mocked(getCapabilityDetails)).toHaveBeenCalledWith(
            { id: "u1", role: "LEAD", departmentIds: [] },
            expect.objectContaining({ name: "projects.search" }),
        );
    });

    it("proposes a governed workflow bound to the server-owned conversation", async () => {
        process.env.SABAH_WRITES_ENABLED = "true";
        vi.mocked(proposeWorkflow).mockResolvedValue({ id: "wf-1", goal: "Prepare report", status: "PLANNED", steps: [], approvals: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
        const input = { goal: "Prepare report", steps: [{ clientStepId: "draft", capability: "reports.create", args: {}, dependsOn: [], confidence: 0.9 }] };

        const result = await runTool("proposeWorkflow", JSON.stringify(input), ctx);

        expect(result.ok).toBe(true);
        expect(proposeWorkflow).toHaveBeenCalledWith(
            expect.objectContaining({ id: "u1" }),
            expect.objectContaining({
                goal: input.goal,
                conversationId: "conv-owned",
                idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
                steps: expect.arrayContaining([expect.objectContaining(input.steps[0])]),
            })
        );
    });
});
