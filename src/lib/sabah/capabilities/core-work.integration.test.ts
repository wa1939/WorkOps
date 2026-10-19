import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
    actor: "c123456789012345678901234",
    department: "c223456789012345678901234",
    manager: "c323456789012345678901234",
    project: "c423456789012345678901234",
    stages: ["c523456789012345678901234", "c623456789012345678901234", "c723456789012345678901234", "c823456789012345678901234", "c923456789012345678901234"],
    objectives: ["ca23456789012345678901234", "cb23456789012345678901234", "cc23456789012345678901234", "cd23456789012345678901234", "ce23456789012345678901234"],
    outputs: ["cf23456789012345678901234", "cg23456789012345678901234", "ch23456789012345678901234", "ci23456789012345678901234", "cj23456789012345678901234", "ck23456789012345678901234", "cl23456789012345678901234"],
    kpis: ["cm23456789012345678901234", "cn23456789012345678901234", "co23456789012345678901234", "cp23456789012345678901234", "cq23456789012345678901234"],
    tasks: ["cr23456789012345678901234", "cs23456789012345678901234", "ct23456789012345678901234", "cu23456789012345678901234", "cv23456789012345678901234"],
} as const;

const projectState = { current: null as any };
const stageState = { current: [] as any[] };
const taskState = new Map<string, any>();
const kpiState = new Map<string, any>();
const executeCalls = new Map<string, number>();

const directory = {
    users: [{ id: ids.manager, email: "manager@example.test", name: "Demo Manager" }],
    departments: [{ id: ids.department, name: "الثقافة وتجربة الموظف" }],
    kpis: ids.kpis.map((id, index) => ({ id, name: ["الصورة الذهنية للمؤسسة في السوق", "فجوة الصورة الذهنية", "مؤشر عرض القيمة للموظفين", "نسبة تنفيذ مبادرات التحسين", "تحسن الصورة الذهنية وعرض القيمة"][index] })),
};

function requireKnown(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

vi.mock("@/lib/projects/commands", () => ({
    createProject: vi.fn(async (input: any) => {
        requireKnown(input.managerId === ids.manager && input.sponsorId === ids.manager, "unknown project user reference");
        requireKnown(input.responsibleDepartmentId === ids.department, "unknown project department reference");
        input.objectives.forEach((objective: any) => requireKnown(directory.kpis.some((kpi) => kpi.id === objective.kpiId), "unknown objective KPI reference"));
        const project = {
            id: ids.project, ...input,
            objectives: input.objectives.map((item: any, index: number) => ({ ...item, id: ids.objectives[index], projectId: ids.project })),
            outputs: input.outputs.map((item: any, index: number) => ({ ...item, id: ids.outputs[index], projectId: ids.project })),
            stages: [], tasks: [], members: [],
        };
        projectState.current = project;
        return structuredClone(project);
    }),
    getProjectForActor: vi.fn(async (id: string) => {
        requireKnown(id === ids.project && projectState.current, "unknown project read-back reference");
        return structuredClone({ ...projectState.current, stages: stageState.current, tasks: Array.from(taskState.values()) });
    }),
    updateProject: vi.fn(), listProjectsForActor: vi.fn(async () => []),
}));
vi.mock("@/lib/tasks/commands", () => ({
    createTask: vi.fn(async (input: any, actor: any) => {
        requireKnown(input.projectId === ids.project && projectState.current, "unknown task project reference");
        requireKnown(stageState.current.some((stage) => stage.id === input.stageId), "unknown task stage reference");
        requireKnown(directory.kpis.some((kpi) => kpi.id === input.kpiId), "unknown task KPI reference");
        const index = taskState.size;
        const task = { id: ids.tasks[index], ...input, createdById: actor.id, project: { id: ids.project }, stage: { id: input.stageId }, kpi: { id: input.kpiId } };
        requireKnown(task.id, "task ID allocation failed");
        taskState.set(task.id, task);
        return structuredClone(task);
    }),
    getTaskForActor: vi.fn(async (id: string) => structuredClone(taskState.get(id) ?? null)),
    listTasksForActor: vi.fn(async () => []),
}));
vi.mock("@/lib/kpis/commands", () => ({
    linkProjectObjective: vi.fn(async (input: any) => {
        const objective = projectState.current?.objectives.find((item: any) => item.id === input.projectObjectiveId);
        requireKnown(objective, "unknown project objective reference");
        requireKnown(directory.kpis.some((kpi) => kpi.id === input.kpiId), "unknown KPI reference");
        const linked = { ...directory.kpis.find((kpi) => kpi.id === input.kpiId), projectId: ids.project, projectObjectiveId: input.projectObjectiveId };
        executeCalls.set(input.kpiId, (executeCalls.get(input.kpiId) ?? 0) + 1);
        kpiState.set(input.kpiId, linked);
        projectState.current.objectives = projectState.current.objectives.map((item: any) => item.id === objective.id ? { ...item, kpiId: input.kpiId } : item);
        return structuredClone(linked);
    }),
    getKpiForActor: vi.fn(async (id: string) => structuredClone(kpiState.get(id) ?? null)),
    listKpisForActor: vi.fn(async () => []), createKpi: vi.fn(), updateKpi: vi.fn(), logKpiUpdate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        $transaction: vi.fn(async (callback: any) => callback({
            project: { findUnique: vi.fn(async ({ where }: any) => where.id === ids.project ? { id: ids.project } : null) },
            projectStage: {
                count: vi.fn(async ({ where }: any) => where.projectId === ids.project ? stageState.current.length : 0),
                createMany: vi.fn(async ({ data }: any) => {
                    data.forEach((row: any, index: number) => requireKnown(row.projectId === ids.project, "unknown stage project reference"));
                    stageState.current = data.map((row: any, index: number) => ({ ...row, id: ids.stages[index], projectId: ids.project }));
                    return { count: data.length };
                }),
                findMany: vi.fn(async ({ where }: any) => where.projectId === ids.project ? [...stageState.current].sort((a, b) => a.order - b.order) : []),
            },
            auditLog: { create: vi.fn() },
        })),
        aiOperationalLog: { create: vi.fn() }, aiWorkflowEvent: { create: vi.fn() },
    },
}));

import { createProject, getProjectForActor } from "@/lib/projects/commands";
import { createTask, getTaskForActor } from "@/lib/tasks/commands";
import { getKpiForActor } from "@/lib/kpis/commands";
import { CapabilityRegistry } from "./registry";
import { registerCoreWorkCapabilities } from "./register-core-work";
import { previewCapability, runCapability, type CapabilityResultStore } from "./runner";
import { projectCreateItemCount } from "./modules/projects";
import { buildEvpWorkflow, evpProjectFixture, resolveEvpFixture } from "../fixtures/evp-project";
import { proposedWorkflowSchema } from "../workflows/schemas";
import type { DuplicateDb } from "@/lib/sabah/intelligence/duplicates";

class MemoryStore implements CapabilityResultStore {
    results = new Map<string, { state: any; output: unknown }>();
    async getPriorResult(key: string) { return this.results.get(key) ?? null; }
    async saveResult(key: string, result: { state: any; output: unknown }) { this.results.set(key, result); }
    async markCompensated() {}
    isCompensated() { return false; }
}
const actor = { id: ids.actor, role: "ADMIN" as const, departmentIds: [ids.department] };
const emptyDuplicateDb = {
    scopeDb: { project: { findMany: async () => [] }, task: { findMany: async () => [] } },
    loadCandidates: async () => [],
} satisfies DuplicateDb;
const context = { requestId: "request-1", conversationId: null, workflowId: "workflow-1", actor, now: new Date("2026-01-01T00:00:00.000Z"), duplicateDb: emptyDuplicateDb };
const fakeDb = () => ({ aiOperationalLog: { create: vi.fn(async () => undefined) }, aiWorkflowEvent: { create: vi.fn(async () => undefined) } }) as any;

function resolveRefs(value: unknown, outputs: Map<string, any>): unknown {
    if (Array.isArray(value)) return value.map((item) => resolveRefs(item, outputs));
    if (!value || typeof value !== "object") return value;
    const ref = value as any;
    if (typeof ref.from === "string") {
        let found = outputs.get(ref.from);
        for (const part of String(ref.path).split(".")) found = found?.[part];
        if (ref.index !== undefined) {
            requireKnown(Array.isArray(found), `workflow output ${ref.from}.${ref.path} is not indexable`);
            found = found[ref.index];
        }
        requireKnown(found !== undefined, `missing workflow output ${ref.from}.${ref.path}`);
        return found?.id ?? found;
    }
    return Object.fromEntries(Object.entries(ref).map(([key, item]) => [key, resolveRefs(item, outputs)]));
}

async function executeWithDependencies(workflow: ReturnType<typeof buildEvpWorkflow>, registry: CapabilityRegistry, store: MemoryStore) {
    const pending = new Map(workflow.steps.map((step) => [step.clientStepId, step]));
    const outputs = new Map<string, any>();
    const completed = new Set<string>();
    const executionOrder: string[] = [];
    const deps: any = { registry, db: fakeDb(), store, now: () => context.now, flags: { platform: true, writes: true, memory: true, multimodal: true, monitors: true } };
    while (pending.size) {
        const runnable = Array.from(pending.values()).filter((step) => step.dependsOn.every((id: string) => completed.has(id)));
        requireKnown(runnable.length > 0, "workflow dependency graph is blocked or cyclic");
        const step = runnable[0];
        for (const dependency of step.dependsOn) requireKnown(completed.has(dependency), `dependency ${dependency} was not completed`);
        const input = resolveRefs(step.args, outputs);
        const preview = await previewCapability({ name: step.capability, version: 1, input, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: step.capability === "projects.create" ? projectCreateItemCount(input as any) : 1, approvalMode: "SMART" }, context, deps);
        const requiresApproval = step.capability === "projects.create" || step.capability === "tasks.create" || step.capability === "kpis.linkProjectObjective";
        expect(preview.state).toBe(requiresApproval ? "APPROVAL_REQUIRED" : "ALLOWED_PREVIEW");
        const request: any = { name: step.capability, version: 1, input, explicitUserRequest: true, hasInferredReplacement: false, confidence: 1, itemCount: step.capability === "projects.create" ? projectCreateItemCount(input as any) : 1, approvalMode: "SMART", idempotencyKey: `evp:${step.clientStepId}` };
        const blocked = await runCapability(request, context, deps);
        if (requiresApproval) expect(blocked.state).toBe("APPROVAL_REQUIRED");
        const result = await runCapability({ ...request, approved: true }, context, deps);
        expect(result.state).toBe("VERIFIED");
        const retry = await runCapability({ ...request, approved: true }, context, deps);
        expect(retry).toEqual(result);
        outputs.set(step.clientStepId, result.output);
        executionOrder.push(step.clientStepId);
        completed.add(step.clientStepId); pending.delete(step.clientStepId);
    }
    return { outputs, executionOrder, store };
}

describe("EVP cross-module capability workflow", () => {
    beforeEach(() => { vi.clearAllMocks(); projectState.current = null; stageState.current = []; taskState.clear(); kpiState.clear(); executeCalls.clear(); });

    it("registers actual Project/Task/KPI definitions idempotently, rejects duplicate versions, and describes all modules", async () => {
        const registry = new CapabilityRegistry();
        registerCoreWorkCapabilities(registry);
        registerCoreWorkCapabilities(registry);
        const found = await registry.search("", actor);
        expect(new Set(found.map((item) => item.module))).toEqual(new Set(["projects", "tasks", "kpis"]));
        expect(await registry.describe([{ name: "projects.create", version: 1 }, { name: "tasks.create", version: 1 }, { name: "kpis.linkProjectObjective", version: 1 }], actor)).toHaveLength(3);
        expect(() => registry.register(registry.resolve("projects.create", 1))).toThrow("projects.create@1 already registered");
    });

    it("resolves canonical EVP references and proves material read-backs and dependency order", async () => {
        const resolved = resolveEvpFixture(directory);
        expect(resolved).toEqual({ responsibleDepartmentId: ids.department, managerId: ids.manager, sponsorId: ids.manager, kpiIds: Object.fromEntries(evpProjectFixture.plan.map((item, index) => [item.kpi, ids.kpis[index]])) });
        const workflow = buildEvpWorkflow(resolved);
        expect(proposedWorkflowSchema.parse(workflow)).toEqual(workflow);
        expect(workflow.steps.find((step) => step.capability === "projects.create")?.args).toMatchObject({ name: evpProjectFixture.name, startAt: evpProjectFixture.startAt, dueAt: evpProjectFixture.dueAt, managerId: ids.manager, sponsorId: ids.manager, responsibleDepartmentId: ids.department });
        expect((new Date(evpProjectFixture.dueAt).getUTCFullYear() * 12 + new Date(evpProjectFixture.dueAt).getUTCMonth()) - (new Date(evpProjectFixture.startAt).getUTCFullYear() * 12 + new Date(evpProjectFixture.startAt).getUTCMonth()) + 1).toBe(6);
        const registry = new CapabilityRegistry(); registerCoreWorkCapabilities(registry);
        const run = await executeWithDependencies(workflow, registry, new MemoryStore());
        const project = run.outputs.get("project-create");
        const projectReadBack = await getProjectForActor(ids.project, actor);
        expect(project?.id).toBe(projectReadBack?.id);
        expect(project?.objectives).toEqual(projectReadBack?.objectives);
        expect(project?.outputs).toEqual(projectReadBack?.outputs);
        expect(projectReadBack?.objectives).toHaveLength(evpProjectFixture.plan.length);
        expect(projectReadBack?.outputs).toHaveLength(evpProjectFixture.outputs.length);
        const stagesOutput = run.outputs.get("stages-initialize");
        const stagesReadBack = (await getProjectForActor(ids.project, actor))?.stages;
        expect(stagesOutput?.stages.map((stage: any) => ({ id: stage.id, projectId: stage.projectId, name: stage.name, order: stage.order }))).toEqual(stagesReadBack?.map((stage: any) => ({ id: stage.id, projectId: stage.projectId, name: stage.name, order: stage.order })));
        expect(stagesReadBack?.map((stage: any) => stage.name)).toEqual(evpProjectFixture.stages.map((stage) => stage.name));
        expect(stagesReadBack?.map((stage: any) => stage.order)).toEqual([0, 1, 2, 3, 4]);
        expect(Array.from(taskState.values())).toHaveLength(evpProjectFixture.plan.length);
        for (const task of Array.from(taskState.values())) {
            const taskStep = run.outputs.get(`task-${evpProjectFixture.plan.find((item) => item.title === task.title)?.id}`);
            const { entityLinks, ...taskResult } = taskStep as Record<string, unknown>;
            expect(taskResult).toEqual(await getTaskForActor(task.id, actor));
            expect(entityLinks).toEqual([{ type: "TASK", id: task.id, href: `/tasks/${encodeURIComponent(task.id)}`, label: taskResult.title ?? task.id }]);
            expect(taskStep).toEqual(expect.objectContaining({ id: task.id, projectId: ids.project, stageId: task.stageId, kpiId: task.kpiId }));
        }
        for (const kpiId of ids.kpis) {
            const kpi = await getKpiForActor(kpiId, actor);
            const linkStep = evpProjectFixture.plan.find((item) => resolved.kpiIds[item.kpi] === kpiId)?.id;
            expect(run.outputs.get(`kpi-link-${linkStep}`)).toEqual(kpi);
            expect(kpi).toEqual(expect.objectContaining({ id: kpiId, projectId: ids.project }));
            expect(executeCalls.get(kpiId)).toBe(1);
            expect(projectReadBack?.objectives.some((objective: any) => objective.id === kpi?.projectObjectiveId && objective.projectId === ids.project)).toBe(true);
        }
        for (const step of workflow.steps) {
            const position = run.executionOrder.indexOf(step.clientStepId);
            expect(step.dependsOn.every((dependency) => run.executionOrder.indexOf(dependency) < position)).toBe(true);
            expect(run.store.results.has(`evp:${step.clientStepId}`)).toBe(true);
        }
        expect(createProject).toHaveBeenCalledTimes(1);
        expect(createTask).toHaveBeenCalledTimes(evpProjectFixture.plan.length);
        expect((getProjectForActor as any).mock.calls.length).toBeGreaterThan(0);
        expect((getTaskForActor as any).mock.calls.length).toBeGreaterThan(0);
        expect((getKpiForActor as any).mock.calls.length).toBeGreaterThan(0);
    });
});
