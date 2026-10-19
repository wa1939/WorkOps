import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import { assertCanManageExternalAction, PmoForbiddenError } from "@/lib/pmo/authorization";
import { assertGenericTaskMutationAllowed, PmoWorkflowRequiredError } from "@/lib/pmo/task-mutation-policy";
import { createTaskSchema, updateTaskSchema, type CreateTaskInput, type UpdateTaskInput } from "./schemas";
import { taskScopeForActor, canMutateTask, canReassignTask, assertViewerAllowed, TaskCommandError, type TaskActor } from "./authorization";
import { composeScopes, requireSameWorkspace, WorkspaceScopeError } from "@/lib/workspaces/scope";
import { validateDependencies, preflightDependencies, assertNoDuplicateIds } from "./dependencies";
import { dispatchAssignmentEmails, uniqueRecipientIds } from "./notifications";
import { attachDuplicateWarnings, checkDuplicateOnCreate, recordTaskCreateMarkers } from "./duplicate-guard";
import { nextTaskKey } from "./key";

export type TaskDatabase = any;
export type TaskRequestIdentity = {
  idempotencyKey?: string;
  conversationId?: string | null;
  requestId?: string | null;
};
export type CreateTasksOptions = TaskRequestIdentity & { allowPartial?: boolean };
const includeTask = { assignments: { include: { user: true } }, tags: { include: { tag: true } }, project: true, caseStudy: true, kpi: true, comments: true, links: true, createdBy: true };
const txOptions = { isolationLevel: "Serializable" as const };
type WorkspaceAwareInput = (CreateTaskInput | UpdateTaskInput) & {
  workspaceId?: string | null;
  __workspaceProvided?: boolean;
};
type TaskDatabaseArgument = TaskDatabase | string;

function isTaskDatabase(value: unknown): value is TaskDatabase {
  return !!value && typeof value === "object" && ("task" in value || "$transaction" in value);
}

function resolveTaskDatabase(dbOrWorkspace: TaskDatabaseArgument | undefined, workspaceIdOrDb?: string | TaskDatabase) {
  if (typeof dbOrWorkspace === "string") {
    return { db: isTaskDatabase(workspaceIdOrDb) ? workspaceIdOrDb : prisma as TaskDatabase, workspaceId: dbOrWorkspace };
  }
  return { db: (dbOrWorkspace ?? (isTaskDatabase(workspaceIdOrDb) ? workspaceIdOrDb : prisma)) as TaskDatabase, workspaceId: typeof workspaceIdOrDb === "string" ? workspaceIdOrDb : undefined };
}

function readWorkspacePayload(raw: unknown): { provided: boolean; workspaceId?: string | null } {
  if (!raw || typeof raw !== "object" || !Object.prototype.hasOwnProperty.call(raw, "workspaceId")) {
    return { provided: false };
  }
  const value = (raw as Record<string, unknown>).workspaceId;
  if (value === undefined) return { provided: false };
  if (value !== null && typeof value !== "string") {
    throw new TaskCommandError("workspaceId must be a string or null", 400, "INVALID_REFERENCE");
  }
  if (typeof value === "string" && value.length === 0) {
    throw new TaskCommandError("workspaceId must not be empty", 400, "INVALID_REFERENCE");
  }
  return { provided: true, workspaceId: value };
}

function parseWorkspaceAwareInput<T extends CreateTaskInput | UpdateTaskInput>(
  schema: { parse: (value: unknown) => T },
  raw: unknown,
): WorkspaceAwareInput {
  const parsed = schema.parse(raw);
  const workspace = readWorkspacePayload(raw);
  return workspace.provided
    ? { ...parsed, workspaceId: workspace.workspaceId, __workspaceProvided: true }
    : parsed;
}

function resolveInputWorkspace(input: WorkspaceAwareInput, callerWorkspaceId?: string): string | undefined {
  if (callerWorkspaceId !== undefined && input.__workspaceProvided && input.workspaceId !== callerWorkspaceId) {
    throw new TaskCommandError("workspaceId does not match caller workspace", 400, "WORKSPACE_MISMATCH");
  }
  if (callerWorkspaceId !== undefined) return callerWorkspaceId;
  return typeof input.workspaceId === "string" ? input.workspaceId : undefined;
}

/** Runs fn transactionally, or directly when db is already an interactive transaction client. */
const runTransaction = (db: any, fn: (tx: any) => any) => typeof db?.$transaction === "function" ? db.$transaction(fn, txOptions) : fn(db);
const date = (v?: string | null) => v ? new Date(v) : null;
const dedupe = (xs?: string[]) => xs ? Array.from(new Set(xs)) : [];
function rejectDuplicates(input: CreateTaskInput | UpdateTaskInput) {
  for (const [key, values] of [["assignees", input.assigneeIds], ["tags", input.tagIds], ["dependencies", input.dependencyIds], ["reminders", input.reminders]] as const) {
    if (values) assertNoDuplicateIds(values.map(String), key);
  }
}
function mutationError(error: unknown): never { if (error instanceof TaskCommandError) throw error; throw error; }
function taskWhereForActor(id: string, actor: TaskActor, workspaceId?: string) {
  const scope = taskScopeForActor(actor, workspaceId) as Record<string, unknown>;
  return workspaceId === undefined ? { id, ...scope } : composeScopes({ id }, scope);
}

async function visibleTask(db: TaskDatabase, id: string, actor: TaskActor, include = includeTask, workspaceId?: string) {
  const task = await db.task.findFirst({ where: taskWhereForActor(id, actor, workspaceId), include });
  if (!task) throw new TaskCommandError("Task not found", 404, "NOT_FOUND");
  return task;
}
async function audit(tx: any, id: string, action: string, actorId: string, meta?: unknown) {
  if (tx.auditLog?.create) await tx.auditLog.create({ data: { entityType: "task", entityId: id, action, actorId, taskId: id, metaJson: meta === undefined ? undefined : JSON.stringify(meta) } });
}
async function assertAssigneesInWorkspace(tx: any, workspaceId: string, assigneeIds: string[]) {
  const ids = dedupe(assigneeIds);
  if (!ids.length) return;
  if (!tx.workspaceMember?.findMany) throw new TaskCommandError("Workspace membership could not be verified", 503, "WORKSPACE_MEMBERSHIP_UNAVAILABLE");
  const memberships = await tx.workspaceMember.findMany({
    where: { workspaceId, userId: { in: ids }, active: true },
    select: { userId: true, workspaceId: true },
  });
  const activeIds = new Set(memberships.map((membership: any) => membership.userId));
  if (ids.some((id) => !activeIds.has(id))) {
    throw new TaskCommandError("cross workspace assignee rejected", 400, "CROSS_WORKSPACE_ASSIGNEE");
  }
}

async function assertReferences(tx: any, input: CreateTaskInput | UpdateTaskInput, workspaceId?: string) {
  const ids = dedupe([...(input.assigneeIds ?? []), ...(input.tagIds ?? [])]);
  if (input.assigneeIds?.length && tx.user?.findMany) {
    const users = await tx.user.findMany({ where: { id: { in: dedupe(input.assigneeIds) }, isActive: true }, select: { id: true, name: true, email: true } });
    if (users.length !== dedupe(input.assigneeIds).length) throw new TaskCommandError("Referenced user is missing or inactive", 400, "INVALID_REFERENCE");
  }
  if (workspaceId) await assertAssigneesInWorkspace(tx, workspaceId, input.assigneeIds ?? []);
  if (input.tagIds?.length && tx.tag?.findMany) { const tags = await tx.tag.findMany({ where: { id: { in: dedupe(input.tagIds) } }, select: { id: true } }); if (tags.length !== dedupe(input.tagIds).length) throw new TaskCommandError("Referenced tag not found", 400, "INVALID_REFERENCE"); }
  for (const [model, key] of [["project", "projectId"], ["caseStudy", "caseStudyId"], ["kPI", "kpiId"], ["projectStage", "stageId"]] as const) {
    const value = (input as any)[key];
    if (!value || !tx[model]?.findUnique) continue;
    const select = workspaceId && model === "project" ? { id: true, workspaceId: true } : { id: true };
    const reference = await tx[model].findUnique({ where: { id: value }, select });
    if (!reference) throw new TaskCommandError(`Referenced ${key} not found`, 400, "INVALID_REFERENCE");
    if (workspaceId && model === "project") {
      try {
        requireSameWorkspace(workspaceId, [reference]);
      } catch (error) {
        if (error instanceof WorkspaceScopeError) throw new TaskCommandError(error.message, error.status, error.code);
        throw error;
      }
    }
  }
  void ids;
}
async function writeChildren(tx: any, taskId: string, input: CreateTaskInput | UpdateTaskInput, fallbackAssignees: string[]) {
  const assignees = input.assigneeIds === undefined ? undefined : dedupe(input.assigneeIds);
  if (assignees) { await tx.taskAssignment.deleteMany({ where: { taskId } }); if (assignees.length) await tx.taskAssignment.createMany({ data: assignees.map(userId => ({ taskId, userId })) }); }
  if (input.tagIds !== undefined) { await tx.taskTag.deleteMany({ where: { taskId } }); const ids = dedupe(input.tagIds); if (ids.length) await tx.taskTag.createMany({ data: ids.map(tagId => ({ taskId, tagId })) }); }
  if (input.reminders !== undefined) { await tx.taskReminder.deleteMany({ where: { taskId } }); const ids = assignees ?? fallbackAssignees; const rows = Array.from(new Set(input.reminders)).flatMap(offsetMinutes => ids.map(userId => ({ taskId, userId, offsetMinutes }))); if (rows.length) await tx.taskReminder.createMany({ data: rows, skipDuplicates: true }); }
}
function isUniqueViolation(error: unknown) { return !!error && typeof error === "object" && "code" in error && (error as any).code === "P2002"; }

type BatchResultRecord = {
  version: 1;
  inputHash: string;
  items: Array<{ index: number; taskId?: string; error?: string }>;
};

function canonicalJson(value: unknown): string {
  const canonicalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonicalize);
    if (input && typeof input === "object") {
      return Object.fromEntries(Object.keys(input as Record<string, unknown>).sort().map((key) => [key, canonicalize((input as Record<string, unknown>)[key])]));
    }
    return input;
  };
  return JSON.stringify(canonicalize(value));
}

function batchInputHash(inputs: CreateTaskInput[], allowPartial: boolean): string {
  return crypto.createHash("sha256").update(canonicalJson({ inputs, allowPartial })).digest("hex");
}

function batchResultKey(actor: TaskActor, inputs: CreateTaskInput[], options: CreateTasksOptions): { key: string; inputHash: string } | null {
  if (!options.idempotencyKey) return null;
  const inputHash = batchInputHash(inputs, options.allowPartial === true);
  const key = crypto.createHash("sha256").update(canonicalJson({
    actorId: actor.id,
    conversationId: options.conversationId ?? null,
    requestId: options.requestId ?? null,
    requestKey: options.idempotencyKey,
  })).digest("hex");
  return { key: `task-batch:${key}`, inputHash };
}

function parseBatchResult(value: unknown): BatchResultRecord {
  if (!value || typeof value !== "object") throw new TaskCommandError("Stored task batch result is invalid", 500, "VERIFY_FAILED");
  const record = value as Partial<BatchResultRecord>;
  if (record.version !== 1 || typeof record.inputHash !== "string" || !Array.isArray(record.items)) throw new TaskCommandError("Stored task batch result is invalid", 500, "VERIFY_FAILED");
  return record as BatchResultRecord;
}

async function readBatchResult(db: any, key: string, inputHash: string): Promise<BatchResultRecord | null> {
  if (!db.aiCapabilityResult?.findUnique) {
    throw new TaskCommandError("Idempotent task batches require durable result storage", 503, "IDEMPOTENCY_UNAVAILABLE");
  }
  const prior = await db.aiCapabilityResult.findUnique({ where: { key } });
  if (!prior) return null;

  // The claim stores the input fingerprint before any task write. Compare it
  // even while EXECUTING so a reused identity cannot silently join a different
  // payload or be mistaken for a safe replay.
  let record: BatchResultRecord | null = null;
  if (typeof prior.outputJson === "string") {
    try {
      record = parseBatchResult(JSON.parse(prior.outputJson));
    } catch {
      throw new TaskCommandError("Stored task batch result is invalid", 500, "VERIFY_FAILED");
    }
    if (record.inputHash !== inputHash) throw new TaskCommandError("Task batch request key was reused with different inputs", 409, "IDEMPOTENCY_CONFLICT");
  }
  if (prior.state !== "VERIFIED" || prior.compensatedAt !== null || !record) {
    throw new TaskCommandError("Task batch request is already in progress", 409, "IDEMPOTENCY_IN_PROGRESS");
  }
  return record;
}

async function claimBatchResult(tx: any, key: string, inputHash: string): Promise<void> {
  if (!tx.aiCapabilityResult?.create) {
    throw new TaskCommandError("Idempotent task batches require durable result storage", 503, "IDEMPOTENCY_UNAVAILABLE");
  }
  await tx.aiCapabilityResult.create({ data: { key, state: "EXECUTING", outputJson: JSON.stringify({ version: 1, inputHash, items: [] }) } });
}

async function finalizeBatchResult(tx: any, key: string, record: BatchResultRecord): Promise<void> {
  const finalized = await tx.aiCapabilityResult.updateMany({
    where: { key, state: "EXECUTING", compensatedAt: null },
    data: { state: "VERIFIED", outputJson: JSON.stringify(record) },
  });
  if (finalized.count !== 1) throw new TaskCommandError("Task batch idempotency result could not be finalized", 500, "VERIFY_FAILED");
}

async function replayBatchResult(record: BatchResultRecord, actor: TaskActor, db: TaskDatabase, workspaceId?: string) {
  const results: Array<{ ok: boolean; data?: unknown; error?: string; index: number }> = [];
  for (const item of record.items) {
    if (!item.taskId) {
      results.push({ ok: false, error: item.error ?? "Task creation failed", index: item.index });
      continue;
    }
    let data: unknown;
    try {
      data = await visibleTask(db, item.taskId, actor, includeTask, workspaceId);
    } catch {
      throw new TaskCommandError("Idempotent task batch read-back failed", 500, "VERIFY_FAILED");
    }
    results.push({ ok: true, data, index: item.index });
  }
  return results;
}

async function createIdempotentTasks(inputs: WorkspaceAwareInput[], actor: TaskActor, db: TaskDatabase, options: CreateTasksOptions, identity: { key: string; inputHash: string }, callerWorkspaceId?: string) {
  const replay = await readBatchResult(db, identity.key, identity.inputHash);
  if (replay) return replayBatchResult(replay, actor, db, callerWorkspaceId);

  let created: { created: Array<{ input: WorkspaceAwareInput; index: number; task: any }> };
  try {
    created = await runTransaction(db, async (tx: any) => {
      await claimBatchResult(tx, identity.key, identity.inputHash);
      const items: BatchResultRecord["items"] = [];
      const made: Array<{ input: WorkspaceAwareInput; index: number; task: any }> = [];
      for (let index = 0; index < inputs.length; index++) {
        const input = inputs[index];
        try {
          const task = await createTaskInTransaction(tx, input as CreateTaskInput, actor, input.assigneeIds ?? [], resolveInputWorkspace(input, callerWorkspaceId));
          made.push({ input, index, task });
          items.push({ index, taskId: task.id });
        } catch (error) {
          if (options.allowPartial !== true) throw error;
          items.push({ index, error: error instanceof Error ? error.message : String(error) });
        }
      }
      await finalizeBatchResult(tx, identity.key, { version: 1, inputHash: identity.inputHash, items });
      return { created: made };
    });
  } catch (error) {
    // A concurrent winner may have claimed the unique key. The failed
    // transaction is already rolled back; only then is it safe to read back
    // the winner from the outer client.
    if (isUniqueViolation(error)) {
      const winner = await readBatchResult(db, identity.key, identity.inputHash);
      if (winner) return replayBatchResult(winner, actor, db, callerWorkspaceId);
    }
    throw error;
  }

  const results: Array<{ ok: boolean; data?: unknown; error?: string; index: number }> = [];
  for (const item of created.created) {
    const assignees = item.input.assigneeIds ?? [];
    const itemWorkspaceId = resolveInputWorkspace(item.input, callerWorkspaceId);
        await postCommitEmails(db, assignees, actor.id, item.task.title, item.task.id);
        results.push({ ok: true, data: await visibleTask(db, item.task.id, actor, includeTask, itemWorkspaceId), index: item.index });
  }
  const succeeded = new Set(created.created.map((item: { index: number }) => item.index));
  for (let index = 0; index < inputs.length; index++) {
    if (!succeeded.has(index)) results.push({ ok: false, error: "Task creation failed", index });
  }
  return results.sort((a, b) => a.index - b.index);
}
async function createAssignmentNotifications(tx: any, ids: string[], actorId: string, title: string, taskId: string) {
  const candidates = uniqueRecipientIds(ids, actorId);
  const type = `task_assigned:${taskId}`;
  const existing = new Set<string>();
  if (tx.notification?.findFirst) for (const userId of candidates) if (await tx.notification.findFirst({ where: { userId, type }, select: { id: true } })) existing.add(userId);
  const data = candidates.filter(userId => !existing.has(userId)).map(userId => ({ id: `task-assigned:${taskId}:${userId}`, userId, type, title: "Task Assigned", body: `You have been assigned to: ${title}`, linkUrl: `/tasks/${taskId}` }));
  if (!data.length) return [];
  // PostgreSQL ON CONFLICT DO NOTHING keeps concurrent retries in the same
  // transaction healthy and returns exactly the rows this invocation inserted.
  if (tx.notification?.createManyAndReturn) return (await tx.notification.createManyAndReturn({ data, skipDuplicates: true })).map((row: any) => row.userId);
  const fresh: string[] = [];
  for (const row of data) { try { if (tx.notification?.create) { await tx.notification.create({ data: row }); fresh.push(row.userId); } } catch (error) { if (!isUniqueViolation(error)) throw error; } }
  return fresh;
}
async function postCommitEmails(db: any, ids: string[], actorId: string, title: string, taskId: string) {
  const recipients = uniqueRecipientIds(ids, actorId); if (!recipients.length || !db.user?.findMany) return;
  const users = await db.user.findMany({ where: { id: { in: recipients } }, select: { id: true, name: true, email: true } });
  await dispatchAssignmentEmails(users.map((u: any) => ({ userId: u.id, name: u.name, email: u.email, title, taskId })));
}
async function parentTaskForCreate(tx: any, parentTaskId: string, actor: TaskActor, workspaceId?: string) {
  const parent = await tx.task.findFirst({
    where: taskWhereForActor(parentTaskId, actor, workspaceId),
    select: {
      id: true,
      projectId: true,
      workspaceId: true,
      createdById: true,
      assignments: { select: { userId: true } },
    },
  });
  if (!parent) throw new TaskCommandError("Parent task not found", 404, "NOT_FOUND");
  if (!canMutateTask(parent, actor)) throw new TaskCommandError("Forbidden", 403, "FORBIDDEN");
  return parent;
}

async function createTaskInTransaction(tx: any, input: CreateTaskInput, actor: TaskActor, assignees: string[], workspaceId?: string) {
  const parent = input.parentTaskId ? await parentTaskForCreate(tx, input.parentTaskId, actor, workspaceId) : null;
  if (parent && input.projectId !== undefined && input.projectId !== parent.projectId) {
    throw new TaskCommandError("Subtask project must match its parent", 400, "INVALID_REFERENCE");
  }
  const projectId = input.projectId === undefined ? parent?.projectId ?? null : input.projectId;
  const effectiveWorkspaceId = workspaceId ?? parent?.workspaceId ?? undefined;
  await assertReferences(tx, { ...input, assigneeIds: assignees, projectId }, effectiveWorkspaceId);
  const taskKey = projectId ? await nextTaskKey(projectId, tx) : null;
  const lastSibling = parent
    ? await tx.task.findFirst({ where: { parentTaskId: parent.id }, orderBy: { siblingOrder: "desc" }, select: { siblingOrder: true } })
    : null;
  const task = await tx.task.create({ data: {
    taskKey,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "TODO",
    priority: input.priority ?? "MEDIUM",
    startAt: date(input.startAt),
    dueAt: date(input.dueAt),
    dueAtEnd: date(input.dueAtEnd),
    effortHours: input.effortHours ?? null,
    isPrivate: input.isPrivate ?? false,
    projectId,
    caseStudyId: input.caseStudyId ?? null,
    kpiId: input.kpiId ?? null,
    stageId: input.stageId ?? null,
    workspaceId: effectiveWorkspaceId ?? null,
    ...(parent ? { parentTaskId: parent.id, siblingOrder: (lastSibling?.siblingOrder ?? -1) + 1 } : {}),
    createdById: actor.id,
    doneAt: input.status === "DONE" ? new Date() : null,
  } });
  if (input.dependencyIds?.length) { await validateDependencies(tx, task.id, input.dependencyIds); await tx.taskDependency.createMany({ data: input.dependencyIds.map(dependsOnId => ({ taskId: task.id, dependsOnId })) }); }
  await writeChildren(tx, task.id, { ...input, assigneeIds: assignees }, assignees);
  await createAssignmentNotifications(tx, assignees, actor.id, task.title, task.id);
  await audit(tx, task.id, "create", actor.id, { fields: Object.keys(input) });
  return task;
}
export async function createTask(raw: CreateTaskInput, actor: TaskActor, dbOrWorkspace: TaskDatabaseArgument = prisma, workspaceIdOrOptions?: string | TaskRequestIdentity | TaskDatabase) {
  assertViewerAllowed(actor);
  const callerWorkspaceId = typeof dbOrWorkspace === "string"
    ? dbOrWorkspace
    : typeof workspaceIdOrOptions === "string"
      ? workspaceIdOrOptions
      : undefined;
  const dbArgument = typeof dbOrWorkspace === "string" && isTaskDatabase(workspaceIdOrOptions) ? workspaceIdOrOptions : dbOrWorkspace;
  const requestIdentity = workspaceIdOrOptions && typeof workspaceIdOrOptions === "object" && !isTaskDatabase(workspaceIdOrOptions)
    ? workspaceIdOrOptions as TaskRequestIdentity
    : undefined;
  const rawInput = requestIdentity?.idempotencyKey && raw && typeof raw === "object" && !("idempotencyKey" in raw)
    ? { ...raw, idempotencyKey: requestIdentity.idempotencyKey }
    : raw;
  const { db } = resolveTaskDatabase(dbArgument, callerWorkspaceId);
  const input = parseWorkspaceAwareInput(createTaskSchema, rawInput) as WorkspaceAwareInput & CreateTaskInput;
  const targetWorkspaceId = resolveInputWorkspace(input, callerWorkspaceId);
  rejectDuplicates(input);
  const assignees = input.assigneeIds ?? [];
  const result = await createTaskWithDuplicateGuard(db, input, actor, assignees, targetWorkspaceId);
  if (!result.task) {
    const existing = await visibleTask(db, result.duplicateGuard.existingTaskId as string, actor, includeTask, targetWorkspaceId);
    return existing;
  }
  await postCommitEmails(db, assignees, actor.id, result.task.title, result.task.id);
  const created = await visibleTask(db, result.task.id, actor, includeTask, targetWorkspaceId);
  return attachDuplicateWarnings(created, result.duplicateGuard as any);
}
function isRetryableTransaction(error: unknown) {
  return !!error && typeof error === "object" && "code" in error && (error as any).code === "P2034";
}

function duplicateInput(input: WorkspaceAwareInput & CreateTaskInput, actor: TaskActor, workspaceId?: string) {
  return {
    title: input.title,
    creatorId: actor.id,
    workspaceId: input.__workspaceProvided ? input.workspaceId : workspaceId,
    recurrenceKey: input.recurrenceKey,
    idempotencyKey: input.idempotencyKey,
  };
}

async function createTaskWithDuplicateGuard(
  db: TaskDatabase,
  input: WorkspaceAwareInput & CreateTaskInput,
  actor: TaskActor,
  assignees: string[],
  workspaceId?: string,
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async (tx: any) => {
        const guardInput = duplicateInput(input, actor, workspaceId);
        const duplicateGuard = await checkDuplicateOnCreate(tx, guardInput);
        if (duplicateGuard.decision === "blocked-idempotent-replay" && duplicateGuard.existingTaskId) {
          return { task: null, duplicateGuard };
        }
        const task = await createTaskInTransaction(tx, input, actor, assignees, workspaceId);
        await recordTaskCreateMarkers(tx, guardInput, task);
        return { task, duplicateGuard };
      }, txOptions);
    } catch (error) {
      if (input.idempotencyKey && isRetryableTransaction(error) && attempt < 3) continue;
      throw error;
    }
  }
}

export async function createTasks(
  inputs: CreateTaskInput[],
  actor: TaskActor,
  dbOrWorkspace: TaskDatabaseArgument = prisma,
  optionsOrWorkspace: CreateTasksOptions | string | TaskDatabase = {},
  workspaceId?: string | TaskDatabase,
) {
  assertViewerAllowed(actor);
  if (inputs.length > 100) throw new TaskCommandError("Workflow batch cannot exceed 100 tasks", 400, "BATCH_LIMIT");
  const callerWorkspaceId = typeof dbOrWorkspace === "string"
    ? dbOrWorkspace
    : typeof optionsOrWorkspace === "string"
      ? optionsOrWorkspace
      : workspaceId;
  const options: CreateTasksOptions = typeof optionsOrWorkspace === "string" || isTaskDatabase(optionsOrWorkspace) ? {} : optionsOrWorkspace as CreateTasksOptions;
  const dbArgument = typeof dbOrWorkspace === "string" && isTaskDatabase(optionsOrWorkspace) ? optionsOrWorkspace : dbOrWorkspace;
  const { db } = resolveTaskDatabase(dbArgument, callerWorkspaceId);
  const parsed = inputs.map(raw => {
    const input = parseWorkspaceAwareInput(createTaskSchema, raw) as WorkspaceAwareInput & CreateTaskInput;
    resolveInputWorkspace(input, callerWorkspaceId);
    rejectDuplicates(input);
    return input;
  });
  const identity = batchResultKey(actor, parsed, options);
  if (identity) return createIdempotentTasks(parsed, actor, db, options, identity, callerWorkspaceId);
  const allowPartial = options.allowPartial === true;
  const results: Array<{ ok: boolean; data?: unknown; error?: string; index: number }> = [];
  if (!allowPartial) {
    const created = await db.$transaction(async (tx: any) => parsed.map(async (input, index) => ({ input, index, task: await createTaskInTransaction(tx, input, actor, input.assigneeIds ?? [], resolveInputWorkspace(input, callerWorkspaceId)) })).reduce(async (chain, itemPromise) => { const acc = await chain; acc.push(await itemPromise); return acc; }, Promise.resolve([] as Array<{ input: CreateTaskInput; index: number; task: any }>)), txOptions);
    for (const item of created) { const assignees = item.input.assigneeIds ?? []; const itemWorkspaceId = resolveInputWorkspace(item.input as WorkspaceAwareInput, callerWorkspaceId); await postCommitEmails(db, assignees, actor.id, item.task.title, item.task.id); results.push({ ok: true, data: await visibleTask(db, item.task.id, actor, includeTask, itemWorkspaceId), index: item.index }); }
    return results;
  }
  for (let index = 0; index < parsed.length; index++) { try { results.push({ ok: true, data: await createTask(parsed[index], actor, db, callerWorkspaceId), index }); } catch (e) { results.push({ ok: false, error: e instanceof Error ? e.message : String(e), index }); } }
  return results;
}
const taskDrawerInclude = {
  ...includeTask,
  project: {
    include: {
      members: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
      customFields: true,
    },
  },
  assignments: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
  recurringRule: true,
  subtasks: {
    orderBy: { siblingOrder: "asc" },
    include: { assignments: { include: { user: { select: { id: true, name: true, email: true, image: true } } } } },
  },
  subscribers: { include: { user: { select: { id: true, name: true, email: true, image: true } } } },
  customFieldValues: { include: { field: true } },
  attachments: { orderBy: { createdAt: "desc" } },
  dependencies: { include: { dependsOn: { select: { id: true, taskKey: true, title: true, status: true } } } },
  blockers: { include: { task: { select: { id: true, taskKey: true, title: true, status: true } } } },
  comments: {
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, email: true, image: true } } },
  },
  auditLogs: {
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { actor: { select: { id: true, name: true, email: true, image: true } } },
  },
} as const;

export async function getTaskForActor(id: string, actor: TaskActor, dbOrWorkspace: TaskDatabaseArgument = prisma, workspaceId?: string | TaskDatabase) {
  const resolved = resolveTaskDatabase(dbOrWorkspace, workspaceId);
  return visibleTask(resolved.db, id, actor, taskDrawerInclude as any, resolved.workspaceId);
}
function taskQueryWhere(query: any, actor: TaskActor, workspaceId?: string) {
  const conditions: any[] = [];
  if (query.status) conditions.push({ status: Array.isArray(query.status) ? { in: query.status } : query.status });
  if (query.priority) conditions.push({ priority: Array.isArray(query.priority) ? { in: query.priority } : query.priority });
  if (query.projectId) conditions.push({ projectId: query.projectId });
  if (query.caseStudyId) conditions.push({ caseStudyId: query.caseStudyId });
  if (query.assigneeId) conditions.push({ assignments: { some: { userId: query.assigneeId === "me" || query.assigneeId === "@me" ? actor.id : query.assigneeId } } });
  if (query.floating === true || query.floating === "true") conditions.push({ assignments: { none: {} }, status: { notIn: ["DONE", "CANCELED"] } });
  if (query.search) conditions.push({ OR: [{ title: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] });
  if (query.due) {
    const now = new Date();
    const end = new Date(now);
    if (query.due === "overdue") conditions.push({ dueAt: { lt: now }, status: { notIn: ["DONE", "CANCELED"] } });
    else if (["next7", "next30"].includes(query.due)) {
      end.setDate(end.getDate() + (query.due === "next7" ? 7 : 30));
      conditions.push({ dueAt: { gte: now, lte: end } });
    }
  }
  return composeScopes(taskScopeForActor(actor, workspaceId), ...conditions) as any;
}

export async function listTasksForActor(query: any = {}, actor: TaskActor, dbOrWorkspace: TaskDatabaseArgument = prisma, workspaceId?: string | TaskDatabase) {
  const resolved = resolveTaskDatabase(dbOrWorkspace, workspaceId);
  return resolved.db.task.findMany({
    where: taskQueryWhere(query, actor, resolved.workspaceId),
    include: includeTask,
    orderBy: [{ dueAt: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    take: Math.min(query.limit ?? 100, 100),
  });
}

export async function countTasksForActor(query: any = {}, actor: TaskActor, dbOrWorkspace: TaskDatabaseArgument = prisma, workspaceId?: string | TaskDatabase) {
  const resolved = resolveTaskDatabase(dbOrWorkspace, workspaceId);
  return resolved.db.task.count({ where: taskQueryWhere(query, actor, resolved.workspaceId) });
}
async function loadMutable(id: string, actor: TaskActor, db: any, workspaceId?: string) { const task = await db.task.findFirst({ where: taskWhereForActor(id, actor, workspaceId), include: { assignments: true, externalAction: { include: { owner: { select: { managerId: true } } } }, project: { select: { ownerId: true, workspaceId: true } }, caseStudy: { select: { ownerId: true } } } }); if (!task) throw new TaskCommandError("Task not found", 404, "NOT_FOUND"); if (task.type !== "EXTERNAL_ACTION" && !canMutateTask(task, actor)) throw new TaskCommandError("Forbidden", 403, "FORBIDDEN"); return task; }
export async function updateTask(id: string, raw: UpdateTaskInput, actor: TaskActor, dbOrWorkspace: TaskDatabaseArgument = prisma, workspaceId?: string | TaskDatabase) {
  const { db, workspaceId: callerWorkspaceId } = resolveTaskDatabase(dbOrWorkspace, workspaceId);
  const input = parseWorkspaceAwareInput(updateTaskSchema, raw) as WorkspaceAwareInput & UpdateTaskInput;
  rejectDuplicates(input);
  const current = await loadMutable(id, actor, db, callerWorkspaceId);
  if (input.__workspaceProvided && input.workspaceId !== current.workspaceId) {
    throw new TaskCommandError("cannot move a task by changing workspaceId", 409, "TASK_WORKSPACE_MOVE_REQUIRED");
  }
  const targetWorkspaceId = resolveInputWorkspace(input, callerWorkspaceId) ?? (typeof current.workspaceId === "string" ? current.workspaceId : undefined); if (current.type === "EXTERNAL_ACTION") { if (!current.externalAction) throw new TaskCommandError("External action context missing", 409); try { assertCanManageExternalAction(actor as any, { ownerId: current.externalAction.ownerId, parentOwnerId: current.project?.ownerId ?? current.caseStudy?.ownerId ?? null, ownerManagerId: current.externalAction.owner.managerId }); assertGenericTaskMutationAllowed(current, input as any); } catch (e) { if (e instanceof PmoForbiddenError) throw new TaskCommandError("Forbidden", 403, "FORBIDDEN"); if (e instanceof PmoWorkflowRequiredError) throw new TaskCommandError(e.message, 409, "PMO_WORKFLOW_REQUIRED"); throw e; } }
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(current.updatedAt).getTime()) throw new TaskCommandError("Task was modified by someone else", 409, "VERSION_CONFLICT");
  const result = await runTransaction(db, async (tx: any) => { const effectiveAssignees = input.assigneeIds ?? current.assignments.map((assignment: any) => assignment.userId); const effectiveProjectId = input.projectId === undefined ? current.projectId : input.projectId; await assertReferences(tx, { ...input, assigneeIds: effectiveAssignees, projectId: effectiveProjectId }, targetWorkspaceId); await preflightDependencies(tx, id, input.dependencyIds ?? []); let doneAt: Date | null | undefined; if (input.status === "DONE" && current.status !== "DONE") doneAt = new Date(); else if (input.status && input.status !== "DONE" && current.status === "DONE") doneAt = null;
    // Atomic compare-and-swap: the expected version is part of the update
    // predicate so a concurrent writer cannot slip between check and write.
    let task: any;
    try {
      task = await tx.task.update({ where: { id, ...(input.expectedUpdatedAt ? { updatedAt: new Date(input.expectedUpdatedAt) } : {}) }, data: { title: input.title, description: input.description, status: input.status, priority: input.priority, progressMode: input.progressMode, estimateMinutes: input.estimateMinutes, manualProgress: input.manualProgress, plannedStartAt: input.plannedStartAt === undefined ? undefined : date(input.plannedStartAt), plannedEndAt: input.plannedEndAt === undefined ? undefined : date(input.plannedEndAt), startAt: input.startAt === undefined ? undefined : date(input.startAt), dueAt: input.dueAt === undefined ? undefined : date(input.dueAt), dueAtEnd: input.dueAtEnd === undefined ? undefined : date(input.dueAtEnd), effortHours: input.effortHours, actualHours: input.actualHours, isPrivate: input.isPrivate, isStarred: input.isStarred, stageId: input.stageId, projectId: input.projectId, caseStudyId: input.caseStudyId, kpiId: input.kpiId, workspaceId: input.__workspaceProvided ? input.workspaceId : undefined, doneAt } });
    } catch (error: any) {
      if (error?.code === "P2025") throw new TaskCommandError("Task was modified by someone else", 409, "VERSION_CONFLICT");
      throw error;
    }
    if (input.dependencyIds !== undefined) { await tx.taskDependency.deleteMany({ where: { taskId: id } }); const depIds = dedupe(input.dependencyIds); if (depIds.length) await tx.taskDependency.createMany({ data: depIds.map((dependsOnId: string) => ({ taskId: id, dependsOnId })) }); }
    await writeChildren(tx, id, input, current.assignments.map((a: any) => a.userId)); const newIds = input.assigneeIds ? input.assigneeIds.filter(x => !current.assignments.some((a: any) => a.userId === x)) : []; const notifiedIds = await createAssignmentNotifications(tx, newIds, actor.id, task.title, task.id); await audit(tx, id, "update", actor.id, input); return { task, newIds: notifiedIds }; }); if (result.newIds.length) await postCommitEmails(db, result.newIds, actor.id, result.task.title, id); return visibleTask(db, id, actor, includeTask, targetWorkspaceId); }
async function assertActorInBothWorkspaces(tx: any, actor: TaskActor, sourceWorkspaceId: string, targetWorkspaceId: string) {
  if (!tx.workspaceMember?.findMany) throw new TaskCommandError("Workspace membership could not be verified", 503, "WORKSPACE_MEMBERSHIP_UNAVAILABLE");
  const required = Array.from(new Set([sourceWorkspaceId, targetWorkspaceId]));
  const memberships = await tx.workspaceMember.findMany({
    where: { userId: actor.id, workspaceId: { in: required }, active: true },
    select: { workspaceId: true },
  });
  const activeWorkspaceIds = new Set(memberships.map((membership: any) => membership.workspaceId));
  if (required.some((workspaceId) => !activeWorkspaceIds.has(workspaceId))) {
    throw new TaskCommandError("actor must have active membership in both source and target workspaces", 403, "WORKSPACE_MEMBERSHIP_REQUIRED");
  }
}

export async function moveTaskToWorkspace(db: TaskDatabase, taskId: string, targetWorkspaceId: string, actor: TaskActor) {
  assertViewerAllowed(actor);
  if (!targetWorkspaceId) throw new TaskCommandError("Target workspace is required", 400, "WORKSPACE_REQUIRED");
  const current = await loadMutable(taskId, actor, db);
  if (!current.workspaceId) throw new TaskCommandError("Task has no source workspace", 400, "WORKSPACE_SOURCE_REQUIRED");
  const sourceWorkspaceId = current.workspaceId as string;
  const assigneeIds = (current.assignments ?? []).map((assignment: any) => assignment.userId);
  await runTransaction(db, async (tx: any) => {
    await assertActorInBothWorkspaces(tx, actor, sourceWorkspaceId, targetWorkspaceId);
    await assertReferences(tx, { assigneeIds, projectId: current.projectId }, targetWorkspaceId);
    try {
      await tx.task.update({
        where: { id: taskId, workspaceId: sourceWorkspaceId },
        data: { workspaceId: targetWorkspaceId },
      });
    } catch (error: any) {
      if (error?.code === "P2025") throw new TaskCommandError("Task was modified by someone else", 409, "VERSION_CONFLICT");
      throw error;
    }
  });
  const moved = await getTaskForActor(taskId, actor, db, targetWorkspaceId);
  if (moved.workspaceId !== targetWorkspaceId) {
    throw new TaskCommandError("Task move verification failed", 500, "VERIFY_FAILED");
  }
  return moved;
}

export async function updateTaskStatus(id: string, status: any, actor: TaskActor, db: TaskDatabase = prisma) { return updateTask(id, { status }, actor, db); }
export async function reassignTask(id: string, assigneeIds: string[], actor: TaskActor, db: TaskDatabase = prisma) { const current = await loadMutable(id, actor, db); if (!canReassignTask(current, actor)) throw new TaskCommandError("Only creator or Admin can reassign", 403, "FORBIDDEN"); return updateTask(id, { assigneeIds }, actor, db); }
export async function addTaskDependencies(id: string, dependencyIds: string[], actor: TaskActor, db: TaskDatabase = prisma) { await loadMutable(id, actor, db); const result = await db.$transaction(async (tx: any) => { await validateDependencies(tx, id, dependencyIds); const row = await tx.taskDependency.createMany({ data: dependencyIds.map(dependsOnId => ({ taskId: id, dependsOnId })) }); await audit(tx, id, "ADD_DEPENDENCY", actor.id, { dependencyIds }); return { taskId: id, count: row.count, dependencyIds }; }, txOptions); const readBack = await getTaskForActor(id, actor, db); const actual = (readBack as any).dependencies?.map((d: any) => d.dependsOnId) ?? []; if (dependencyIds.some(dep => !actual.includes(dep))) throw new TaskCommandError("Dependency verification failed", 500, "VERIFY_FAILED"); return { ...result, dependencies: readBack.dependencies }; }
const mentionPattern = /@(\w+(?:\s+\w+)?)/g;

async function createMentionNotifications(db: any, task: any, commentId: string, body: string, actor: TaskActor) {
  if (!db.user?.findMany || !db.notification?.create) return;
  const names = Array.from(new Set((body.match(mentionPattern) ?? []).map((mention: string) => mention.slice(1).trim()).filter(Boolean)));
  if (!names.length) return;
  const users = await db.user.findMany({ where: { name: { in: names }, isActive: true, id: { not: actor.id } }, select: { id: true } });
  const title = task.title ?? "";
  for (const user of users) {
    try {
      await db.notification.create({ data: { id: `mention:${commentId}:${user.id}`, userId: user.id, type: "mention", title: "Mentioned in Comment", body: `${task.authorName ?? "A teammate"} mentioned you in a comment on \"${title}\"`, linkUrl: `/tasks/${task.id}` } });
    } catch (error) { if (!isUniqueViolation(error)) throw error; }
  }
}

export async function resolveTaskAssigneeLabels(ids: string[], actor: TaskActor, db: TaskDatabase = prisma) { assertViewerAllowed(actor); if (!ids.length || !db.user?.findMany) return new Map<string, string>(); const users = await db.user.findMany({ where: { id: { in: Array.from(new Set(ids)) }, isActive: true }, select: { id: true, name: true, email: true } }); return new Map(users.map((user: any) => [user.id, user.name || user.email || "(not visible)"])); }

export async function addTaskComment(id: string, body: string, actor: TaskActor, db: TaskDatabase = prisma) { assertViewerAllowed(actor); const task = await visibleTask(db, id, actor); const comment = await db.$transaction(async (tx: any) => { const created = await tx.comment.create({ data: { taskId: id, authorId: actor.id, body }, include: { author: { select: { id: true, name: true, image: true } } } }); await audit(tx, id, "COMMENT", actor.id, { commentId: created.id }); return created; }, txOptions); try { await createMentionNotifications(db, { id, title: task.title, authorName: comment.author?.name }, comment.id, body, actor); } catch (error) { console.error("Task mention notification failed:", error); } const readBack = await visibleTask(db, id, actor); const verified = (readBack.comments ?? []).find((item: any) => item.id === comment.id && item.authorId === actor.id && item.body === body); if (!verified) throw new TaskCommandError("Comment verification failed", 500, "VERIFY_FAILED"); return comment; }
export async function removeTaskDependency(id: string, dependencyId: string, actor: TaskActor, db: TaskDatabase = prisma) { await loadMutable(id, actor, db); return db.$transaction(async (tx: any) => { const row = await tx.taskDependency.findFirst({ where: { id: dependencyId, taskId: id } }); if (!row) throw new TaskCommandError("Dependency not found", 404, "NOT_FOUND"); await tx.taskDependency.delete({ where: { id: dependencyId } }); await audit(tx, id, "REMOVE_DEPENDENCY", actor.id, { dependencyId: row.dependsOnId }); return row; }, txOptions); }
export async function findPmoBlockedTaskIds(ids: string[], db: TaskDatabase = prisma): Promise<string[]> { const rows = await db.task.findMany({ where: { id: { in: ids }, type: "EXTERNAL_ACTION" }, select: { id: true } }); return rows.map((row: any) => row.id); }
export async function deleteTasks(ids: string[], actor: TaskActor, db: TaskDatabase = prisma) { assertViewerAllowed(actor); return runTransaction(db, async (tx: any) => { const deleted = await tx.task.deleteMany({ where: { id: { in: ids }, type: "STANDARD" } }); return { count: deleted.count }; }); }
export async function cancelCreatedTasks(ids: string[], actor: TaskActor, db: TaskDatabase = prisma) { assertViewerAllowed(actor); return db.$transaction(async (tx: any) => { const tasks = await tx.task.findMany({ where: { id: { in: ids }, createdById: actor.id, type: "STANDARD", status: { notIn: ["DONE", "CANCELED"] } }, select: { id: true } }); const allowed = tasks.map((t: any) => t.id); if (allowed.length) await tx.task.updateMany({ where: { id: { in: allowed } }, data: { status: "CANCELED" } }); for (const id of allowed) await audit(tx, id, "cancel", actor.id); return { canceledIds: allowed, rejectedIds: ids.filter(id => !allowed.includes(id)) }; }, txOptions); }
export { TaskCommandError };
