import { prisma } from "@/lib/prisma";
import { assertSupportWriteAllowed, SupportCommandError, supportVisibility, type SupportActor } from "./authorization";
import { createSupportRequestSchema, supportRequestQuerySchema, type CreateSupportRequestInput, type SupportRequestQuery } from "./schemas";

type SupportDatabase = any;
const safeUserSelect = { id: true, name: true, title: true, role: true } as const;
const supportProjectSelect = { id: true, name: true, status: true, ownerId: true, managerId: true, sponsorId: true, members: { select: { userId: true } } } as const;
const supportTaskSelect = { id: true, title: true, status: true, projectId: true, isPrivate: true, createdById: true, assignments: { select: { userId: true } } } as const;
const includeSupport = { requester: { select: safeUserSelect }, claimedBy: { select: safeUserSelect }, project: { select: supportProjectSelect }, task: { select: supportTaskSelect } };

const txOptions = { isolationLevel: "Serializable" as const };

function safeUser(user: any) {
  if (user == null) return user;
  return { id: user.id, name: user.name ?? null, title: user.title ?? null, role: user.role ?? null };
}

function safeSupport(row: any) {
  if (!row) return row;
  const { project, task, ...support } = row;
  return {
    ...support,
    requester: safeUser(row.requester),
    claimedBy: safeUser(row.claimedBy),
    project: project && { id: project.id, name: project.name ?? null, status: project.status ?? null },
    task: task && { id: task.id, title: task.title ?? null, status: task.status ?? null, projectId: task.projectId ?? null },
  };
}

function active(entity: any): boolean {
  const status = String(entity?.status ?? "").toLowerCase();
  return !["archived", "closed", "canceled", "cancelled"].includes(status);
}

function canViewTask(task: any, userId: string): boolean {
  return !task?.isPrivate || task.createdById === userId || (task.assignments ?? []).some((assignment: any) => assignment.userId === userId);
}

async function visibleSupport(id: string, actor: SupportActor, db: SupportDatabase) {
  const where = { AND: [{ id }, supportVisibility(actor)] };
  if (db.supportRequest.findFirst) return safeSupport(await db.supportRequest.findFirst({ where, include: includeSupport }));
  const row = await db.supportRequest.findUnique({ where: { id }, include: includeSupport });
  if (!row || actor.role === "ADMIN" || row.requesterId === actor.id || row.claimedById === actor.id) return safeSupport(row);
  const project = row.project;
  const projectVisible = !row.projectId || (project && (project.ownerId === actor.id || project.managerId === actor.id || project.sponsorId === actor.id || (project.members ?? []).some((m: any) => m.userId === actor.id)));
  const task = row.task;
  const taskVisible = !row.taskId || (task && (!task.isPrivate || task.createdById === actor.id || (task.assignments ?? []).some((a: any) => a.userId === actor.id)));
  return projectVisible && taskVisible ? safeSupport(row) : null;
}

export async function assertSupportRequestVisible(id: string, actor: SupportActor, db: SupportDatabase = prisma) {
  const row = await visibleSupport(id, actor, db);
  if (!row) throw new SupportCommandError("Support request not found", 404, "NOT_FOUND");
  return row;
}

async function transaction<T>(db: SupportDatabase, fn: (tx: SupportDatabase) => Promise<T>): Promise<T> {
  return db.$transaction ? db.$transaction(fn, txOptions) : fn(db);
}

async function validateLinks(input: CreateSupportRequestInput, actor: SupportActor, db: SupportDatabase): Promise<void> {
  if (input.projectId && db.project?.findUnique) {
    const project = await db.project.findUnique({ where: { id: input.projectId }, include: { members: true } });
    if (!project || !active(project)) throw new SupportCommandError("Linked project is not active or visible", 404, "NOT_FOUND");
    if (actor.role !== "ADMIN" && project.ownerId !== actor.id && project.managerId !== actor.id && project.sponsorId !== actor.id && !(project.members ?? []).some((m: any) => m.userId === actor.id)) {
      throw new SupportCommandError("Linked project is not visible", 404, "NOT_FOUND");
    }
  }
  if (input.taskId && db.task?.findUnique) {
    const task = await db.task.findUnique({ where: { id: input.taskId }, include: { assignments: true } });
    if (!task || !active(task)) throw new SupportCommandError("Linked task is not active or visible", 404, "NOT_FOUND");
    if (input.projectId && task.projectId && task.projectId !== input.projectId) throw new SupportCommandError("Linked task does not belong to the linked project", 400, "INVALID_LINK");
    if (actor.role !== "ADMIN" && task.isPrivate && task.createdById !== actor.id && !(task.assignments ?? []).some((a: any) => a.userId === actor.id)) {
      throw new SupportCommandError("Linked task is not visible", 404, "NOT_FOUND");
    }
  }
}

export async function listSupportForActor(raw: SupportRequestQuery = {}, actor: SupportActor, db: SupportDatabase = prisma) {
  const input = supportRequestQuerySchema.parse(raw);
  const conditions: any[] = [supportVisibility(actor)];
  if (input.projectId) conditions.push({ projectId: input.projectId });
  if (input.taskId) conditions.push({ taskId: input.taskId });
  if (input.status) conditions.push({ status: input.status });
  if (input.query) conditions.push({ OR: [{ title: { contains: input.query, mode: "insensitive" } }, { description: { contains: input.query, mode: "insensitive" } }] });
  return db.supportRequest.findMany({ where: { AND: conditions }, include: includeSupport, orderBy: { createdAt: "desc" }, take: Math.min(input.limit ?? 100, 100) }).then((rows: any[]) => rows.map(safeSupport));
}

export async function createSupportRequest(raw: CreateSupportRequestInput, actor: SupportActor, db: SupportDatabase = prisma) {
  assertSupportWriteAllowed(actor);
  const input = createSupportRequestSchema.parse(raw);
  await validateLinks(input, actor, db);
  const created = await transaction(db, async (tx) => {
    const support = await tx.supportRequest.create({ data: { title: input.title, description: input.description ?? null, projectId: input.projectId ?? null, taskId: input.taskId ?? null, requesterId: actor.id }, include: includeSupport });
    const ids = new Set<string>();
    let linkedTask: any = null;
    if (input.taskId && tx.task?.findUnique) linkedTask = await tx.task.findUnique({ where: { id: input.taskId }, include: { assignments: true } });
    if (input.projectId && tx.projectMember?.findMany) {
      for (const row of await tx.projectMember.findMany({ where: { projectId: input.projectId }, select: { userId: true } })) {
        if (!linkedTask || canViewTask(linkedTask, row.userId)) ids.add(row.userId);
      }
    }
    if (input.taskId && tx.taskAssignment?.findMany) for (const row of await tx.taskAssignment.findMany({ where: { taskId: input.taskId }, select: { userId: true } })) ids.add(row.userId);
    ids.delete(actor.id);
    const recipients = Array.from(ids).sort();
    if (recipients.length && tx.notification?.createMany) await tx.notification.createMany({ data: recipients.map((userId) => ({ userId, type: "support_request", title: "Support Request", body: `${actor.id} needs help: ${input.title}`, linkUrl: input.taskId ? `/tasks/${input.taskId}` : `/projects/${input.projectId}` })) });
    if (tx.auditLog?.create) await tx.auditLog.create({ data: { entityType: "SupportRequest", entityId: support.id, action: "CREATE", actorId: actor.id, metaJson: JSON.stringify({ recipientIds: recipients }) } });
    return support;
  });
  const readBack = await visibleSupport(created.id, actor, db);
  if (!readBack) throw new SupportCommandError("Support request verification failed", 500, "VERIFY_FAILED");
  return readBack;
}

export async function claimSupportRequest(id: string, actor: SupportActor, db: SupportDatabase = prisma) {
  assertSupportWriteAllowed(actor);
  const current = await visibleSupport(id, actor, db);
  if (!current) throw new SupportCommandError("Support request not found", 404, "NOT_FOUND");
  if (current.claimedById || current.status !== "Open") throw new SupportCommandError("Support request already claimed", 409, "ALREADY_CLAIMED");
  await transaction(db, async (tx) => {
    const result = await tx.supportRequest.updateMany({ where: { id, status: "Open", claimedById: null }, data: { status: "Claimed", claimedById: actor.id } });
    if (result.count !== 1) throw new SupportCommandError("Support request was claimed by another user", 409, "CLAIM_CONFLICT");
    if (current.requesterId !== actor.id && tx.notification?.create) await tx.notification.create({ data: { userId: current.requesterId, type: "support_claimed", title: "Support Request Claimed", body: `${actor.id} is helping with: ${current.title}`, linkUrl: current.taskId ? `/tasks/${current.taskId}` : `/projects/${current.projectId}` } });
    if (tx.auditLog?.create) await tx.auditLog.create({ data: { entityType: "SupportRequest", entityId: id, action: "CLAIM", actorId: actor.id } });
  });
  const readBack = await visibleSupport(id, actor, db);
  if (!readBack || readBack.claimedById !== actor.id) throw new SupportCommandError("Support request verification failed", 500, "VERIFY_FAILED");
  return readBack;
}
