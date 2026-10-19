import { z } from "zod";
import { defineCapability } from "../contracts";
import type { CapabilityRegistry } from "../registry";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { prisma } from "@/lib/prisma";
import { findDuplicateCandidates, assertNoExactDuplicate } from "@/lib/sabah/intelligence/duplicates";
import {
    createTask, createTasks, updateTask, updateTaskStatus, reassignTask,
    addTaskDependencies, addTaskComment, listTasksForActor, getTaskForActor, cancelCreatedTasks, resolveTaskAssigneeLabels,
} from "@/lib/tasks/commands";
import { checkDuplicateOnCreate } from "@/lib/tasks/duplicate-guard";
import { createTaskSchema, updateTaskSchema, taskIdListSchema, taskPrioritySchema, taskReferenceIdSchema, taskStatusSchema } from "@/lib/tasks/schemas";

const ref = z.object({ id: taskReferenceIdSchema });
const writeActor = (actor: SabahActor) => actor.role !== "VIEWER";
const updateInputSchema = updateTaskSchema.extend({ id: taskReferenceIdSchema });
const batchInputSchema = z.object({ tasks: z.array(createTaskSchema).min(1).max(100), allowPartial: z.boolean().default(false) });
const statusInputSchema = ref.extend({ status: taskStatusSchema });
const assignInputSchema = ref.extend({ assigneeIds: taskIdListSchema.max(100) });
const dependencyInputSchema = ref.extend({ dependencyIds: taskIdListSchema.min(1).max(100) });
const commentInputSchema = ref.extend({ body: z.string().trim().min(1).max(10000) });
const cancelInputSchema = z.object({ ids: taskIdListSchema.min(1).max(100) });

function duplicateIds(values: unknown): boolean { return Array.isArray(values) && new Set(values).size !== values.length; }
function assertNoDuplicates(input: Record<string, unknown>) {
    for (const key of ["assigneeIds", "tagIds", "dependencyIds", "reminders"]) if (duplicateIds(input[key])) throw new Error(`Duplicate ${key} are not allowed`);
}
function value(value: unknown): unknown {
    if (value === null || value === undefined || value === "") return "(unset)";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") return JSON.stringify(value);
    return value;
}
function label(item: unknown, fallback: unknown): unknown {
    if (item && typeof item === "object") {
        const v = item as Record<string, unknown>;
        return v.name ?? v.title ?? v.label ?? v.id ?? fallback;
    }
    return fallback;
}
function collection(current: unknown, proposed: unknown, singular: string) {
    const a = Array.isArray(current) ? current : [];
    const b = Array.isArray(proposed) ? proposed : [];
    return { current: `${a.length} ${singular}${a.length === 1 ? "" : "s"} (existing)`, proposed: `${b.length} ${singular}${b.length === 1 ? "" : "s"}${a.length ? " (replaces existing)" : ""}` };
}
function mismatch(output: any, readBack: any): any {
    const fields = ["id", "title", "description", "status", "priority", "projectId", "caseStudyId", "kpiId", "stageId", "isPrivate", "isStarred"];
    const same = fields.every((field) => JSON.stringify(value(output?.[field])) === JSON.stringify(value(readBack?.[field]))) && output?.id === readBack?.id;
    if (!same) throw Object.assign(new Error("Task verification mismatch"), { status: 500, code: "VERIFY_FAILED" });
    return readBack;
}
async function verifyTask(output: any, context: any) {
    const readBack = await getTaskForActor(output.id, context.actor);
    if (!readBack) throw Object.assign(new Error("Task disappeared after write"), { status: 500, code: "VERIFY_FAILED" });
    const verified = mismatch(output, readBack);
    return {
        ...verified,
        entityLinks: [{ type: "TASK", id: verified.id, href: `/tasks/${encodeURIComponent(verified.id)}`, label: verified.title ?? verified.id }],
    };
}
function writePreview(title: string, fields: Array<{ path: string; current?: unknown; proposed?: unknown }>, warnings?: string[]) { return { title, fields, warnings }; }
function commandIdentity(context: { idempotencyKey?: string; conversationId: string | null; requestId: string }) {
    return context.idempotencyKey
        ? { idempotencyKey: context.idempotencyKey, conversationId: context.conversationId, requestId: context.requestId }
        : {};
}

const INLINE_TASK_PREVIEW_LIMIT = 6;
function previewDate(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return match?.[1];
}
function previewTaskLabel(task: Record<string, unknown>, index: number): string {
    const title = typeof task.title === "string"
        ? task.title.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
        : `Task ${index + 1}`;
    const start = previewDate(task.startAt);
    const due = previewDate(task.dueAt);
    const dueEnd = previewDate(task.dueAtEnd);
    const dates = due
        ? `due ${due}${dueEnd && dueEnd !== due ? `–${dueEnd}` : ""}`
        : start ? `starts ${start}` : undefined;
    return `${index + 1}. ${title || `Task ${index + 1}`}${dates ? ` (${dates})` : ""}`;
}
function batchTaskPreviewLabels(tasks: Array<Record<string, unknown>>): string {
    const labels = tasks.slice(0, INLINE_TASK_PREVIEW_LIMIT).map(previewTaskLabel);
    const remaining = tasks.length - labels.length;
    return labels.join("; ") + (remaining > 0 ? `; and ${remaining} more` : "");
}

export const tasksSearchCapability = defineCapability({
    name: "tasks.search", version: 1, module: "tasks", description: "Search tasks visible to the actor.", risk: "READ",
    inputSchema: z.object({ query: z.string().trim().max(200).default(""), status: z.union([taskStatusSchema, z.array(taskStatusSchema)]).optional(), priority: z.union([taskPrioritySchema, z.array(taskPrioritySchema)]).optional(), projectId: taskReferenceIdSchema.optional(), assigneeId: taskReferenceIdSchema.optional(), limit: z.number().int().positive().max(100).optional() }),
    outputSchema: z.array(z.object({ id: z.string() }).passthrough()),
    async available() { return true; }, async authorize() {},
    async preview(input) { return { title: `Search tasks${input.query ? ` matching “${input.query}”` : ""}`, fields: [{ path: "query", proposed: input.query || "(all)" }] }; },
    async execute(input, context) { return (await listTasksForActor({ ...input, search: input.query || undefined }, context.actor)).map((task: any) => ({ ...task, id: task.id, label: task.title })); },
    async verify(output) { return output; }, summarize(output) { return `Found ${output.length} tasks.`; },
});

export const tasksGetCapability = defineCapability({
    name: "tasks.get", version: 1, module: "tasks", description: "Read one visible task.", risk: "READ", inputSchema: ref, outputSchema: z.object({ id: z.string() }).passthrough(),
    async available() { return true; }, async authorize() {}, async preview(input) { return { title: "Read task details", fields: [{ path: "id", proposed: input.id }] }; },
    async execute(input, context) { return getTaskForActor(input.id, context.actor); }, async verify(output, context) { return verifyTask(output, context); }, summarize(output) { return `Read task ${output.title ?? output.id}.`; },
});

export const tasksCreateCapability = defineCapability({
    name: "tasks.create", version: 1, module: "tasks", description: "Create a task using the reviewed command.", requiresExplicitApproval: true, risk: "REVERSIBLE_WRITE", inputSchema: createTaskSchema, outputSchema: z.object({ id: z.string() }).passthrough(),
    async available(actor) { return writeActor(actor); }, async authorize(input, context) { assertNoDuplicates(input as any); if (context.duplicateDb) await assertNoExactDuplicate({ entityType: "TASK", ...input, idempotencyKey: context.idempotencyKey }, context.actor, context.duplicateDb); },
    async preview(input, context) {
        const injectedDb = context.duplicateDb;
        const fields = Object.entries(input).map(([path, proposed]) => ({ path, proposed: value(proposed) }));
        if (!injectedDb) {
            try {
                const guard = await checkDuplicateOnCreate(prisma, {
                    title: input.title,
                    creatorId: context.actor.id,
                    workspaceId: (input as any).workspaceId,
                    recurrenceKey: (input as any).recurrenceKey,
                    idempotencyKey: context.idempotencyKey ?? (input as any).idempotencyKey,
                });
                const candidates = guard.similar ?? [];
                const warnings = guard.decision === "blocked-idempotent-replay"
                    ? ["This idempotent request already created a task; execution will return the existing task."]
                    : candidates.map((candidate) => `Similar task: ${candidate.title} — score ${candidate.score.toFixed(2)}. Choose how to proceed.`);
                const duplicateChoices = candidates.flatMap((candidate) => (["USE_EXISTING", "UPDATE_EXISTING", "LINK", "MERGE", "CREATE_SEPARATELY"] as const).map((action) => ({ action, entityType: "TASK" as const, entityId: candidate.id, label: candidate.title, requiresReason: action === "CREATE_SEPARATELY" })));
                return { ...writePreview(`Create task “${input.title}”`, fields, warnings.length ? warnings : undefined), duplicateChoices: duplicateChoices.length ? duplicateChoices : undefined };
            } catch {
                return writePreview(`Create task “${input.title}”`, fields, ["DUPLICATE_CHECK_UNAVAILABLE: manual duplicate review is required before approval."]);
            }
        }
        const duplicateDb = injectedDb;
        const candidates = await findDuplicateCandidates({ entityType: "TASK", ...input, idempotencyKey: context.idempotencyKey }, context.actor, duplicateDb);
        const warnings = candidates.map((candidate) => `${candidate.overlap === "EXACT" ? "Exact duplicate" : candidate.overlap === "LIKELY_DUPLICATE" ? "Likely duplicate" : candidate.overlap === "RECURRING" ? "Recurring work" : "Related work"}: ${candidate.source.label} — ${candidate.reasons.join("; ")}.`);
        const duplicateChoices = candidates.flatMap((candidate) => candidate.overlap === "RECURRING" ? [] : (["USE_EXISTING", "UPDATE_EXISTING", "LINK", "MERGE", "CREATE_SEPARATELY"] as const).map((action) => ({ action, entityType: candidate.source.entityType as "PROJECT" | "TASK", entityId: candidate.source.entityId, label: candidate.source.label, requiresReason: action === "CREATE_SEPARATELY" })));
        return { ...writePreview(`Create task “${input.title}”`, fields, warnings.length ? warnings : undefined), duplicateChoices: duplicateChoices.length ? duplicateChoices : undefined };
    },
    async execute(input, context) { assertNoDuplicates(input as any); if (context.duplicateDb) await assertNoExactDuplicate({ entityType: "TASK", ...input, idempotencyKey: context.idempotencyKey }, context.actor, context.duplicateDb); const identity = commandIdentity(context); return Object.keys(identity).length ? createTask(input, context.actor, undefined, identity) : createTask(input, context.actor); }, verify: verifyTask,
    async compensate() { throw new Error("Task creation has no safe undo; permanent delete is not supported."); }, summarize(output) { return `Created task “${output.title ?? output.id}”.`; },
});

export const tasksCreateManyCapability = defineCapability({
    name: "tasks.createMany", version: 1, module: "tasks", description: "Create up to 100 tasks in one workflow step.", risk: (input: any) => (input.tasks?.length ?? 0) > 1 ? "BULK_WRITE" : "REVERSIBLE_WRITE", inputSchema: batchInputSchema, outputSchema: z.array(z.object({ index: z.number(), ok: z.boolean() }).passthrough()),
    async available(actor) { return writeActor(actor); }, async authorize(input) { input.tasks.forEach((task: any) => assertNoDuplicates(task as any)); },
    async preview(input) {
        const labels = batchTaskPreviewLabels(input.tasks as unknown as Array<Record<string, unknown>>);
        const title = `Create ${input.tasks.length} tasks: ${labels}`.slice(0, 500);
        return writePreview(title, [{ path: "tasks", proposed: labels }, { path: "allowPartial", proposed: input.allowPartial }], [input.allowPartial ? "Partial success is explicitly allowed; failed items are reported." : "All tasks must succeed or the batch is rolled back."]);
    },
    async execute(input, context) { return createTasks(input.tasks, context.actor, undefined, { allowPartial: input.allowPartial, ...commandIdentity(context) }); },
    async verify(output, context) {
        for (const item of output) {
            if (item.ok && item.data && typeof item.data === "object" && "id" in item.data) {
                await verifyTask(item.data, context);
            }
        }
        return output;
    },
    async compensate() { throw new Error("Bulk task creation has no safe undo; permanent delete is not supported."); }, summarize(output) { return `Created ${output.filter((x: any) => x.ok).length} of ${output.length} tasks.`; },
});

export const tasksUpdateCapability = defineCapability({
    name: "tasks.update", version: 1, module: "tasks", description: "Update a visible task with optimistic concurrency.", risk: (input: any) => input.assigneeIds?.length > 0 || input.dependencyIds?.length > 0 || input.tagIds?.length > 0 ? "SENSITIVE_WRITE" : "REVERSIBLE_WRITE", inputSchema: updateInputSchema, outputSchema: z.object({ id: z.string() }).passthrough(),
    async available(actor) { return writeActor(actor); }, async authorize(input) { assertNoDuplicates(input as any); },
    async preview(input, context) { const current: any = await getTaskForActor(input.id, context.actor); const fields: any[] = []; for (const [path, proposed] of Object.entries(input as any)) { if (path === "id" || proposed === undefined || path === "expectedUpdatedAt") continue; if (["assigneeIds", "tagIds", "dependencyIds"].includes(path)) { const c = collection(path === "assigneeIds" ? current?.assignments : path === "tagIds" ? current?.tags : path === "dependencyIds" ? current?.dependencies : current?.[path], proposed, path.replace("Ids", "")); fields.push({ path, ...c }); } else { const currentValue = path === "projectId" ? label(current?.project, current?.projectId) : path === "caseStudyId" ? label(current?.caseStudy, current?.caseStudyId) : path === "kpiId" ? label(current?.kpi, current?.kpiId) : path === "stageId" ? label(current?.stage, current?.stageId) : current?.[path]; fields.push({ path, current: label(currentValue, value(currentValue)), proposed: value(proposed) }); } } return writePreview(`Update task “${current?.title ?? input.id}”`, fields, Object.keys(input).some((k) => ["assigneeIds", "tagIds", "dependencyIds"].includes(k)) ? ["Collection replacements are transactional and require explicit approval."] : undefined); },
    async execute(input, context) { assertNoDuplicates(input as any); const { id, ...rest } = input; return updateTask(id, rest, context.actor); }, verify: verifyTask,
    async compensate() { throw new Error("Task update has no safe automatic undo; permanent delete is not supported."); }, summarize(output) { return `Updated task ${output.title ?? output.id}.`; },
});

export const tasksUpdateStatusCapability = defineCapability({
    name: "tasks.updateStatus", version: 1, module: "tasks", description: "Change one task status.", risk: "REVERSIBLE_WRITE", inputSchema: statusInputSchema, outputSchema: z.object({ id: z.string() }).passthrough(),
    async available(actor) { return writeActor(actor); }, async authorize() {}, async preview(input, context) { const current: any = await getTaskForActor(input.id, context.actor); return writePreview(`Change task status`, [{ path: "status", current: current?.status, proposed: input.status }]); },
    async execute(input, context) { return updateTaskStatus(input.id, input.status, context.actor); }, verify: verifyTask, summarize(output) { return `Task status is now ${output.status}.`; },
});

export const tasksReassignCapability = defineCapability({
    name: "tasks.reassign", version: 1, module: "tasks", description: "Reassign a task to users permitted by the command.", risk: (input: any) => input.assigneeIds?.length ? "SENSITIVE_WRITE" : "REVERSIBLE_WRITE", inputSchema: assignInputSchema, outputSchema: z.object({ id: z.string() }).passthrough(),
    async available(actor) { return writeActor(actor); }, async authorize(input) { if (duplicateIds(input.assigneeIds)) throw new Error("Duplicate assigneeIds are not allowed"); }, async preview(input, context) { const current: any = await getTaskForActor(input.id, context.actor); const labels = await resolveTaskAssigneeLabels(input.assigneeIds, context.actor); const proposed = input.assigneeIds.map((assigneeId: string) => labels.get(assigneeId) ?? "(not visible)"); const existing = (current?.assignments ?? []).map((a: any) => a.user?.name ?? a.user?.email ?? "(not visible)"); return writePreview(`Reassign task “${current?.title ?? input.id}”`, [{ path: "assigneeIds", current: existing.join(", ") || "(unassigned)", proposed: proposed.join(", ") || "(unassigned)" }], ["Reassignment is a sensitive write and may require approval."]); }, async execute(input, context) { return reassignTask(input.id, input.assigneeIds, context.actor); }, verify: verifyTask, summarize(output) { return `Reassigned task ${output.title ?? output.id}.`; },
});

export const tasksAddDependenciesCapability = defineCapability({
    name: "tasks.addDependencies", version: 1, module: "tasks", description: "Add dependencies after command cycle validation.", risk: "REVERSIBLE_WRITE", inputSchema: dependencyInputSchema, outputSchema: z.object({ taskId: z.string(), count: z.number() }).passthrough(),
 async available(actor) { return writeActor(actor); }, async authorize(input) { if (duplicateIds(input.dependencyIds)) throw new Error("Duplicate dependencyIds are not allowed"); }, async preview(input, context) { const current: any = await getTaskForActor(input.id, context.actor); const proposed = await Promise.all(input.dependencyIds.map(async (dependencyId) => { try { const task: any = await getTaskForActor(dependencyId, context.actor); return task.title ?? dependencyId; } catch { return "(not visible)"; } })); const existing = (current?.dependencies ?? []).map((d: any) => d.dependsOn?.title ?? d.dependsOnId); return writePreview(`Add dependencies to “${current?.title ?? input.id}”`, [{ path: "dependencyIds", current: existing.join(", ") || "(none)", proposed: proposed.join(", ") || "(none)" }], ["The command rejects dependency cycles and duplicate edges."]); }, async execute(input, context) { return addTaskDependencies(input.id, input.dependencyIds, context.actor); }, async verify(output, context) { const readBack: any = await getTaskForActor(output.taskId, context.actor); const ids = (readBack.dependencies ?? []).map((d: any) => d.dependsOnId); if (output.count !== output.dependencyIds?.length || output.dependencyIds.some((id: string) => !ids.includes(id))) throw Object.assign(new Error("Dependency verification mismatch"), { status: 500, code: "VERIFY_FAILED" }); return output; }, summarize(output) { return `Added ${output.count} dependencies.`; },
});

export const tasksCommentCapability = defineCapability({
    name: "tasks.comment", version: 1, module: "tasks", description: "Add a private-safe task comment.", risk: "REVERSIBLE_WRITE", inputSchema: commentInputSchema, outputSchema: z.object({ id: z.string(), body: z.string() }).passthrough(),
    async available(actor) { return writeActor(actor); }, async authorize() {}, async preview(input, context) { const task: any = await getTaskForActor(input.id, context.actor); return writePreview(`Comment on task “${task.title ?? input.id}”`, [{ path: "body", proposed: input.body }]); }, async execute(input, context) { return addTaskComment(input.id, input.body, context.actor); }, async verify(output, context) { const task: any = await getTaskForActor(output.taskId, context.actor); if (!(task.comments ?? []).some((comment: any) => comment.id === output.id && comment.authorId === context.actor.id && comment.body === output.body)) throw Object.assign(new Error("Comment verification mismatch"), { status: 500, code: "VERIFY_FAILED" }); return output; }, summarize(output) { return `Added comment to task ${output.taskId ?? output.id}.`; },
});

export const tasksCancelCreatedCapability = defineCapability({
    name: "tasks.cancelCreated", version: 1, module: "tasks", description: "Safely cancel creator-owned STANDARD tasks; never permanently delete.", risk: (input: any) => input.ids.length > 1 ? "BULK_WRITE" : "REVERSIBLE_WRITE", inputSchema: cancelInputSchema, outputSchema: z.object({ canceledIds: z.array(z.string()), rejectedIds: z.array(z.string()) }),
    async available(actor) { return writeActor(actor); }, async authorize() {}, async preview(input, context) { const labels = await Promise.all(input.ids.map(async (id: string) => { try { const task: any = await getTaskForActor(id, context.actor); return task.title ?? id; } catch { return "(not visible)"; } })); return writePreview(`Cancel ${input.ids.length} created task${input.ids.length === 1 ? "" : "s"}`, [{ path: "ids", proposed: labels.join(", ") }], ["Only creator-owned STANDARD tasks can be canceled; cancellation is reversible by a reviewed status update."]); }, async execute(input, context) { return cancelCreatedTasks(input.ids, context.actor); }, async verify(output, context) { for (const id of output.canceledIds as string[]) { const task: any = await getTaskForActor(id, context.actor); if (task.status !== "CANCELED" || task.createdById !== context.actor.id) throw Object.assign(new Error("Cancellation verification mismatch"), { status: 500, code: "VERIFY_FAILED" }); } return output; }, async compensate() { throw new Error("Undo cancellation through a reviewed status update; permanent delete is not supported."); }, summarize(output) { return `Canceled ${output.canceledIds.length} tasks.`; },
});

export const TASK_CAPABILITIES = [tasksSearchCapability, tasksGetCapability, tasksCreateCapability, tasksCreateManyCapability, tasksUpdateCapability, tasksUpdateStatusCapability, tasksReassignCapability, tasksAddDependenciesCapability, tasksCommentCapability, tasksCancelCreatedCapability] as const;
export function registerTaskCapabilities(registry: { register: (definition: never) => void }): void { for (const capability of TASK_CAPABILITIES) (registry.register as (definition: unknown) => void)(capability); }
