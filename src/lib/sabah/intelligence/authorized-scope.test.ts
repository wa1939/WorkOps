import { describe, expect, it, vi } from "vitest";
import { assertSourceVisible, getAuthorizedEntityIds, type AuthorizedScopeDb } from "./authorized-scope";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { SourceRef } from "./contracts";

const actor = (id: string, role: SabahActor["role"] = "MEMBER", departmentIds: string[] = ["d1"]): SabahActor => ({ id, role, departmentIds });
type Select = Record<string, true | { select: Select }>;
const project = (row: Record<string, unknown>, select: Select): Record<string, unknown> => Object.fromEntries(Object.entries(select).flatMap(([key, value]) => {
  if (!(key in row)) return [];
  if (value === true) return [[key, row[key]]];
  const nested = row[key];
  if (nested == null) return [[key, nested]];
  const projectOne = (item: Record<string, unknown>) => project(item, value.select);
  return [[key, Array.isArray(nested) ? nested.map(projectOne) : projectOne(nested as Record<string, unknown>)]];
}));
type Where = { id?: { gt: string } | string; submittedAt?: { not: null }; finalBody?: { not: null } };
const matches = (row: Record<string, unknown>, where?: Where) =>
  (!where?.id || (typeof where.id === "string" ? String(row.id) === where.id : String(row.id) > where.id.gt)) &&
  (!where?.submittedAt || row.submittedAt != null) &&
  (!where?.finalBody || row.finalBody != null);
const rows = (values: Record<string, unknown>[]) => ({
  findMany: vi.fn().mockImplementation((args: { where?: { id?: { gt: string }; submittedAt?: { not: null }; finalBody?: { not: null } }; select: Select; take?: number }) => Promise.resolve(values.filter((row) => matches(row, args.where)).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, args.take).map((row) => project(row, args.select)))),
  findUnique: vi.fn().mockImplementation((args: { where: { id: string; submittedAt?: { not: null }; finalBody?: { not: null } }; select: Select }) => Promise.resolve(values.find((row) => String(row.id) === args.where.id && matches(row, args.where)) ? project(values.find((row) => String(row.id) === args.where.id)!, args.select) : null)),
});
const db = (values: Partial<Record<keyof AuthorizedScopeDb, Record<string, unknown>[]>>): AuthorizedScopeDb => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) result[key] = rows(value ?? []);
  return result as AuthorizedScopeDb;
};
const source = (entityType: SourceRef["entityType"], entityId: string): SourceRef => ({ entityType, entityId, label: "opaque", href: "/opaque", sourceUpdatedAt: "2026-01-01T00:00:00.000Z", checksum: "checksum" });

 describe("actor-scoped retrieval authorization", () => {
  it("filters private tasks, preserves shared visibility, and never exposes bodies", async () => {
    const database = db({ task: [
      { id: "t-private-other", isPrivate: true, createdById: "other", assignments: [] },
      { id: "t-private-assigned", isPrivate: true, createdById: "other", assignments: [{ userId: "me" }], description: "secret" },
      { id: "t-shared", isPrivate: false, createdById: "other", body: "secret" },
    ] });
    const result = await getAuthorizedEntityIds(actor("me"), ["TASK"], undefined, database);
    expect(result.ids.TASK).toEqual(["t-private-assigned", "t-shared"]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("enforces self-only leave and shared/authored note visibility", async () => {
    const database = db({ leaveRequest: [{ id: "l-foreign", userId: "other" }, { id: "l-self", userId: "me" }], notePage: [
      { id: "n-private-other", isShared: false, authorId: "other" }, { id: "n-shared", isShared: true, authorId: "other" }, { id: "n-own", isShared: false, authorId: "me" },
    ] });
    const result = await getAuthorizedEntityIds(actor("me"), ["LEAVE", "NOTE"], undefined, database);
    expect(result.ids.LEAVE).toEqual(["l-self"]);
    expect(result.ids.NOTE).toEqual(["n-own", "n-shared"]);
  });

  it("uses owner/member/department visibility for projects, cases, support and PMO", async () => {
    const database = db({ project: [{ id: "p-member", members: [{ userId: "me" }], status: "Active" }, { id: "p-foreign", ownerId: "other", status: "Active" }], caseStudy: [{ id: "c-dept", departments: [{ departmentId: "d1" }], status: "Open" }, { id: "c-foreign", ownerId: "other", status: "Open" }], supportRequest: [{ id: "s-owner", requesterId: "me" }, { id: "s-foreign", requesterId: "other" }], externalAction: [{ id: "a-owner", ownerId: "me" }, { id: "a-foreign", ownerId: "other" }] });
    const result = await getAuthorizedEntityIds(actor("me"), ["PROJECT", "CASE_STUDY", "SUPPORT_REQUEST", "PMO_ACTION"], undefined, database);
    expect(result.ids.PROJECT).toEqual(["p-member"]);
    expect(result.ids.CASE_STUDY).toEqual(["c-dept"]);
    expect(result.ids.SUPPORT_REQUEST).toEqual(["s-owner"]);
    expect(result.ids.PMO_ACTION).toEqual(["a-owner"]);
  });

  it("allows shared department KPIs and only finalized reports for non-admins", async () => {
    const database = db({ kPI: [{ id: "k-shared", ownerId: null }, { id: "k-private", ownerId: "other" }], weeklyReport: [{ id: "r-draft", submittedAt: null, finalBody: null }, { id: "r-final", submittedAt: "2026-01-01", finalBody: "final" }] });
    const result = await getAuthorizedEntityIds(actor("me"), ["KPI", "REPORT"], undefined, database);
    expect(result.ids.KPI).toEqual(["k-shared"]);
    expect(result.ids.REPORT).toEqual(["r-final"]);
  });

  it("includes draft reports in the admin scope without querying report bodies", async () => {
    const database = db({ weeklyReport: [{ id: "r-draft", submittedAt: null, finalBody: null }, { id: "r-final", submittedAt: "2026-01-01", finalBody: "final" }] });
    const result = await getAuthorizedEntityIds(actor("admin", "ADMIN"), ["REPORT"], undefined, database);
    expect(result.ids.REPORT).toEqual(["r-draft", "r-final"]);
    const query = (database.weeklyReport as any).findMany.mock.calls[0][0];
    expect(query.where).toEqual({});
    expect(JSON.stringify(query.select)).not.toMatch(/body|content|description/);
  });

  it("requires both submittedAt and finalBody for non-admin report queries", async () => {
    const database = db({ weeklyReport: [
      { id: "r-body-only", submittedAt: null, finalBody: "body" },
      { id: "r-submitted-only", submittedAt: "2026-01-01", finalBody: null },
      { id: "r-final", submittedAt: "2026-01-02", finalBody: "final" },
    ] });
    const result = await getAuthorizedEntityIds(actor("me"), ["REPORT"], undefined, database);
    expect(result.ids.REPORT).toEqual(["r-final"]);
    expect((database.weeklyReport as any).findMany.mock.calls[0][0].where).toEqual({ submittedAt: { not: null }, finalBody: { not: null } });
  });

  it("keeps source visibility predicates actor-aware for admin drafts and non-admin finalization", async () => {
    const database = db({ weeklyReport: [
      { id: "r-draft", submittedAt: null, finalBody: null },
      { id: "r-submitted-only", submittedAt: "2026-01-01", finalBody: null },
      { id: "r-final", submittedAt: "2026-01-02", finalBody: "final" },
    ] });
    await expect(assertSourceVisible(source("REPORT", "r-draft"), actor("admin", "ADMIN"), database)).resolves.toBeUndefined();
    await expect(assertSourceVisible(source("REPORT", "r-draft"), actor("me"), database)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(assertSourceVisible(source("REPORT", "r-submitted-only"), actor("me"), database)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(assertSourceVisible(source("REPORT", "r-final"), actor("me"), database)).resolves.toBeUndefined();
  });

  it("is bounded, cursorable, deterministic, and fails closed for inaccessible/absent sources", async () => {
    const database = db({ task: [{ id: "t-3", isPrivate: true, createdById: "me" }, { id: "t-1", isPrivate: true, createdById: "me" }, { id: "t-2", isPrivate: true, createdById: "me" }] });
    const first = await getAuthorizedEntityIds(actor("me"), ["TASK"], { limit: 2 }, database);
    expect(first.ids.TASK).toEqual(["t-1", "t-2"]);
    expect(first.truncated).toBe(true);
    expect(first.nextCursor).toBe("t-2");
    const second = await getAuthorizedEntityIds(actor("me"), ["TASK"], { limit: 2, cursor: first.nextCursor }, database);
    expect(second.ids.TASK).toEqual(["t-3"]);
    await expect(assertSourceVisible(source("TASK", "t-3"), actor("other"), database)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(assertSourceVisible(source("TASK", "missing"), actor("me"), database)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("uses only bounded, minimal typed projections and deduplicates types", async () => {
    const database = db({ task: [{ id: "t-1", isPrivate: false }] });
    await getAuthorizedEntityIds(actor("me"), ["TASK", "TASK"], { limit: 1 }, database);
    const query = (database.task as any).findMany.mock.calls[0][0];
    expect(query.take).toBe(2);
    expect(query.orderBy).toEqual({ id: "asc" });
    expect(query.select).toEqual(expect.objectContaining({ id: true, isPrivate: true, createdById: true }));
    expect(query.select).not.toEqual(expect.objectContaining({ task: true, project: true, linkedTask: true, linkedProject: true, linkedCaseStudy: true }));
    expect(JSON.stringify(query.select)).not.toMatch(/body|description|email|password|credential|rawContent/);
    expect(query.select.assignments).toEqual({ select: { userId: true } });
  });

  it("keeps independent continuation cursors for multiple types", async () => {
    const database = db({ task: [{ id: "t-1", isPrivate: false }, { id: "t-2", isPrivate: false }, { id: "t-3", isPrivate: false }], project: [{ id: "p-1", ownerId: "me", status: "Active" }, { id: "p-2", ownerId: "me", status: "Active" }] });
    const result = await getAuthorizedEntityIds(actor("me"), ["TASK", "PROJECT"], { limit: 1, cursorByType: { TASK: "t-1" } }, database);
    expect(result.ids.TASK).toEqual(["t-2"]);
    expect(result.ids.PROJECT).toEqual(["p-1"]);
    expect(result.nextCursorByType).toEqual({ TASK: "t-2", PROJECT: "p-1" });
    expect(result.nextCursor).toBeUndefined();
  });

  it("rejects malformed limits and reports missing model seams", async () => {
    await expect(getAuthorizedEntityIds(actor("me"), ["TASK"], { limit: 0 }, db({ task: [] }))).rejects.toMatchObject({ status: 400, code: "INVALID_LIMIT" });
    await expect(getAuthorizedEntityIds(actor("me"), ["TASK"], { limit: 1 }, {})).rejects.toMatchObject({ status: 503, code: "SCOPE_UNAVAILABLE" });
  });

  it("preserves floating/sponsor policy and department-less KPI denial", async () => {
    const database = db({ project: [{ id: "p-floating", ownerId: null, sponsorId: "other", status: "Active" }, { id: "p-sponsored", ownerId: "other", sponsorId: "me", status: "Active" }], caseStudy: [{ id: "c-floating", ownerId: null, status: "Open" }], kPI: [{ id: "k-shared", ownerId: null }] });
    expect((await getAuthorizedEntityIds(actor("me"), ["PROJECT", "CASE_STUDY"], {}, database)).ids.PROJECT).toEqual(["p-floating", "p-sponsored"]);
    expect((await getAuthorizedEntityIds(actor("me"), ["PROJECT", "CASE_STUDY"], {}, database)).ids.CASE_STUDY).toEqual(["c-floating"]);
    expect((await getAuthorizedEntityIds(actor("no-dept", "MEMBER", []), ["KPI"], {}, database)).ids.KPI).toEqual([]);
  });

  it("projects only real KPI and PMO policy fields", async () => {
    const database = db({ kPI: [{ id: "k-1", ownerId: null, status: "ON_TRACK", shared: true, visibility: "SHARED", departmentIds: ["d1"] }], externalAction: [{ id: "a-1", ownerId: "me", closedAt: null, createdById: "other", memberIds: ["other"], departmentIds: ["d1"] }] });
    await getAuthorizedEntityIds(actor("me"), ["KPI", "PMO_ACTION"], {}, database);
    const kpiSelect = (database.kPI as any).findMany.mock.calls[0][0].select;
    const pmoSelect = (database.externalAction as any).findMany.mock.calls[0][0].select;
    expect(kpiSelect).toEqual({ id: true, ownerId: true, status: true });
    expect(pmoSelect).toEqual({ id: true, ownerId: true, closedAt: true });
    for (const select of [kpiSelect, pmoSelect]) expect(JSON.stringify(select)).not.toMatch(/shared|visibility|departmentIds|createdById|memberIds|linkedEntityVisible/);
  });

  it("uses the real PMO owner policy for members, managers, and admins", async () => {
    const database = db({ externalAction: [{ id: "a-mine", ownerId: "me", closedAt: null }, { id: "a-other", ownerId: "other", closedAt: null }] });
    expect((await getAuthorizedEntityIds(actor("me", "MEMBER"), ["PMO_ACTION"], {}, database)).ids.PMO_ACTION).toEqual(["a-mine"]);
    expect((await getAuthorizedEntityIds(actor("manager", "LEAD"), ["PMO_ACTION"], {}, database)).ids.PMO_ACTION).toEqual(["a-mine", "a-other"]);
    expect((await getAuthorizedEntityIds(actor("manager", "ADMIN"), ["PMO_ACTION"], {}, database)).ids.PMO_ACTION).toEqual(["a-mine", "a-other"]);
  });

  it("denies notes and support requests linked to another user's private task", async () => {
    const privateTask = { id: "t-private", isPrivate: true, createdById: "other", assignments: [] };
    const database = db({ notePage: [{ id: "n-private", authorId: "me", isShared: true, linkedEntityVisible: true, task: privateTask }], supportRequest: [{ id: "s-private", requesterId: "me", task: privateTask }] });
    expect((await getAuthorizedEntityIds(actor("me"), ["NOTE", "SUPPORT_REQUEST"], {}, database)).ids.NOTE).toEqual([]);
    expect((await getAuthorizedEntityIds(actor("me"), ["NOTE", "SUPPORT_REQUEST"], {}, database)).ids.SUPPORT_REQUEST).toEqual([]);
    const noteSelect = (database.notePage as any).findMany.mock.calls[0][0].select;
    const supportSelect = (database.supportRequest as any).findMany.mock.calls[0][0].select;
    expect(JSON.stringify(noteSelect)).not.toContain("linkedEntityVisible");
    expect(JSON.stringify(supportSelect)).not.toContain("linkedEntityVisible");
  });
});
