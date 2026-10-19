import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { resolveOperationalAiTarget } from "@/lib/ai/provider-resolution";
import {
    AI_RESPONSE_ERROR,
    requestQuickAdd,
    requestTaskBreakdown,
    requestTaskSummary,
    requestTitleImprovement,
} from "@/lib/ai/task-actions";
import { createTask, getTaskForActor } from "@/lib/tasks/commands";
import { taskScopeForActor, type TaskActor } from "@/lib/tasks/authorization";
import { TaskCommandError } from "@/lib/tasks/commands";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { DEFAULT_TIME_ZONE } from "@/lib/workload/calendar";
import { shiftCalendarDate } from "@/lib/pmo/date";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const taskActionSchema = z.object({
    action: z.enum(["summarize", "breakdown-preview", "breakdown", "improve-title", "parse-preview", "parse-add"]),
    summaryMode: z.enum(["briefing", "plan", "update"]).optional(),
    taskId: z.string().trim().min(1).max(200).optional(),
    tasks: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    context: z.union([z.string().max(4_000), z.record(z.unknown())]).optional(),
    text: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const TASK_ROLES = ["ADMIN", "LEAD", "MEMBER", "VIEWER"] as const;

type ActionInput = z.infer<typeof taskActionSchema>;
type SessionUser = { id?: unknown; role?: unknown };
type TaskActionTask = {
    id: string;
    title: string;
    status?: string;
    dueAt?: Date | string | null;
    description?: string | null;
    projectId?: string | null;
    workspaceId?: string | null;
    priority?: string;
};

type TaskSourceSnapshot = {
    id: string;
    title: string;
    status: string;
    dueAt: string | null;
    priority?: string;
    description?: string | null;
    projectId?: string | null;
};

class TaskActionHttpError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "TaskActionHttpError";
    }
}

function actorFor(user: SessionUser | undefined): TaskActor | null {
    if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
    const role = typeof user.role === "string" && TASK_ROLES.includes(user.role as (typeof TASK_ROLES)[number])
        ? user.role
        : "MEMBER";
    return { id: user.id, role: role as TaskActor["role"] };
}

function errorResponse(error: unknown): Response {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
    if (error instanceof TaskActionHttpError || error instanceof TaskCommandError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to run AI task action", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI task action failed" }, { status: 500 });
}

async function textOptions() {
    const target = await resolveOperationalAiTarget();
    return {
        provider: target.provider,
        model: target.model,
        fallbacks: target.fallbacks,
        credentials: target.credentials,
        signal: AbortSignal.timeout(30_000),
        temperature: 0.2,
        max_tokens: 1_200,
        thinking: "disabled" as const,
    };
}

async function requireTaskAccess(actor: TaskActor, taskId: string, action: "task:view" | "task:edit"): Promise<void> {
    if (!await authorize(actor, action, { kind: "task", id: taskId })) {
        throw new TaskActionHttpError(action === "task:view" ? "Task not found" : "Forbidden", action === "task:view" ? 404 : 403);
    }
}

async function loadTask(actor: TaskActor, taskId: string, action: "task:view" | "task:edit"): Promise<TaskActionTask> {
    await requireTaskAccess(actor, taskId, action);
    const task = await getTaskForActor(taskId, actor, prisma) as TaskActionTask;
    return task;
}

function selectedTaskIds(input: ActionInput): string[] {
    const values = [...(input.tasks ?? []), ...(input.taskId ? [input.taskId] : [])];
    return Array.from(new Set(values));
}

function taskDueAt(task: TaskActionTask): string | null {
    if (task.dueAt instanceof Date) return Number.isNaN(task.dueAt.getTime()) ? null : task.dueAt.toISOString();
    if (typeof task.dueAt !== "string") return null;
    const date = new Date(task.dueAt);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function taskSourceSnapshot(task: TaskActionTask, includeDetails = false): TaskSourceSnapshot {
    return {
        id: task.id,
        title: task.title,
        status: task.status ?? "TODO",
        dueAt: taskDueAt(task),
        ...(includeDetails ? {
            priority: task.priority ?? "MEDIUM",
            description: task.description == null ? null : task.description.slice(0, 2_000),
            projectId: task.projectId ?? null,
        } : {}),
    };
}

async function summarize(actor: TaskActor, input: ActionInput): Promise<Response> {
    const ids = selectedTaskIds(input);
    if (ids.length === 0) throw new TaskActionHttpError("Select at least one task", 400);
    if (ids.length > 50) throw new TaskActionHttpError("You can summarize at most 50 tasks", 400);

    const tasks = await prisma.task.findMany({
        where: {
            AND: [
                { id: { in: ids } },
                taskScopeForActor(actor) as Record<string, unknown>,
            ],
        },
        select: { id: true, title: true, status: true, dueAt: true },
    });
    if (tasks.length !== ids.length) throw new TaskActionHttpError("One or more selected tasks are not available", 403);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const rows = ids.map((id) => {
        const task = byId.get(id);
        if (!task) throw new TaskActionHttpError("One or more selected tasks are not available", 403);
        return taskSourceSnapshot(task);
    });
    const result = await requestTaskSummary(rows, await textOptions(), input.context, input.summaryMode ?? "legacy");
    if (!result) throw new TaskActionHttpError(AI_RESPONSE_ERROR, 502);
    return NextResponse.json({ summary: result.summary, facts: result.facts, sourceSnapshot: rows });
}

async function breakdownPreview(actor: TaskActor, input: ActionInput): Promise<Response> {
    if (!input.taskId) throw new TaskActionHttpError("A taskId is required", 400);
    const parent = await loadTask(actor, input.taskId, "task:view");
    const suggestions = await requestTaskBreakdown({ title: parent.title, description: parent.description }, await textOptions(), input.context);
    if (!suggestions) throw new TaskActionHttpError(AI_RESPONSE_ERROR, 502);
    return NextResponse.json({ suggestions, sourceSnapshot: [taskSourceSnapshot(parent, true)] });
}

async function breakdown(actor: TaskActor, input: ActionInput): Promise<Response> {
    if (!input.taskId) throw new TaskActionHttpError("A taskId is required", 400);
    const parent = await loadTask(actor, input.taskId, "task:edit");
    const suggestions = await requestTaskBreakdown({ title: parent.title, description: parent.description }, await textOptions(), input.context);
    if (!suggestions) throw new TaskActionHttpError(AI_RESPONSE_ERROR, 502);

    const created = [];
    for (const suggestion of suggestions) {
        const task = await createTask({
            title: suggestion.title,
            status: "TODO",
            priority: "MEDIUM",
            effortHours: suggestion.estimateMinutes == null ? null : suggestion.estimateMinutes / 60,
            projectId: parent.projectId ?? null,
            parentTaskId: parent.id,
        }, actor, parent.workspaceId ?? undefined);
        created.push(task);
    }
    return NextResponse.json({ created }, { status: 201 });
}

async function improveTitle(actor: TaskActor, input: ActionInput): Promise<Response> {
    if (!input.taskId) throw new TaskActionHttpError("A taskId is required", 400);
    const task = await loadTask(actor, input.taskId, "task:edit");
    const suggestion = await requestTitleImprovement({ title: task.title, description: task.description }, await textOptions(), input.context);
    if (!suggestion) throw new TaskActionHttpError(AI_RESPONSE_ERROR, 502);
    return NextResponse.json({ suggestion, sourceSnapshot: [taskSourceSnapshot(task, true)] });
}

async function parsePreview(actor: TaskActor, input: ActionInput): Promise<Response> {
    if (!input.text) throw new TaskActionHttpError("Text is required", 400);
    const suggestion = await requestQuickAdd(input.text, await textOptions(), input.context);
    if (!suggestion) throw new TaskActionHttpError(AI_RESPONSE_ERROR, 502);
    return NextResponse.json({ suggestion });
}

function dueDateAfterDays(days: number): string {
    const today = formatInTimeZone(new Date(), DEFAULT_TIME_ZONE, "yyyy-MM-dd");
    const dueDate = shiftCalendarDate(today, days);
    return fromZonedTime(`${dueDate}T23:59:59.999`, DEFAULT_TIME_ZONE).toISOString();
}

async function parseAndCreate(actor: TaskActor, input: ActionInput): Promise<Response> {
    if (!input.text) throw new TaskActionHttpError("Text is required", 400);
    const suggestion = await requestQuickAdd(input.text, await textOptions(), input.context);
    if (!suggestion) throw new TaskActionHttpError(AI_RESPONSE_ERROR, 502);
    const created = await createTask({
        title: suggestion.title,
        status: "TODO",
        priority: suggestion.priority ?? "MEDIUM",
        effortHours: suggestion.estimateMinutes == null ? null : suggestion.estimateMinutes / 60,
        ...(suggestion.dueInDays == null ? {} : { dueAt: dueDateAfterDays(suggestion.dueInDays) }),
    }, actor, prisma);
    return NextResponse.json({ created }, { status: 201 });
}

export async function POST(request: Request): Promise<Response> {
    try {
        const session = await auth();
        const actor = actorFor((session?.user ?? undefined) as SessionUser | undefined);
        if (!actor) return NextResponse.json({ error: session?.user ? "Forbidden" : "Unauthorized" }, { status: session?.user ? 403 : 401 });
        const input = taskActionSchema.parse(await request.json());
        if (input.action === "summarize") return await summarize(actor, input);
        if (input.action === "breakdown-preview") return await breakdownPreview(actor, input);
        if (input.action === "breakdown") return await breakdown(actor, input);
        if (input.action === "improve-title") return await improveTitle(actor, input);
        if (input.action === "parse-preview") return await parsePreview(actor, input);
        return await parseAndCreate(actor, input);
    } catch (error) {
        return errorResponse(error);
    }
}
