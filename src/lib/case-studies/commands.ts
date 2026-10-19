import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { canCreateCaseStudies, canUpdateCaseStudy, visibleCaseStudyWhere } from "./authorization";
import { createCaseStudySchema, updateCaseStudySchema, type CreateCaseStudyInput, type UpdateCaseStudyInput, type CaseStudySearchInput, type PlanCaseStudyTasksInput } from "./schemas";

export class CaseStudyCommandError extends Error { constructor(message: string, public readonly status: number, public readonly code: string) { super(message); this.name = "CaseStudyCommandError"; } }
type Db = any;
const include = { owner: true, workArea: true, members: { include: { user: true } }, departments: { include: { department: true } }, tasks: { include: { assignments: { include: { user: true } }, tags: { include: { tag: true } } }, orderBy: { createdAt: "desc" as const } }, links: true, notes: true };
const d = (v?: string | null) => v == null ? null : new Date(v);
const unique = (xs?: string[]) => Array.from(new Set(xs ?? []));

async function refs(tx: Db, input: { ownerId?: string | null; memberIds?: string[]; departmentIds?: string[]; workAreaId?: string | null }) {
  const users = unique([input.ownerId ?? undefined, ...(input.memberIds ?? [])].filter(Boolean) as string[]);
  if (users.length && tx.user) { const rows = await tx.user.findMany({ where: { id: { in: users }, isActive: true }, select: { id: true } }); if (rows.length !== users.length) throw new CaseStudyCommandError("Referenced user is missing or inactive", 400, "INVALID_REFERENCE"); }
  if (input.departmentIds?.length && tx.department) { const rows = await tx.department.findMany({ where: { id: { in: unique(input.departmentIds) } }, select: { id: true } }); if (rows.length !== unique(input.departmentIds).length) throw new CaseStudyCommandError("Referenced department not found", 400, "INVALID_REFERENCE"); }
  if (input.workAreaId && tx.workArea) { const row = await tx.workArea.findFirst({ where: { id: input.workAreaId, isArchived: false }, select: { id: true } }); if (!row) throw new CaseStudyCommandError("Active work area not found", 400, "INVALID_REFERENCE"); }
}
async function audit(tx: Db, id: string, action: string, actorId: string, fields: string[]) { if (tx.auditLog?.create) await tx.auditLog.create({ data: { entityType: "case_study", entityId: id, action, actorId, metaJson: JSON.stringify({ fields }) } }); }
async function readBack(id: string, actor: SabahActor, db: Db) { const row = await db.caseStudy.findFirst({ where: { AND: [{ id }, visibleCaseStudyWhere(actor)] }, include }); if (!row) throw new CaseStudyCommandError("Case study not found", 404, "NOT_FOUND"); return row; }

export async function listCaseStudiesForActor(query: CaseStudySearchInput = { query: "" }, actor: SabahActor, db: Db = prisma) {
  const where: any = { AND: [visibleCaseStudyWhere(actor)] }; if (query.query) where.AND.push({ OR: [{ name: { contains: query.query, mode: "insensitive" } }, { brief: { contains: query.query, mode: "insensitive" } }] }); if (query.status) where.AND.push({ status: query.status }); if (query.workAreaId !== undefined) where.AND.push({ workAreaId: query.workAreaId }); if (query.floating !== undefined) where.AND.push({ ownerId: query.floating ? null : { not: null } }); if (query.requestingDepartmentId) where.AND.push({ departments: { some: { departmentId: query.requestingDepartmentId } } });
  const rows = await db.caseStudy.findMany({ where, include: { owner: true, workArea: true, departments: { include: { department: true } }, tasks: { select: { status: true } } }, orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map((r: any) => ({ ...r, reportReady: !!r.reportBody, openTaskCount: r.tasks.filter((t: any) => !["DONE", "CANCELED"].includes(t.status)).length }));
}
export async function getCaseStudyForActor(id: string, actor: SabahActor, db: Db = prisma) { return readBack(id, actor, db); }

export async function createCaseStudy(raw: CreateCaseStudyInput, actor: SabahActor, db: Db = prisma) {
  if (!canCreateCaseStudies(actor)) throw new CaseStudyCommandError("VIEWER cannot create case studies", 403, "FORBIDDEN");
  const input = createCaseStudySchema.parse(raw); const ownerId = input.ownerId === undefined ? actor.id : input.ownerId;
  const created = await db.$transaction(async (tx: Db) => { await refs(tx, { ...input, ownerId }); const row = await tx.caseStudy.create({ data: { name: input.name, brief: input.brief ?? null, status: input.status ?? "Open", dueAt: d(input.dueAt), dueAtEnd: d(input.dueAtEnd), ownerId, workAreaId: input.workAreaId ?? null, departments: input.departmentIds ? { create: unique(input.departmentIds).map(departmentId => ({ departmentId })) } : undefined, members: input.memberIds ? { create: unique(input.memberIds).map(userId => ({ userId })) } : undefined }, select: { id: true } }); await audit(tx, row.id, "created", actor.id, Object.keys(input)); return row; }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return readBack(created.id, actor, db);
}

export async function updateCaseStudy(id: string, raw: UpdateCaseStudyInput, actor: SabahActor, expectedUpdatedAt: Date, db: Db = prisma) {
  const current = await db.caseStudy.findUnique({ where: { id }, select: { updatedAt: true } }); if (!current) throw new CaseStudyCommandError("Case study not found", 404, "NOT_FOUND"); if (!(await canUpdateCaseStudy(id, actor, db))) throw new CaseStudyCommandError("Forbidden", 403, "FORBIDDEN"); if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) throw new CaseStudyCommandError("Case study was modified by someone else", 409, "VERSION_CONFLICT");
  const input = updateCaseStudySchema.parse(raw); const updated = await db.$transaction(async (tx: Db) => { await refs(tx, input); if (input.workAreaId === null && await tx.task.count({ where: { caseStudyId: id, type: "EXTERNAL_ACTION" } })) throw new CaseStudyCommandError("Move or remove external actions before clearing the work area", 409, "WORK_AREA_REQUIRED"); const data: any = {}; for (const key of ["name", "brief", "status", "ownerId", "workAreaId"]) if ((input as any)[key] !== undefined) data[key] = (input as any)[key]; if (input.dueAt !== undefined) data.dueAt = d(input.dueAt); if (input.dueAtEnd !== undefined) data.dueAtEnd = d(input.dueAtEnd); const row = await tx.caseStudy.update({ where: { id, updatedAt: expectedUpdatedAt }, data, select: { id: true } }); if (input.memberIds !== undefined) { await tx.caseStudyMember.deleteMany({ where: { caseStudyId: id } }); if (unique(input.memberIds).length) await tx.caseStudyMember.createMany({ data: unique(input.memberIds).map(userId => ({ caseStudyId: id, userId })) }); } if (input.departmentIds !== undefined) { await tx.caseStudyDepartment.deleteMany({ where: { caseStudyId: id } }); if (unique(input.departmentIds).length) await tx.caseStudyDepartment.createMany({ data: unique(input.departmentIds).map(departmentId => ({ caseStudyId: id, departmentId })) }); } await audit(tx, id, "updated", actor.id, Object.keys(input)); return row; }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return readBack(updated.id, actor, db);
}

export async function planCaseStudyTasks(input: PlanCaseStudyTasksInput, actor: SabahActor, db: Db = prisma) { const parent = await readBack(input.caseStudyId, actor, db); if (!canCreateCaseStudies(actor)) throw new CaseStudyCommandError("VIEWER cannot plan tasks", 403, "FORBIDDEN"); return { caseStudyId: parent.id, proposed: true, steps: input.tasks.map((task: any, index: number) => ({ capability: "tasks.create", index, input: { ...task, caseStudyId: parent.id } })) }; }
