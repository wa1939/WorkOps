import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logAiAction } from "@/lib/ai/audit";
import { isWhitelistedTool } from "@/lib/ai/tools";
import { executeListPmoActions, executeGetPmoAction, executeDraftPmoFollowUp } from "@/lib/ai/pmo-executors";
import { createTask, createTasks as commandCreateTasks, cancelCreatedTasks as commandCancelCreatedTasks, updateTaskStatus as commandUpdateTaskStatus, getTaskForActor, listTasksForActor, reassignTask as commandReassignTask, updateTask as commandUpdateTask } from "@/lib/tasks/commands";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { getSabahFlags } from "@/lib/sabah/flags";
import { assertCapabilityAllowed } from "@/lib/sabah/security/hard-boundaries";
import { registerWorkspaceCapabilitySet } from "@/lib/sabah/capabilities/register-workspace";
import { createLearningCapabilities, getLearningDependencies, learningContext } from "@/lib/sabah/capabilities/modules/learning";
import { capabilityRegistry } from "@/lib/sabah/capabilities/registry";
import { registerOperationalCapabilities } from "@/lib/sabah/capabilities/register-operational";
import { registerLearningCapabilities } from "@/lib/sabah/capabilities/modules/learning";
import { listCapabilities, getCapabilityDetails, ListCapabilitiesInputSchema, GetCapabilityDetailsInputSchema } from "@/lib/sabah/tools/meta-tools";
import { proposedWorkflowSchema } from "@/lib/sabah/workflows/schemas";
import { assertApprovedWorkflowIntent, executeNextStep, proposeWorkflow } from "@/lib/sabah/workflows/service";
import { canonicalizeKpiLogUpdate } from "@/lib/sabah/capabilities/kpi-canonicalizer";
import crypto from "crypto";

export type ExecutorContext = {
    userId: string;
    userRole: string;
    conversationId?: string | null;
    /** A client may reference a workflow, but the server revalidates its approval and exact args. */
    approvedWorkflowId?: string | null;
};

export type ToolResult =
    | { ok: true; data: unknown }
    | { ok: false; error: string };

/** Legacy users with the old MANAGER role are Sabah LEADs, not admins. */
export function taskCommandRole(role: string): string {
    return role === "MANAGER" ? "LEAD" : role;
}

const createTaskSchema = z
    .object({
        title: z.string().min(1, "title is required"),
        description: z.string().optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        status: z.enum(["TODO", "DOING", "BLOCKED", "WAITING", "DONE"]).optional(),
        dueAt: z.string().optional(),
        projectId: z.string().optional(),
        kpiId: z.string().optional(),
        assigneeIds: z.array(z.string()).max(20).optional(),
        effortHours: z.number().positive().max(1000).optional(),
    })
    .strict();

const createTasksSchema = z
    .object({
        tasks: z.array(createTaskSchema).min(1).max(100),
        allowPartial: z.boolean().optional(),
        sharedDueAt: z.string().optional(),
        sharedPriority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        sharedProjectId: z.string().optional(),
    })
    .strict();

const updateTaskStatusSchema = z
    .object({
        taskId: z.string().min(1),
        status: z.enum(["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"]),
    })
    .strict();

const listMyTasksSchema = z
    .object({
        status: z.enum(["TODO", "DOING", "BLOCKED", "WAITING", "DONE", "CANCELED"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
    })
    .strict();

const searchTasksSchema = z
    .object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
    })
    .strict();

const emptySchema = z.object({}).strict();
const WRITES_DISABLED_ERROR =
    "Write actions are currently disabled pending release gates (SABAH_WRITES_ENABLED). " +
    "Tell the user this change was not applied and must wait until writes are enabled.";
const DIRECT_WRITE_APPROVAL_ERROR =
    "Direct chat writes require an approved workflow; no operational change was applied. Use proposeWorkflow to present the action for inline confirmation in this conversation.";
const proposeWorkflowToolSchema = z.object({
    goal: z.unknown(),
    steps: z.unknown(),
    idempotencyKey: z.string().min(1).max(160).optional(),
}).strict();

async function executeProposeWorkflow(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    if (!ctx.conversationId) return { ok: false, error: "A persisted conversation is required to propose a workflow." };
    if (!getSabahFlags().writes) return { ok: false, error: WRITES_DISABLED_ERROR };
    const envelope = proposeWorkflowToolSchema.parse(rawParams);
    const proposed = proposedWorkflowSchema.parse({ goal: envelope.goal, steps: envelope.steps });
    const actor = await toSabahActor({ id: ctx.userId, role: taskCommandRole(ctx.userRole) });
    const canonical = {
        ...proposed,
        steps: await Promise.all(proposed.steps.map(async (step) => ({
            ...step,
            args: await canonicalWorkflowArgs(step.capability, step.args, ctx),
        }))),
    };
    const idempotencyKey = envelope.idempotencyKey ?? crypto.createHash("sha256").update(JSON.stringify({ conversationId: ctx.conversationId, canonical })).digest("hex");
    const workflow = await proposeWorkflow(actor, { ...canonical, conversationId: ctx.conversationId, idempotencyKey });
    return { ok: true, data: workflow };
}

const listProjectsSchema = z
    .object({
        limit: z.number().int().min(1).max(50).optional(),
    })
    .strict();

const listTeamMembersSchema = z
    .object({
        query: z.string().optional(),
    })
    .strict();

const listKpisSchema = z
    .object({
        perspective: z.string().optional(),
    })
    .strict();

const getTaskSchema = z
    .object({
        taskId: z.string().min(1),
    })
    .strict();

function parseDueDate(raw: string | undefined): Date | null {
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d;
}

export function resolveAssigneeIds(raw: string[] | undefined, userId: string): string[] | undefined {
    if (!raw || raw.length === 0) return undefined;
    const resolved = raw.map((id) => {
        const lower = id.toLowerCase().trim();
        if (lower === "@me" || lower === "me" || lower === "myself" || lower === "current user") {
            return userId;
        }
        return id;
    });
    return Array.from(new Set(resolved));
}

/** Creation-time assignees: same resolution, but NEVER empty — an unassigned
 *  chat-created task is invisible on "my tasks", so default to the requester. */
export function assigneesForCreate(raw: string[] | undefined, userId: string): string[] {
    return resolveAssigneeIds(raw, userId) ?? [userId];
}

async function createOneTask(params: z.infer<typeof createTaskSchema>, ctx: ExecutorContext): Promise<ToolResult> {
    try {
        const task = await createTask({ ...params, assigneeIds: assigneesForCreate(params.assigneeIds, ctx.userId), dueAt: params.dueAt ?? null }, { id: ctx.userId, role: taskCommandRole(ctx.userRole) as any }, prisma);
        return { ok: true, data: { id: task.id, title: task.title, status: task.status, priority: task.priority, dueAt: task.dueAt?.toISOString() ?? null, projectName: task.project?.name ?? null, assignees: (task.assignments ?? []).map((a: any) => ({ id: a.userId, name: a.user?.name, email: a.user?.email })), url: `/tasks/${task.id}` } };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

async function executeCreateTask(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = createTaskSchema.parse(rawParams);
    return createOneTask(params, ctx);
}

function normalizeCreateTasksParams(raw: unknown): unknown {
    if (!raw || typeof raw !== "object") return raw;
    const r = raw as Record<string, unknown>;
    if (!Array.isArray(r.tasks)) return raw;

    const shared: Record<string, unknown> = {
        sharedDueAt: r.sharedDueAt,
        sharedPriority: r.sharedPriority,
        sharedProjectId: r.sharedProjectId,
    };

    const cleanedTasks = r.tasks.map((t) => {
        if (!t || typeof t !== "object") return t;
        const task = { ...(t as Record<string, unknown>) };
        for (const key of ["sharedDueAt", "sharedPriority", "sharedProjectId"] as const) {
            if (task[key] !== undefined && shared[key] === undefined) {
                shared[key] = task[key];
            }
            delete task[key];
        }
        return task;
    });

    return { ...r, ...shared, tasks: cleanedTasks };
}

const cancelCreatedTasksSchema = z.object({ taskIds: z.array(z.string().min(1)).min(1).max(100) }).strict();

async function executeCancelCreatedTasks(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = cancelCreatedTasksSchema.parse(rawParams);
    try { return { ok: true, data: await commandCancelCreatedTasks(params.taskIds, { id: ctx.userId, role: taskCommandRole(ctx.userRole) as any }, prisma) }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

async function executeCreateTasks(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const parsed = createTasksSchema.parse(normalizeCreateTasksParams(rawParams));

    const merged = parsed.tasks.map((t) => ({
        ...t,
        dueAt: t.dueAt ?? parsed.sharedDueAt,
        priority: t.priority ?? parsed.sharedPriority,
        projectId: t.projectId ?? parsed.sharedProjectId,
    }));

    const results = await commandCreateTasks(merged.map((t) => ({ ...t, assigneeIds: assigneesForCreate(t.assigneeIds, ctx.userId), dueAt: t.dueAt ?? null })), { id: ctx.userId, role: taskCommandRole(ctx.userRole) as any }, prisma, { allowPartial: parsed.allowPartial === true });
    return { ok: true, data: { createdCount: results.filter((r) => r.ok).length, failedCount: results.filter((r) => !r.ok).length, tasks: results.filter((r): r is { ok: true; data: unknown; index: number } => r.ok).map((r) => r.data), errors: results.filter((r) => !r.ok).map((r) => ({ index: r.index, title: merged[r.index].title, error: r.error })) } };
}

async function executeUpdateTaskStatus(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = updateTaskStatusSchema.parse(rawParams);
    try { const task = await commandUpdateTaskStatus(params.taskId, params.status, { id: ctx.userId, role: taskCommandRole(ctx.userRole) as any }, prisma); return { ok: true, data: { id: task.id, title: task.title, status: task.status } }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

function boundedTaskResult(tasks: any[], limit: number): ToolResult {
    const items = tasks.slice(0, limit).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, dueAt: t.dueAt?.toISOString() ?? null, projectName: t.project?.name ?? null, url: `/tasks/${t.id}` }));
    return { ok: true, data: { items, returnedCount: items.length, limit, hasMore: tasks.length > limit, countsScope: "returned_items_only" } };
}

async function executeListMyTasks(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = listMyTasksSchema.parse(rawParams);
    const limit = params.limit ?? 20;
    const tasks = await listTasksForActor({ status: params.status, assigneeId: ctx.userId, limit: limit + 1 }, { id: ctx.userId, role: ctx.userRole as any }, prisma);
    return boundedTaskResult(tasks, limit);
}

async function executeSearchTasks(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = searchTasksSchema.parse(rawParams);
    const limit = params.limit ?? 20;
    const tasks = await listTasksForActor({ search: params.query, limit: limit + 1 }, { id: ctx.userId, role: ctx.userRole as any }, prisma);
    return boundedTaskResult(tasks, limit);
}

async function executeGetTaskStats(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    emptySchema.parse(rawParams);
    const groups = await prisma.task.groupBy({
        by: ["status", "priority"],
        where: { assignments: { some: { userId: ctx.userId } } },
        _count: true,
    });
    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const openByPriority: Record<string, number> = {};
    let total = 0;
    let openTotal = 0;
    for (const group of groups) {
        byStatus[group.status] = (byStatus[group.status] ?? 0) + group._count;
        byPriority[group.priority] = (byPriority[group.priority] ?? 0) + group._count;
        total += group._count;
        if (group.status !== "DONE" && group.status !== "CANCELED") {
            openByPriority[group.priority] = (openByPriority[group.priority] ?? 0) + group._count;
            openTotal += group._count;
        }
    }
    return { ok: true, data: { total, byStatus, byPriority, openTotal, openByPriority, countsScope: "all_assigned_tasks" } };
}

async function executeListProjects(rawParams: unknown): Promise<ToolResult> {
    const params = listProjectsSchema.parse(rawParams);
    const limit = params.limit ?? 20;

    const projects = await prisma.project.findMany({
        where: { status: { not: "Done" } },
        include: { _count: { select: { tasks: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
    });

    return {
        ok: true,
        data: projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            taskCount: p._count.tasks,
            dueAt: p.dueAt?.toISOString() ?? null,
        })),
    };
}

/** Where-clause for team lookup: name, email, or comma-separated aliases (kunyas). */
export function teamMemberWhere(query?: string) {
    return {
        isActive: true,
        ...(query
            ? {
                  OR: [
                      { name: { contains: query, mode: "insensitive" as const } },
                      { email: { contains: query, mode: "insensitive" as const } },
                      { aliases: { contains: query, mode: "insensitive" as const } },
                  ],
              }
            : {}),
    };
}

async function executeListTeamMembers(rawParams: unknown): Promise<ToolResult> {
    const params = listTeamMembersSchema.parse(rawParams);

    const users = await prisma.user.findMany({
        where: teamMemberWhere(params.query),
        select: { id: true, name: true, email: true, role: true, aliases: true },
        orderBy: { name: "asc" },
        take: 50,
    });

    return { ok: true, data: users };
}

async function executeListKpis(rawParams: unknown): Promise<ToolResult> {
    const params = listKpisSchema.parse(rawParams);

    const kpis = await prisma.kPI.findMany({
        where: params.perspective ? { perspective: { contains: params.perspective, mode: "insensitive" } } : {},
        select: { id: true, name: true, perspective: true, objective: true, annualTarget: true, unit: true },
        orderBy: { perspective: "asc" },
        take: 50,
    });

    return { ok: true, data: kpis };
}

async function executeGetTask(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = getTaskSchema.parse(rawParams);
    try { const task: any = await getTaskForActor(params.taskId, { id: ctx.userId, role: ctx.userRole as any }, prisma); return { ok: true, data: { id: task.id, title: task.title, description: task.description, status: task.status, priority: task.priority, dueAt: task.dueAt?.toISOString() ?? null, doneAt: task.doneAt?.toISOString() ?? null, project: task.project, kpi: task.kpi, createdBy: task.createdBy, assignees: (task.assignments ?? []).map((a: any) => a.user), comments: task.comments, links: task.links, dependencies: task.dependencies, blockers: task.blockers, url: `/tasks/${task.id}` } }; }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

const reassignTaskSchema = z
    .object({
        taskId: z.string().min(1),
        assigneeIds: z.array(z.string()).max(20),
    })
    .strict();

const updateTaskFieldsSchema = z
    .object({
        taskId: z.string().min(1),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
        dueAt: z.string().optional(),
        effortHours: z.number().positive().max(1000).optional(),
        projectId: z.string().optional(),
        isStarred: z.boolean().optional(),
    })
    .strict();

const logKpiUpdateSchema = z
    .object({
        kpiId: z.string().min(1),
        quarter: z.enum(["Q1", "Q2", "Q3", "Q4", "ANNUAL"]),
        value: z.number().optional(),
        score: z.number().min(0).max(5).optional(),
        achievementPercent: z.number().min(0).max(200).optional(),
        note: z.string().max(1000).optional(),
    })
    .strict();

type DirectWriteInput = { capability: string; input: Record<string, unknown> };

async function canonicalWorkflowArgs(capability: string, args: Record<string, unknown>, ctx: ExecutorContext): Promise<Record<string, unknown>> {
    if (capability === "tasks.create") {
        const task = createTaskSchema.parse(args);
        return { ...task, assigneeIds: assigneesForCreate(task.assigneeIds, ctx.userId), dueAt: task.dueAt ?? null };
    }
    if (capability === "tasks.createMany") {
        const parsed = createTasksSchema.parse(normalizeCreateTasksParams(args));
        return {
            tasks: parsed.tasks.map((task) => ({
                ...task,
                dueAt: task.dueAt ?? parsed.sharedDueAt ?? null,
                priority: task.priority ?? parsed.sharedPriority,
                projectId: task.projectId ?? parsed.sharedProjectId,
                assigneeIds: assigneesForCreate(task.assigneeIds, ctx.userId),
            })),
            allowPartial: parsed.allowPartial === true,
        };
    }
    if (capability === "kpis.logUpdate") {
        const candidate = canonicalizeKpiLogUpdate(args);
        const kpi = await prisma.kPI.findUnique({ where: { id: String(candidate.id) }, select: { updatedAt: true } });
        if (!kpi) throw new Error(`KPI ${String(candidate.id)} not found.`);
        // Bind the optimistic-concurrency version to the proposal snapshot;
        // execution must never replace it with a later live value.
        return canonicalizeKpiLogUpdate(args, new Date(kpi.updatedAt).toISOString());
    }
    return args;
}

/** Normalize legacy chat tool shapes to the canonical capability contracts. */
async function directWriteInput(name: string, rawParams: unknown, ctx: ExecutorContext): Promise<DirectWriteInput> {
    if (name === "createTask") {
        const params = createTaskSchema.parse(rawParams);
        return { capability: "tasks.create", input: { ...params, assigneeIds: assigneesForCreate(params.assigneeIds, ctx.userId), dueAt: params.dueAt ?? null } };
    }
    if (name === "createTasks") {
        const parsed = createTasksSchema.parse(normalizeCreateTasksParams(rawParams));
        const tasks = parsed.tasks.map((task) => ({
            ...task,
            dueAt: task.dueAt ?? parsed.sharedDueAt ?? null,
            priority: task.priority ?? parsed.sharedPriority,
            projectId: task.projectId ?? parsed.sharedProjectId,
            assigneeIds: assigneesForCreate(task.assigneeIds, ctx.userId),
        }));
        return { capability: "tasks.createMany", input: { tasks, allowPartial: parsed.allowPartial === true } };
    }
    if (name === "cancelCreatedTasks") {
        const params = cancelCreatedTasksSchema.parse(rawParams);
        return { capability: "tasks.cancelCreated", input: { ids: params.taskIds } };
    }
    if (name === "updateTaskStatus") {
        const params = updateTaskStatusSchema.parse(rawParams);
        return { capability: "tasks.updateStatus", input: { id: params.taskId, status: params.status } };
    }
    if (name === "reassignTask") {
        const params = reassignTaskSchema.parse(rawParams);
        return { capability: "tasks.reassign", input: { id: params.taskId, assigneeIds: resolveAssigneeIds(params.assigneeIds, ctx.userId) ?? [] } };
    }
    if (name === "updateTaskFields") {
        const params = updateTaskFieldsSchema.parse(rawParams);
        const data: Record<string, unknown> = {};
        if (params.priority !== undefined) data.priority = params.priority;
        if (params.dueAt !== undefined) {
            if (params.dueAt !== "null" && !parseDueDate(params.dueAt)) throw new Error(`Invalid dueAt: ${params.dueAt}`);
            data.dueAt = params.dueAt === "null" ? null : params.dueAt;
        }
        if (params.effortHours !== undefined) data.effortHours = params.effortHours;
        if (params.projectId !== undefined) data.projectId = params.projectId === "null" ? null : params.projectId;
        if (params.isStarred !== undefined) data.isStarred = params.isStarred;
        if (!Object.keys(data).length) throw new Error("No fields to update.");
        return { capability: "tasks.update", input: { id: params.taskId, ...data } };
    }
    if (name === "logKpiUpdate") {
        const params = logKpiUpdateSchema.parse(rawParams);
        if (params.value === undefined || params.achievementPercent !== undefined) {
            throw new Error("This KPI chat write must be proposed through the governed KPI capability.");
        }
        return {
            capability: "kpis.logUpdate",
            // The approval service resolves the captured expectedUpdatedAt from
            // the persisted proposal; do not inject the live KPI version here.
            input: canonicalizeKpiLogUpdate({
                kpiId: params.kpiId,
                value: params.value,
                note: params.note ?? null,
                quarter: params.quarter,
                ...(params.score === undefined ? {} : { score: params.score }),
            }),
        };
    }
    throw new Error(`Tool '${name}' is not a direct write capability.`);
}

/** Execute only a step whose approval was verified from the durable workflow. */
async function executeApprovedDirectWrite(name: string, rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    if (!ctx.conversationId || !ctx.approvedWorkflowId) return { ok: false, error: DIRECT_WRITE_APPROVAL_ERROR };
    const actor = await toSabahActor({ id: ctx.userId, role: taskCommandRole(ctx.userRole) });
    const proposed = await directWriteInput(name, rawParams, ctx);
    const intent = await assertApprovedWorkflowIntent(actor, {
        workflowId: ctx.approvedWorkflowId,
        conversationId: ctx.conversationId,
        capability: proposed.capability,
        input: proposed.input,
    });
    const { getRunnerDeps } = await import("@/lib/sabah/capabilities/runner-deps");
    const snapshot = await executeNextStep(actor, intent.workflowId, undefined, getRunnerDeps(), { requestedStepId: intent.stepId, conversationId: ctx.conversationId });
    const verifiedStep = snapshot.steps.find((step) => step.id === intent.stepId || step.clientStepId === intent.stepId);
    const resultValue = verifiedStep && (verifiedStep.resultSummary?.trim() || (verifiedStep as unknown as { result?: unknown }).result != null || (verifiedStep as unknown as { output?: unknown }).output != null);
    if (snapshot.status === "FAILED" || snapshot.status === "CANCELED" || verifiedStep?.status !== "VERIFIED" || !resultValue) {
        const status = verifiedStep?.status ?? snapshot.status;
        return { ok: false, error: `Direct write was not verified (step status: ${status}).` };
    }
    return { ok: true, data: snapshot };
}

const whatShouldIWorkOnNextSchema = z
    .object({
        limit: z.number().int().min(1).max(8).optional(),
    })
    .strict();

async function executeReassignTask(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = reassignTaskSchema.parse(rawParams);
    const assigneeIds = resolveAssigneeIds(params.assigneeIds, ctx.userId) ?? [];

    try { const task: any = await commandReassignTask(params.taskId, assigneeIds, { id: ctx.userId, role: taskCommandRole(ctx.userRole) as any }, prisma); return { ok: true, data: { id: task.id, title: task.title, assigneeIds } }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

async function executeUpdateTaskFields(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = updateTaskFieldsSchema.parse(rawParams); const data: Record<string, unknown> = {};
    if (params.priority !== undefined) data.priority = params.priority;
    if (params.dueAt !== undefined) { if (params.dueAt !== "null" && !parseDueDate(params.dueAt)) return { ok: false, error: `Invalid dueAt: ${params.dueAt}` }; data.dueAt = params.dueAt === "null" ? null : params.dueAt; }
    if (params.effortHours !== undefined) data.effortHours = params.effortHours; if (params.projectId !== undefined) data.projectId = params.projectId === "null" ? null : params.projectId; if (params.isStarred !== undefined) data.isStarred = params.isStarred;
    if (!Object.keys(data).length) return { ok: false, error: "No fields to update." };
    try { const task: any = await commandUpdateTask(params.taskId, data as any, { id: ctx.userId, role: taskCommandRole(ctx.userRole) as any }, prisma); return { ok: true, data: { id: task.id, title: task.title, priority: task.priority, dueAt: task.dueAt, effortHours: task.effortHours, projectId: task.projectId, isStarred: task.isStarred } }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

async function executeLogKpiUpdate(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = logKpiUpdateSchema.parse(rawParams);

    const kpi = await prisma.kPI.findUnique({ where: { id: params.kpiId }, select: { id: true, name: true } });
    if (!kpi) return { ok: false, error: `KPI ${params.kpiId} not found.` };

    if (
        params.value === undefined &&
        params.score === undefined &&
        params.achievementPercent === undefined
    ) {
        return { ok: false, error: "At least one of value / score / achievementPercent is required." };
    }

    const update = await prisma.kPIUpdate.create({
        data: {
            kpiId: params.kpiId,
            quarter: params.quarter,
            value: params.value ?? null,
            score: params.score ?? null,
            achievementPercent: params.achievementPercent ?? null,
            note: params.note ?? null,
            createdById: ctx.userId,
        },
        select: { id: true, quarter: true, value: true, score: true, achievementPercent: true },
    });

    return { ok: true, data: { kpiId: kpi.id, kpiName: kpi.name, update } };
}

async function executeWhatShouldIWorkOnNext(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = whatShouldIWorkOnNextSchema.parse(rawParams);
    const limit = params.limit ?? 3;

    const tasks = await prisma.task.findMany({
        where: {
            assignments: { some: { userId: ctx.userId } },
            status: { notIn: ["DONE", "CANCELED"] },
        },
        include: { project: { select: { name: true } } },
        take: 50,
    });

    const priorityWeight: Record<string, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const now = Date.now();

    const scored = tasks.map((t) => {
        const daysUntilDue = t.dueAt
            ? Math.max(0.25, (new Date(t.dueAt).getTime() - now) / (24 * 60 * 60 * 1000))
            : 30;
        const pw = priorityWeight[t.priority] ?? 2;
        const isStarredBoost = t.isStarred ? 1.5 : 1;
        const isDoingBoost = t.status === "DOING" ? 1.3 : 1;
        const score = (pw / daysUntilDue) * isStarredBoost * isDoingBoost;
        const reasons: string[] = [];
        if (t.isStarred) reasons.push("starred");
        if (t.status === "DOING") reasons.push("already in progress");
        if (t.priority === "URGENT" || t.priority === "HIGH") reasons.push(`${t.priority.toLowerCase()} priority`);
        if (t.dueAt) {
            const days = Math.round(daysUntilDue);
            if (days <= 0) reasons.push("overdue");
            else if (days === 1) reasons.push("due tomorrow");
            else reasons.push(`due in ${days}d`);
        }
        return { task: t, score, reasons };
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit);

    return {
        ok: true,
        data: top.map((s) => ({
            id: s.task.id,
            title: s.task.title,
            projectName: s.task.project?.name ?? null,
            priority: s.task.priority,
            status: s.task.status,
            dueAt: s.task.dueAt?.toISOString() ?? null,
            score: Math.round(s.score * 100) / 100,
            reason: s.reasons.join(", ") || "highest score",
            url: `/tasks/${s.task.id}`,
        })),
    };
}

const getIntakeRowsSchema = z
    .object({ intakeId: z.string().min(1), offset: z.number().int().min(0).optional() })
    .strict();

/** Read a previously uploaded file (userId-scoped). Pages rows/text for the model. */
async function executeGetIntakeRows(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = getIntakeRowsSchema.parse(rawParams);
    const intake = await prisma.aiIntake.findFirst({
        where: { id: params.intakeId, userId: ctx.userId },
    });
    if (!intake) return { ok: false, error: "Intake not found." };
    const offset = params.offset ?? 0;
    if (intake.kind === "rows" && intake.rowsJson) {
        const { headers, rows } = JSON.parse(intake.rowsJson) as {
            headers: string[];
            rows: Record<string, string>[];
        };
        return {
            ok: true,
            data: { kind: "rows", filename: intake.filename, headers, total: rows.length, offset, rows: rows.slice(offset, offset + 60) },
        };
    }
    const text = intake.text ?? "";
    return {
        ok: true,
        data: { kind: "text", filename: intake.filename, total: text.length, offset, chunk: text.slice(offset, offset + 6000) },
    };
}

const proposeMemoryOrPlaybookUpdateSchema = z.object({ kind: z.enum(["memory", "playbook"]), proposal: z.record(z.unknown()) }).strict();
async function executeProposeMemoryOrPlaybookUpdate(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = proposeMemoryOrPlaybookUpdateSchema.parse(rawParams);
    ensureCapabilityRegistry();
    const actor = await toSabahActor({ id: ctx.userId, role: taskCommandRole(ctx.userRole) });
    const capability = createLearningCapabilities(getLearningDependencies()).proposeMemoryOrPlaybookUpdate;
    const input = capability.inputSchema.parse(params);
    const context = { actor, requestId: `ai-${ctx.userId}`, conversationId: null, workflowId: null, now: new Date() };
    if (!await capability.available(actor)) return { ok: false, error: "Learning proposal capability is unavailable." };
    await capability.authorize(input, context);
    const result = await capability.execute(input, context);
    return { ok: true, data: result };
}

const workspaceSearchSchema = z.object({ query: z.string().min(1).max(512), entityTypes: z.array(z.enum(["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"])).min(1).max(4), limit: z.number().int().min(1).max(20).optional(), cursor: z.string().max(512).optional() }).strict();
async function executeWorkspaceSearch(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const params = workspaceSearchSchema.parse(rawParams);
    const actor = await toSabahActor({ id: ctx.userId, role: taskCommandRole(ctx.userRole) });
    registerWorkspaceCapabilitySet(capabilityRegistry);
    const capability = capabilityRegistry.resolve("workspace.search");
    const data = await capability.execute(params, { actor, requestId: `ai-${ctx.userId}`, conversationId: null, workflowId: null, now: new Date() });
    return { ok: true, data };
}

let capabilityRegistryReady = false;
function ensureCapabilityRegistry(): void {
    if (capabilityRegistryReady) return;
    registerOperationalCapabilities(capabilityRegistry);
    registerWorkspaceCapabilitySet(capabilityRegistry);
    registerLearningCapabilities(capabilityRegistry, getLearningDependencies());
    capabilityRegistryReady = true;
}

async function executeListCapabilities(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const input = ListCapabilitiesInputSchema.parse(rawParams);
    ensureCapabilityRegistry();
    const actor = await toSabahActor({ id: ctx.userId, role: taskCommandRole(ctx.userRole) });
    return listCapabilities(actor, input);
}

async function executeGetCapabilityDetails(rawParams: unknown, ctx: ExecutorContext): Promise<ToolResult> {
    const input = GetCapabilityDetailsInputSchema.parse(rawParams);
    ensureCapabilityRegistry();
    const actor = await toSabahActor({ id: ctx.userId, role: taskCommandRole(ctx.userRole) });
    return getCapabilityDetails(actor, input);
}

const EXECUTORS: Record<string, (params: unknown, ctx: ExecutorContext) => Promise<ToolResult>> = {
    createTask: executeCreateTask,
    createTasks: executeCreateTasks,
    cancelCreatedTasks: executeCancelCreatedTasks,
    updateTaskStatus: executeUpdateTaskStatus,
    listMyTasks: executeListMyTasks,
    searchTasks: executeSearchTasks,
    getTaskStats: executeGetTaskStats,
    listProjects: (p) => executeListProjects(p),
    listTeamMembers: (p) => executeListTeamMembers(p),
    listKpis: (p) => executeListKpis(p),
    getTask: executeGetTask,
    reassignTask: executeReassignTask,
    updateTaskFields: executeUpdateTaskFields,
    logKpiUpdate: executeLogKpiUpdate,
    whatShouldIWorkOnNext: executeWhatShouldIWorkOnNext,
    listPmoActions: executeListPmoActions,
    getPmoAction: executeGetPmoAction,
    draftPmoFollowUp: executeDraftPmoFollowUp,
    getIntakeRows: executeGetIntakeRows,
    proposeMemoryOrPlaybookUpdate: executeProposeMemoryOrPlaybookUpdate,
    workspaceSearch: executeWorkspaceSearch,
    listCapabilities: executeListCapabilities,
    getCapabilityDetails: executeGetCapabilityDetails,
    proposeWorkflow: executeProposeWorkflow,
};

/** Chat-reachable write tools mapped to their Sabah capability names. The
 *  gate below gives runTool the same hard-boundary + writes-flag semantics as
 *  runCapability. proposeMemoryOrPlaybookUpdate is excluded: it already routes
 *  through capability.authorize/execute and only forwards a human-approval
 *  proposal without persisting anything. */
export const WRITE_TOOL_CAPABILITIES: Readonly<Record<string, string>> = Object.freeze({
    createTask: "tasks.create",
    createTasks: "tasks.createMany",
    cancelCreatedTasks: "tasks.cancelCreated",
    updateTaskStatus: "tasks.updateStatus",
    reassignTask: "tasks.reassign",
    updateTaskFields: "tasks.update",
    logKpiUpdate: "kpis.logUpdate",
});

/** Fail-closed gate for write tools: hard boundary first, then the writes flag.
 *  Returns a structured tool error (never throws) so the chat stream survives. */
async function checkWriteGate(name: string, params: unknown, ctx: ExecutorContext): Promise<ToolResult | null> {
    const capabilityName = WRITE_TOOL_CAPABILITIES[name];
    if (!capabilityName) return null;
    try {
        assertCapabilityAllowed(capabilityName);
    } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        await logAiAction({ userId: ctx.userId, tool: name, params, result: "error", error });
        return { ok: false, error };
    }
    if (!getSabahFlags().writes) {
        await logAiAction({ userId: ctx.userId, tool: name, params, result: "error", error: WRITES_DISABLED_ERROR });
        return { ok: false, error: WRITES_DISABLED_ERROR };
    }
    return null;
}

export async function runTool(
    name: string,
    rawArgs: string,
    ctx: ExecutorContext,
): Promise<ToolResult> {
    if (!isWhitelistedTool(name)) {
        await logAiAction({
            userId: ctx.userId,
            tool: name,
            params: rawArgs,
            result: "error",
            error: "Tool not whitelisted",
        });
        return { ok: false, error: `Tool '${name}' is not available.` };
    }

    const executor = EXECUTORS[name];
    if (!executor) {
        return { ok: false, error: `Tool '${name}' has no executor.` };
    }

    let params: unknown;
    try {
        params = rawArgs ? JSON.parse(rawArgs) : {};
    } catch (e) {
        return { ok: false, error: `Invalid tool arguments JSON: ${(e as Error).message}` };
    }

    const writeGateResult = await checkWriteGate(name, params, ctx);
    if (writeGateResult) {
        return writeGateResult;
    }

    try {
        const result = WRITE_TOOL_CAPABILITIES[name]
            ? await executeApprovedDirectWrite(name, params, ctx)
            : await executor(params, ctx);
        await logAiAction({
            userId: ctx.userId,
            tool: name,
            params,
            result: result.ok ? "ok" : "error",
            entityId: result.ok && typeof result.data === "object" && result.data && "id" in result.data
                ? String((result.data as { id: unknown }).id)
                : undefined,
            entityType: name === "createTask" || name === "updateTaskStatus" ? "task" : "ai-chat",
            error: result.ok ? undefined : result.error,
        });
        return result;
    } catch (e) {
        const msg = e instanceof z.ZodError
            ? `Invalid parameters: ${e.errors.map((er) => `${er.path.join(".")}: ${er.message}`).join("; ")}`
            : (e as Error).message;
        await logAiAction({
            userId: ctx.userId,
            tool: name,
            params,
            result: "error",
            error: msg,
        });
        return { ok: false, error: msg };
    }
}
