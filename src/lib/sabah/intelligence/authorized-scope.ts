import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { SourceRef, WorkspaceEntityType } from "./contracts";

export type ScopeFilters = {
  limit?: number;
  cursor?: string;
  cursorByType?: Partial<Record<WorkspaceEntityType, string>>;
};
export type AuthorizedIds = Partial<Record<WorkspaceEntityType, string[]>>;
export type AuthorizedScope = {
  ids: AuthorizedIds;
  nextCursor?: string;
  nextCursorByType?: Partial<Record<WorkspaceEntityType, string>>;
  truncated: boolean;
};

type AssignmentMeta = { userId?: string };
type MemberMeta = { userId?: string };
export type ScopeRow = {
  id: string;
  isPrivate?: boolean;
  createdById?: string | null;
  authorId?: string | null;
  userId?: string | null;
  ownerId?: string | null;
  managerId?: string | null;
  sponsorId?: string | null;
  requesterId?: string | null;
  claimedById?: string | null;
  departmentId?: string | null;
  responsibleDepartmentId?: string | null;
  assignments?: AssignmentMeta[];
  members?: MemberMeta[];
  departments?: Array<{ departmentId?: string }>;
  isShared?: boolean;

  submittedAt?: unknown;
  finalBody?: string | null;
  status?: string | null;
  isArchived?: boolean;

  closedAt?: unknown;
  task?: ScopeRow | null;
  project?: ScopeRow | null;
  caseStudy?: ScopeRow | null;
};

type ScopeSelect = Record<string, true | { select: ScopeSelect }>;
type ScopeWhere = { id?: { gt: string }; submittedAt?: { not: null }; finalBody?: { not: null } };
type ScopeQuery = { where?: ScopeWhere; select: ScopeSelect; orderBy: { id: "asc" }; take: number };
type ScopeUniqueQuery = { where: { id: string; submittedAt?: { not: null }; finalBody?: { not: null } }; select: ScopeSelect };
type ScopeModel = {
  findMany: (args: ScopeQuery) => Promise<ScopeRow[]>;
  findUnique?: (args: ScopeUniqueQuery) => Promise<ScopeRow | null>;
};
export type AuthorizedScopeDb = Partial<Record<"project" | "task" | "kPI" | "externalAction" | "notePage" | "leaveRequest" | "caseStudy" | "weeklyReport" | "supportRequest", ScopeModel>>;

const MODEL_BY_TYPE: Record<WorkspaceEntityType, keyof AuthorizedScopeDb> = {
  PROJECT: "project", TASK: "task", KPI: "kPI", PMO_ACTION: "externalAction", NOTE: "notePage",
  LEAVE: "leaveRequest", CASE_STUDY: "caseStudy", REPORT: "weeklyReport", SUPPORT_REQUEST: "supportRequest",
};
const NOT_FOUND = () => Object.assign(new Error("Not found"), { status: 404, code: "NOT_FOUND" });
const UNAVAILABLE = () => Object.assign(new Error("Scope unavailable"), { status: 503, code: "SCOPE_UNAVAILABLE" });
const INVALID_LIMIT = () => Object.assign(new Error("Invalid limit"), { status: 400, code: "INVALID_LIMIT" });
const isAdmin = (actor: SabahActor) => actor.role === "ADMIN";
const hasDepartment = (row: ScopeRow, actor: SabahActor) => {
  const ids = [...(row.responsibleDepartmentId ? [row.responsibleDepartmentId] : []), ...(row.departmentId ? [row.departmentId] : []), ...(row.departments ?? []).map((d) => d.departmentId).filter((id): id is string => Boolean(id))];
  return ids.some((id) => actor.departmentIds.includes(id));
};
const inactive = (row: ScopeRow) => row.isArchived === true || row.closedAt != null || ["archived", "inactive", "cancelled", "canceled", "closed"].includes(String(row.status ?? "").toLowerCase());
const taskVisible = (row: ScopeRow, actor: SabahActor) => isAdmin(actor) || !row.isPrivate || row.createdById === actor.id || (row.assignments ?? []).some((a) => a.userId === actor.id);
const projectVisible = (row: ScopeRow, actor: SabahActor) => !inactive(row) && (isAdmin(actor) || row.ownerId === null || row.ownerId === actor.id || row.managerId === actor.id || row.sponsorId === actor.id || (row.members ?? []).some((m) => m.userId === actor.id) || hasDepartment(row, actor));
const caseVisible = (row: ScopeRow, actor: SabahActor) => !inactive(row) && (isAdmin(actor) || row.ownerId === null || row.ownerId === actor.id || (row.members ?? []).some((m) => m.userId === actor.id) || hasDepartment(row, actor));
function linkedVisible(row: ScopeRow, actor: SabahActor): boolean {
  if (row.task && !taskVisible(row.task, actor)) return false;
  if (row.project && !projectVisible(row.project, actor)) return false;
  if (row.caseStudy && !caseVisible(row.caseStudy, actor)) return false;
  return true;
}
function visible(type: WorkspaceEntityType, row: ScopeRow, actor: SabahActor): boolean {
  if (!row?.id || inactive(row)) return false;
  switch (type) {
    case "TASK": return taskVisible(row, actor);
    case "PROJECT": return projectVisible(row, actor);
    case "CASE_STUDY": return caseVisible(row, actor);
    case "LEAVE": return row.userId === actor.id;
    case "NOTE": return linkedVisible(row, actor) && (isAdmin(actor) || row.isShared === true || row.authorId === actor.id);
    case "REPORT": return isAdmin(actor) || row.submittedAt != null;
    case "KPI": return isAdmin(actor) || (actor.departmentIds.length > 0 && row.ownerId == null);
    case "PMO_ACTION": return isAdmin(actor) || actor.role === "LEAD" || row.ownerId === actor.id;
    case "SUPPORT_REQUEST":
      if (row.task && row.task.isPrivate && !taskVisible(row.task, actor)) return false;
      return isAdmin(actor) || row.requesterId === actor.id || row.claimedById === actor.id || (row.project != null && projectVisible(row.project, actor)) || (row.task != null && taskVisible(row.task, actor));
    default: return false;
  }
}

const taskSelect: ScopeSelect = { id: true, isPrivate: true, createdById: true, assignments: { select: { userId: true } } };
const projectSelect: ScopeSelect = { id: true, status: true, ownerId: true, managerId: true, sponsorId: true, responsibleDepartmentId: true, members: { select: { userId: true } } };
const caseStudySelect: ScopeSelect = { id: true, status: true, ownerId: true, members: { select: { userId: true } }, departments: { select: { departmentId: true } } };
const SELECT_BY_TYPE: Record<WorkspaceEntityType, ScopeSelect> = {
  TASK: taskSelect,
  PROJECT: projectSelect,
  CASE_STUDY: caseStudySelect,
  NOTE: { id: true, authorId: true, isShared: true, task: { select: taskSelect }, caseStudy: { select: caseStudySelect } },
  SUPPORT_REQUEST: { id: true, requesterId: true, claimedById: true, task: { select: taskSelect }, project: { select: projectSelect } },
  LEAVE: { id: true, userId: true, status: true, isArchived: true },
  KPI: { id: true, ownerId: true, status: true },
  PMO_ACTION: { id: true, ownerId: true, closedAt: true },
  REPORT: { id: true, submittedAt: true },
};

async function readRows(type: WorkspaceEntityType, actor: SabahActor, db: AuthorizedScopeDb, cursor?: string, take = 101): Promise<ScopeRow[]> {
  const model = db[MODEL_BY_TYPE[type]];
  if (!model) throw UNAVAILABLE();
  const where: ScopeWhere = cursor ? { id: { gt: cursor } } : {};
  if (type === "REPORT" && !isAdmin(actor)) {
    where.submittedAt = { not: null };
    where.finalBody = { not: null };
  }
  return (await model.findMany({ where, select: SELECT_BY_TYPE[type], orderBy: { id: "asc" }, take }))?.sort((a, b) => a.id.localeCompare(b.id)) ?? [];
}
function validLimit(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= 100; }

export async function getAuthorizedEntityIds(actor: SabahActor, entityTypes: WorkspaceEntityType[], filters: ScopeFilters = {}, db: AuthorizedScopeDb = prisma as unknown as AuthorizedScopeDb): Promise<AuthorizedScope> {
  if (filters.limit !== undefined && !validLimit(filters.limit)) throw INVALID_LIMIT();
  const limit = filters.limit ?? 100;
  const types = Array.from(new Set(entityTypes));
  const ids: AuthorizedIds = {};
  const nextCursorByType: Partial<Record<WorkspaceEntityType, string>> = {};
  let truncated = false;
  for (const type of types) {
    const cursor = filters.cursorByType?.[type] ?? (types.length === 1 ? filters.cursor : undefined);
    const rows = await readRows(type, actor, db, cursor, limit + 1);
    const authorized = rows.filter((row) => visible(type, row, actor));
    ids[type] = authorized.slice(0, limit).map((row) => row.id);
    if (authorized.length > limit) {
      truncated = true;
      nextCursorByType[type] = authorized[limit - 1].id;
    } else if (rows.length === limit + 1) {
      truncated = true;
      nextCursorByType[type] = rows[rows.length - 1].id;
    }
  }
  const keys = Object.keys(nextCursorByType) as WorkspaceEntityType[];
  const singleCursor = types.length === 1 ? nextCursorByType[types[0]] : undefined;
  return { ids, ...(singleCursor ? { nextCursor: singleCursor } : {}), ...(keys.length ? { nextCursorByType } : {}), truncated };
}

export async function assertSourceVisible(source: Pick<SourceRef, "entityType" | "entityId">, actor: SabahActor, db: AuthorizedScopeDb = prisma as unknown as AuthorizedScopeDb): Promise<void> {
  const model = db[MODEL_BY_TYPE[source.entityType]];
  if (!model) throw NOT_FOUND();
  const uniqueWhere: ScopeUniqueQuery["where"] = { id: source.entityId };
  if (source.entityType === "REPORT" && !isAdmin(actor)) {
    uniqueWhere.submittedAt = { not: null };
    uniqueWhere.finalBody = { not: null };
  }
  const row = model.findUnique ? await model.findUnique({ where: uniqueWhere, select: SELECT_BY_TYPE[source.entityType] }) : (await readRows(source.entityType, actor, db, undefined, 101)).find((candidate) => candidate.id === source.entityId) ?? null;
  if (!row || !visible(source.entityType, row, actor)) throw NOT_FOUND();
}
