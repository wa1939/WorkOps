import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { assertCanReadKpi, assertCanWriteKpi, assertDepartmentKpi, KpiCommandError } from "./authorization";
import { createKpiSchema, updateKpiSchema, logKpiUpdateSchema, linkProjectObjectiveSchema, type CreateKpiInput, type UpdateKpiInput, type LogKpiUpdateInput } from "./schemas";

type DB = any;
const listProjection = { owner: true, updates: { orderBy: { createdAt: "desc" }, take: 1 } };
const detailProjection = { owner: true, updates: { orderBy: { createdAt: "desc" } }, tasks: true, projectObjectives: true };
function dbOrDefault(db?: DB): DB { return db ?? prisma; }
function fields(input: Record<string, unknown>) { const out = { ...input }; delete out.id; delete out.expectedUpdatedAt; delete out.ownerId; return out; }
async function audit(db: DB, entityId: string, action: string, actor: SabahActor, meta: unknown) { if (db.auditLog?.create) await db.auditLog.create({ data: { entityType: "kpi", entityId, action, actorId: actor.id, metaJson: JSON.stringify(meta) } }); }
async function readBack(db: DB, id: string) { const value = await db.kPI.findUnique({ where: { id }, include: detailProjection }); if (!value) throw new KpiCommandError("KPI vanished after write", 500, "READ_BACK_FAILED"); return value; }
function assertVersion(actual: Date, expected: string) { if (actual.getTime() !== new Date(expected).getTime()) throw new KpiCommandError("KPI was modified by someone else", 409, "VERSION_CONFLICT"); }
async function transaction<T>(db: DB, work: (tx: DB) => Promise<T>): Promise<T> { return db.$transaction ? db.$transaction(work, { isolationLevel: "Serializable" }) : work(db); }
async function visibleProject(db: DB, projectId: string, actor: SabahActor) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, ownerId: true, managerId: true, sponsorId: true, responsibleDepartmentId: true, members: { where: { userId: actor.id }, select: { id: true } } } });
  return !!project && (actor.role === "ADMIN" || project.ownerId === actor.id || project.managerId === actor.id || project.sponsorId === actor.id || project.members?.length > 0 || (!!project.responsibleDepartmentId && actor.departmentIds.includes(project.responsibleDepartmentId)));
}

export async function listKpisForActor(query: { search?: string; perspective?: string } = {}, actor: SabahActor, db?: DB) {
  assertCanReadKpi(actor); const client = dbOrDefault(db); const where: any = {};
  if (query.search) where.OR = [{ name: { contains: query.search, mode: "insensitive" } }, { objective: { contains: query.search, mode: "insensitive" } }];
  if (query.perspective) where.perspective = query.perspective;
  return client.kPI.findMany({ where, include: listProjection, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
}
export async function getKpiForActor(id: string, actor: SabahActor, db?: DB) { assertCanReadKpi(actor); return dbOrDefault(db).kPI.findUnique({ where: { id }, include: detailProjection }); }

export async function createKpi(input: CreateKpiInput, actor: SabahActor, db?: DB) {
  assertCanWriteKpi(actor); const parsed = createKpiSchema.parse(input); assertDepartmentKpi(parsed); const client = dbOrDefault(db);
  const created = await client.kPI.create({ data: { ...fields(parsed as any), trackingPeriod: parsed.trackingPeriod ?? "ANNUAL", status: parsed.status ?? "ON_TRACK", ownerId: null }, select: { id: true } });
  await audit(client, created.id, "created", actor, { fields: Object.keys(fields(parsed as any)) }); return readBack(client, created.id);
}
export async function updateKpi(id: string, input: Omit<UpdateKpiInput, "id"> | UpdateKpiInput, actor: SabahActor, expectedUpdatedAt?: Date, db?: DB) {
  assertCanWriteKpi(actor); const parsed = updateKpiSchema.parse({ id, ...(input as any), expectedUpdatedAt: (input as any).expectedUpdatedAt ?? expectedUpdatedAt?.toISOString() }); assertDepartmentKpi(parsed); const client = dbOrDefault(db);
  const existing = await client.kPI.findUnique({ where: { id }, select: { updatedAt: true } }); if (!existing) throw new KpiCommandError("KPI not found", 404, "NOT_FOUND");
  assertVersion(existing.updatedAt, parsed.expectedUpdatedAt);
  await transaction(client, async (tx) => {
    const claimed = await tx.kPI.updateMany({ where: { id, updatedAt: new Date(parsed.expectedUpdatedAt) }, data: fields(parsed as any) });
    if (claimed.count !== 1) throw new KpiCommandError("KPI was modified by someone else", 409, "VERSION_CONFLICT");
    await audit(tx, id, "updated", actor, { fields: Object.keys(fields(parsed as any)) });
  });
  return readBack(client, id);
}
function calculateScore(actual: number, target: number, levels: Array<number | null | undefined>) {
  const percent = (actual / target) * 100;
  if (levels.every((level) => level != null)) { if (percent >= levels[4]!) return 5; if (percent >= levels[3]!) return 4; if (percent >= levels[2]!) return 3; if (percent >= levels[1]!) return 2; return 1; }
  if (percent >= 100) return 5; if (percent >= 80) return 4; if (percent >= 60) return 3; if (percent >= 40) return 2; return 1;
}
export async function logKpiUpdate(id: string, input: Omit<LogKpiUpdateInput, "id"> | LogKpiUpdateInput, actor: SabahActor, db?: DB) {
  assertCanWriteKpi(actor); const parsed = logKpiUpdateSchema.parse({ id, ...(input as any) }); const client = dbOrDefault(db);
  const kpi = await client.kPI.findUnique({ where: { id }, select: { id: true, updatedAt: true, annualTarget: true, q1Target: true, q2Target: true, q3Target: true, q4Target: true, level1: true, level2: true, level3: true, level4: true, level5: true } }); if (!kpi) throw new KpiCommandError("KPI not found", 404, "NOT_FOUND");
  if (parsed.expectedUpdatedAt) assertVersion(kpi.updatedAt, parsed.expectedUpdatedAt);
  const period = parsed.quarter ?? parsed.period; const target = period === "Q1" ? kpi.q1Target : period === "Q2" ? kpi.q2Target : period === "Q3" ? kpi.q3Target : period === "Q4" ? kpi.q4Target : kpi.annualTarget; if (target == null) throw new KpiCommandError(`No target set for ${period}`, 400, "INVALID_PERIOD");
  const achievementPercent = (parsed.value / target) * 100; const score = parsed.score ?? calculateScore(parsed.value, target, [kpi.level1, kpi.level2, kpi.level3, kpi.level4, kpi.level5]);
  const update = await transaction(client, async (tx) => {
    const claimed = await tx.kPI.updateMany({ where: { id, updatedAt: new Date(parsed.expectedUpdatedAt) }, data: { status: score <= 2 ? "OFF_TRACK" : score === 3 ? "AT_RISK" : "ON_TRACK" } });
    if (claimed.count !== 1) throw new KpiCommandError("KPI was modified by someone else", 409, "VERSION_CONFLICT");
    const created = await tx.kPIUpdate.create({ data: { kpiId: id, value: parsed.value, note: parsed.note ?? null, period, quarter: period, score, achievementPercent, createdById: actor.id } });
    await audit(tx, id, "update_logged", actor, { updateId: created.id, period });
    return created;
  });
  return { ...(await readBack(client, id)), update };
}
export async function linkProjectObjective(input: { kpiId: string; projectObjectiveId: string; expectedUpdatedAt?: string }, actor: SabahActor, db?: DB) {
  assertCanWriteKpi(actor); assertCanReadKpi(actor); const parsed = linkProjectObjectiveSchema.parse(input); const client = dbOrDefault(db);
  const objective = await client.projectObjective.findUnique({ where: { id: parsed.projectObjectiveId }, select: { id: true, projectId: true, kpiId: true } }); const kpi = await client.kPI.findUnique({ where: { id: parsed.kpiId }, select: { id: true, updatedAt: true } }); if (!objective || !kpi) throw new KpiCommandError("Project objective or KPI not found", 404, "NOT_FOUND");
  if (!(await visibleProject(client, objective.projectId, actor))) throw new KpiCommandError("Project objective is not visible", 403, "FORBIDDEN"); assertVersion(kpi.updatedAt, parsed.expectedUpdatedAt);
  await transaction(client, async (tx) => {
    const claimed = await tx.kPI.updateMany({ where: { id: parsed.kpiId, updatedAt: new Date(parsed.expectedUpdatedAt) }, data: { updatedAt: new Date() } });
    if (claimed.count !== 1) throw new KpiCommandError("KPI was modified by someone else", 409, "VERSION_CONFLICT");
    await tx.projectObjective.update({ where: { id: parsed.projectObjectiveId }, data: { kpiId: parsed.kpiId } });
    await audit(tx, parsed.kpiId, "linked_project_objective", actor, { projectObjectiveId: parsed.projectObjectiveId });
  });
  return readBack(client, parsed.kpiId);
}
