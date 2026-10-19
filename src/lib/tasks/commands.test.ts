import { describe, expect, it, vi } from "vitest";
import { createTask, createTasks, getTaskForActor, listTasksForActor, cancelCreatedTasks, deleteTasks, findPmoBlockedTaskIds, updateTask, updateTaskStatus, addTaskComment } from "./commands";

describe("private-safe task commands", () => {
  it("hides a private task from unrelated users", async () => {
    const db = {
      task: { findFirst: vi.fn().mockResolvedValue(null) },
    } as any;
    await expect(getTaskForActor("private-1", { id: "u2", role: "MEMBER" }, db)).rejects.toMatchObject({ status: 404 });
    expect(db.task.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "private-1", OR: expect.any(Array) }) }));
  });

  it("keeps privacy visibility AND search predicates", async () => {
    const db = { task: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await listTasksForActor({ search: "secret" }, { id: "u2", role: "MEMBER" }, db);
    const where = db.task.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: expect.any(Array) }),
      expect.objectContaining({ OR: expect.any(Array) }),
    ]));
  });

  it("does not comment on a private task outside actor visibility", async () => {
    const db = { task: { findFirst: vi.fn().mockResolvedValue(null) }, $transaction: vi.fn() } as any;
    await expect(addTaskComment("private-1", "secret", { id: "u2", role: "MEMBER" }, db)).rejects.toMatchObject({ status: 404 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("writes private comments as actor and verifies the visible read-back", async () => {
    const comment = { id: "c1", taskId: "private-1", authorId: "u1", body: "secret", author: { id: "u1" } };
    const db = {
      task: { findFirst: vi.fn().mockResolvedValueOnce({ id: "private-1", comments: [] }).mockResolvedValueOnce({ id: "private-1", comments: [comment] }) },
      comment: { create: vi.fn().mockResolvedValue(comment) },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn((fn: any) => fn(db)),
    } as any;
    await expect(addTaskComment("private-1", "secret", { id: "u1", role: "MEMBER" }, db)).resolves.toEqual(comment);
    expect(db.comment.create).toHaveBeenCalledWith(expect.objectContaining({ data: { taskId: "private-1", authorId: "u1", body: "secret" } }));
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("restores deduped mention notifications after the comment transaction", async () => {
    const comment = { id: "c-mention", taskId: "task-1", authorId: "u1", body: "Hi @Ada @Ada", author: { id: "u1", name: "Author" } };
    const db = {
      task: { findFirst: vi.fn().mockResolvedValueOnce({ id: "task-1", title: "Private task", comments: [] }).mockResolvedValueOnce({ id: "task-1", comments: [comment] }) },
      comment: { create: vi.fn().mockResolvedValue(comment) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "u2" }]) },
      notification: { create: vi.fn().mockResolvedValue({ id: "n1" }) },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn((fn: any) => fn(db)),
    } as any;
    await expect(addTaskComment("task-1", comment.body, { id: "u1", role: "MEMBER" }, db)).resolves.toEqual(comment);
    expect(db.notification.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id: "mention:c-mention:u2", userId: "u2", type: "mention" }) });
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isActive: true, id: { not: "u1" } }) }));
  });

  it("rejects duplicate assignees before opening a transaction", async () => {
    const db = { $transaction: vi.fn() } as any;
    await expect(createTask({ title: "x", assigneeIds: ["u1", "u1"] }, { id: "u1", role: "MEMBER" }, db)).rejects.toMatchObject({ code: "DUPLICATE" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("does not cancel terminal standard tasks", async () => {
    const tx = {
      task: { findMany: vi.fn().mockResolvedValue([{ id: "open" }]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn() },
    };
    const db = { $transaction: vi.fn((fn: any) => fn(tx)) } as any;
    const result = await cancelCreatedTasks(["open", "done", "canceled"], { id: "u1", role: "MEMBER" }, db);
    expect(tx.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { notIn: ["DONE", "CANCELED"] } }) }));
    expect(result).toEqual({ canceledIds: ["open"], rejectedIds: ["done", "canceled"] });
  });

  it("hard-deletes only standard tasks and returns the count", async () => {
    const tx = {
      task: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: vi.fn() },
    };
    const db = { $transaction: vi.fn((fn: any) => fn(tx)) } as any;
    const result = await deleteTasks(["a", "b", "pmo"], { id: "u1", role: "MEMBER" }, db);
    expect(tx.task.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a", "b", "pmo"] }, type: "STANDARD" } });
    expect(result).toEqual({ count: 2 });
  });

  it("forbids VIEWER from bulk-deleting tasks", async () => {
    const db = { $transaction: vi.fn() } as any;
    await expect(deleteTasks(["a"], { id: "u1", role: "VIEWER" }, db)).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("finds EXTERNAL_ACTION ids for the PMO pre-flight rejection", async () => {
    const db = { task: { findMany: vi.fn().mockResolvedValue([{ id: "pmo-1" }]) } } as any;
    await expect(findPmoBlockedTaskIds(["t1", "pmo-1"], db)).resolves.toEqual(["pmo-1"]);
    expect(db.task.findMany).toHaveBeenCalledWith({ where: { id: { in: ["t1", "pmo-1"] }, type: "EXTERNAL_ACTION" }, select: { id: true } });
  });

  it("creates an unassigned floating-pool task when assigneeIds is omitted", async () => {
    const db = {
      task: { create: vi.fn().mockResolvedValue({ id: "t1", title: "x" }), findFirst: vi.fn().mockResolvedValue({ id: "t1", title: "x", assignments: [], comments: [] }) },
      taskAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn((fn: any) => fn(db)),
    } as any;
    await createTask({ title: "x" }, { id: "u1", role: "MEMBER" }, db);
    expect(db.taskAssignment.createMany).not.toHaveBeenCalled();
  });

  it("creates unassigned tasks in a batch when assigneeIds is omitted", async () => {
    const db = {
      task: { create: vi.fn().mockResolvedValue({ id: "t1", title: "x" }), findFirst: vi.fn().mockResolvedValue({ id: "t1", title: "x", assignments: [], comments: [] }) },
      taskAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
      $transaction: vi.fn((fn: any) => fn(db)),
    } as any;
    const results = await createTasks([{ title: "x" }], { id: "u1", role: "MEMBER" }, db);
    expect(results).toEqual([expect.objectContaining({ ok: true, index: 0 })]);
    expect(db.taskAssignment.createMany).not.toHaveBeenCalled();
  });

  it("batch-creates Riyadh-dated tasks, audits each write, and reads each task back as the actor", async () => {
    const rows: any[] = [];
    const db: any = {
      task: {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `batch-${rows.length + 1}`, ...data };
          rows.push(row);
          return row;
        }),
        findFirst: vi.fn(async ({ where }: any) => rows.find((row) => row.id === where.id) ?? null),
      },
      taskAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    db.$transaction = vi.fn((fn: (tx: any) => unknown) => fn(db));

    const results = await createTasks([
      { title: "اليوم 1", dueAt: "2026-09-06T23:59:59+03:00", assigneeIds: ["u1"] },
      { title: "غدا 1", dueAt: "2026-09-07T23:59:59+03:00", assigneeIds: ["u1"] },
    ], { id: "u1", role: "MEMBER" }, db);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(rows.map((row) => row.createdById)).toEqual(["u1", "u1"]);
    expect(rows.map((row) => row.dueAt.toISOString())).toEqual([
      "2026-09-06T20:59:59.000Z",
      "2026-09-07T20:59:59.000Z",
    ]);
    expect(db.auditLog.create).toHaveBeenCalledTimes(2);
    expect(db.auditLog.create.mock.calls.map((call: any[]) => call[0].data)).toEqual([
      expect.objectContaining({ entityType: "task", action: "create", actorId: "u1" }),
      expect.objectContaining({ entityType: "task", action: "create", actorId: "u1" }),
    ]);
    expect(db.task.findFirst).toHaveBeenCalledTimes(2);
    expect(results.map((result) => (result as any).data.id)).toEqual(["batch-1", "batch-2"]);
  });

  it("replays an actor/conversation/request-bound batch retry without duplicating dated self tasks", async () => {
    const rows: any[] = [];
    const resultRows = new Map<string, any>();
    const db: any = {
      task: {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `retry-${rows.length + 1}`, ...data };
          rows.push(row);
          return row;
        }),
        findFirst: vi.fn(async ({ where }: any) => rows.find((row) => row.id === where.id) ? { ...rows.find((row) => row.id === where.id), assignments: [], comments: [] } : null),
      },
      taskAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
      user: { findMany: vi.fn(async ({ where }: any) => (where.id.in as string[]).map((id) => ({ id, name: id, email: `${id}@example.com` }))) },
      aiCapabilityResult: {
        create: vi.fn(async ({ data }: any) => {
          if (resultRows.has(data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
          resultRows.set(data.key, { ...data, compensatedAt: null });
          return resultRows.get(data.key);
        }),
        findUnique: vi.fn(async ({ where }: any) => resultRows.get(where.key) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const row = resultRows.get(where.key);
          if (!row || row.state !== where.state || row.compensatedAt !== null) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    };
    db.$transaction = vi.fn((fn: (tx: any) => unknown) => fn(db));
    const inputs = [
      { title: "اليوم 1", dueAt: "2026-09-06T23:59:59+03:00", assigneeIds: ["u1"] },
      { title: "غدا 1", dueAt: "2026-09-07T23:59:59+03:00", assigneeIds: ["u1"] },
    ];
    const options = { allowPartial: false, idempotencyKey: "chat-batch-request", conversationId: "conv-1", requestId: "request-1" };

    const first = await createTasks(inputs, { id: "u1", role: "MEMBER" }, db, options);
    const retry = await createTasks(inputs, { id: "u1", role: "MEMBER" }, db, options);

    expect(rows).toHaveLength(2);
    expect(db.task.create).toHaveBeenCalledTimes(2);
    expect(db.auditLog.create).toHaveBeenCalledTimes(2);
    expect(first.map((result: any) => result.data.id)).toEqual(["retry-1", "retry-2"]);
    expect(retry.map((result: any) => result.data.id)).toEqual(["retry-1", "retry-2"]);
    expect(rows.map((row) => row.createdById)).toEqual(["u1", "u1"]);
    expect(rows.map((row) => row.dueAt.toISOString())).toEqual([
      "2026-09-06T20:59:59.000Z",
      "2026-09-07T20:59:59.000Z",
    ]);
  });

  it("reuses one actor/conversation/request identity and conflicts on changed payload", async () => {
    const rows: any[] = [];
    const resultRows = new Map<string, any>();
    const db: any = {
      task: {
        create: vi.fn(async ({ data }: any) => { const row = { id: `identity-${rows.length + 1}`, ...data }; rows.push(row); return row; }),
        findFirst: vi.fn(async ({ where }: any) => rows.find((row) => row.id === where.id) ? { ...rows.find((row) => row.id === where.id), assignments: [], comments: [] } : null),
      },
      taskAssignment: { deleteMany: vi.fn(), createMany: vi.fn() }, auditLog: { create: vi.fn() },
      aiCapabilityResult: {
        create: vi.fn(async ({ data }: any) => { if (resultRows.has(data.key)) throw Object.assign(new Error("duplicate"), { code: "P2002" }); resultRows.set(data.key, { ...data, compensatedAt: null }); return resultRows.get(data.key); }),
        findUnique: vi.fn(async ({ where }: any) => resultRows.get(where.key) ?? null),
        updateMany: vi.fn(async ({ where, data }: any) => { const row = resultRows.get(where.key); if (!row || row.state !== where.state || row.compensatedAt !== null) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }),
      },
    };
    db.$transaction = vi.fn((fn: (tx: any) => unknown) => fn(db));
    const actor = { id: "u1", role: "MEMBER" as const };
    const options = { allowPartial: false, idempotencyKey: "same-request", conversationId: "conv-1", requestId: "request-1" };
    const first = [{ title: "Original", description: "same", assigneeIds: ["u1"] }];
    const reordered = [{ assigneeIds: ["u1"], description: "same", title: "Original" }];

    const initial = await createTasks(first, actor, db, options);
    const replay = await createTasks(reordered, actor, db, options);

    expect(rows).toHaveLength(1);
    expect(replay.map((result: any) => result.data.id)).toEqual(initial.map((result: any) => result.data.id));
    await expect(createTasks([{ title: "Changed", description: "same", assigneeIds: ["u1"] }], actor, db, options)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(rows).toHaveLength(1);
  });

  it("rejects a VIEWER before opening a batch transaction", async () => {
    const db = { $transaction: vi.fn() } as any;
    await expect(createTasks([{ title: "blocked" }], { id: "u-viewer", role: "VIEWER" }, db)).rejects.toMatchObject({ status: 403 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("restores legacy floating semantics: unassigned and non-terminal", async () => {
    const db = { task: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await listTasksForActor({ floating: true }, { id: "u1", role: "MEMBER" }, db);
    const where = db.task.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(expect.arrayContaining([{ assignments: { none: {} }, status: { notIn: ["DONE", "CANCELED"] } }]));
    expect(where.AND).not.toEqual(expect.arrayContaining([{ projectId: null, caseStudyId: null }]));
  });

  it("runs status updates against a transaction client without $transaction", async () => {
    const task = { id: "t1", type: "STANDARD", status: "TODO", createdById: "u1", assignments: [], comments: [], externalAction: null, project: null, caseStudy: null, updatedAt: new Date() };
    const tx = {
      task: { findFirst: vi.fn().mockResolvedValue(task), update: vi.fn().mockResolvedValue({ id: "t1", title: "x" }) },
      auditLog: { create: vi.fn() },
    } as any;
    await updateTaskStatus("t1", "DOING", { id: "u1", role: "MEMBER" }, tx);
    expect(tx.task.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t1" }, data: expect.objectContaining({ status: "DOING" }) }));
  });

  it("replaces dependency rows when dependencyIds is supplied", async () => {
    const task = { id: "t1", type: "STANDARD", status: "TODO", createdById: "u1", assignments: [], comments: [], externalAction: null, project: null, caseStudy: null, updatedAt: new Date() };
    const tx = {
      task: { findFirst: vi.fn().mockResolvedValue(task), findMany: vi.fn().mockResolvedValue([{ id: "d1" }, { id: "d2" }]), update: vi.fn().mockResolvedValue({ id: "t1", title: "x" }) },
      taskDependency: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(), createMany: vi.fn() },
      auditLog: { create: vi.fn() },
    } as any;
    await updateTask("t1", { dependencyIds: ["d1", "d2"] }, { id: "u1", role: "MEMBER" }, tx);
    expect(tx.taskDependency.deleteMany).toHaveBeenCalledWith({ where: { taskId: "t1" } });
    expect(tx.taskDependency.createMany).toHaveBeenCalledWith({ data: [{ taskId: "t1", dependsOnId: "d1" }, { taskId: "t1", dependsOnId: "d2" }] });
  });

  it("compares-and-swaps on expectedUpdatedAt inside the update predicate", async () => {
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    const task = { id: "t1", type: "STANDARD", status: "TODO", createdById: "u1", assignments: [], comments: [], externalAction: null, project: null, caseStudy: null, updatedAt };
    const tx = {
      task: { findFirst: vi.fn().mockResolvedValue(task), update: vi.fn().mockRejectedValue(Object.assign(new Error("no match"), { code: "P2025" })) },
      auditLog: { create: vi.fn() },
    } as any;
    await expect(updateTask("t1", { title: "New", expectedUpdatedAt: updatedAt.toISOString() }, { id: "u1", role: "MEMBER" }, tx)).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
    expect(tx.task.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "t1", updatedAt } }));
  });

  it.each(["DONE", "CANCELED"])("rejects generic field mutation of terminal external action: %s", async (status) => {
    const db = {
      task: { findFirst: vi.fn().mockResolvedValue({ id: "pmo-1", type: "EXTERNAL_ACTION", status, assignments: [], externalAction: { ownerId: "owner", owner: { managerId: null } }, project: { ownerId: null }, caseStudy: null, updatedAt: new Date() }) },
      $transaction: vi.fn(),
    } as any;
    await expect(updateTask("pmo-1", { title: "rewritten" }, { id: "owner", role: "LEAD" }, db)).rejects.toMatchObject({ code: "PMO_WORKFLOW_REQUIRED", status: 409 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
