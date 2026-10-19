import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCaseStudy, getCaseStudyForActor, planCaseStudyTasks, updateCaseStudy } from "./commands";
import { visibleCaseStudyWhere } from "./authorization";
import type { SabahActor } from "@/lib/sabah/auth/actor";

const owner: SabahActor = { id: "u1", role: "MEMBER", departmentIds: ["d1"] };
const member: SabahActor = { id: "u2", role: "MEMBER", departmentIds: [] };
const admin: SabahActor = { id: "admin", role: "ADMIN", departmentIds: [] };
const viewer: SabahActor = { id: "viewer", role: "VIEWER", departmentIds: [] };
const version = new Date("2026-08-24T00:00:00.000Z");

function db() {
  const row: any = { id: "cs1", name: "Study", brief: "Brief", status: "Open", ownerId: "u1", updatedAt: version, dueAt: null, dueAtEnd: null, workAreaId: null, members: [], departments: [], workArea: null, tasks: [], links: [], notes: [] };
  const mock: any = {
    $transaction: vi.fn(async (fn: any) => fn(mock)),
    user: { findMany: vi.fn(async ({ where }: any) => (where.id?.in ?? []).map((id: string) => ({ id }))) },
    department: { findMany: vi.fn(async ({ where }: any) => (where.id?.in ?? []).map((id: string) => ({ id }))) },
    workArea: { findFirst: vi.fn(async ({ where }: any) => where.isArchived === false ? { id: where.id } : null) },
    task: { count: vi.fn().mockResolvedValue(0) },
    auditLog: { create: vi.fn() },
    caseStudyMember: {
      deleteMany: vi.fn(async () => { row.members = []; }),
      createMany: vi.fn(async ({ data }: any) => { row.members = data.map((m: any) => ({ userId: m.userId })); }),
    },
    caseStudyDepartment: {
      deleteMany: vi.fn(async () => { row.departments = []; }),
      createMany: vi.fn(async ({ data }: any) => { row.departments = data.map((d: any) => ({ departmentId: d.departmentId })); }),
    },
    caseStudy: {
      findUnique: vi.fn(async () => row),
      findFirst: vi.fn(async () => row),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "cs1" }),
      update: vi.fn(async ({ data }: any) => { Object.assign(row, data); row.updatedAt = new Date(row.updatedAt.getTime() + 1000); return { id: row.id }; }),
    },
  };
  return mock;
}

describe("case study commands", () => {
  it("scopes visibility to actor and active work areas", () => {
    const where: any = visibleCaseStudyWhere(owner);
    expect(where.AND).toEqual(expect.arrayContaining([{ OR: [{ workAreaId: null }, { workArea: { isArchived: false } }] }]));
    expect(where.AND[1].OR).toEqual(expect.arrayContaining([{ ownerId: "u1" }, { ownerId: null }, { members: { some: { userId: "u1" } } }]));
  });

  it("returns safe 404 for inaccessible records", async () => {
    const client = db(); client.caseStudy.findFirst.mockResolvedValue(null);
    await expect(getCaseStudyForActor("private", member, client)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("denies VIEWER create without writing", async () => {
    const client = db();
    await expect(createCaseStudy({ name: "Nope" }, viewer, client)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(client.caseStudy.create).not.toHaveBeenCalled();
  });

  it("defaults omitted owner to actor but preserves explicit floating null and dueAt null", async () => {
    const client = db();
    await createCaseStudy({ name: "Owned" }, owner, client);
    expect(client.caseStudy.create.mock.calls[0][0].data.ownerId).toBe("u1");
    await createCaseStudy({ name: "Floating", ownerId: null, dueAt: null }, owner, client);
    expect(client.caseStudy.create.mock.calls[1][0].data).toMatchObject({ ownerId: null, dueAt: null });
    expect(client.auditLog.create).toHaveBeenCalled();
    expect(client.caseStudy.findFirst).toHaveBeenCalled();
  });

  it("rejects archived work areas and unresolved references", async () => {
    const client = db(); client.workArea.findFirst.mockResolvedValue(null);
    await expect(createCaseStudy({ name: "Bad", workAreaId: "archived" }, owner, client)).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
    client.workArea.findFirst.mockResolvedValue({ id: "wa1" }); client.user.findMany.mockResolvedValue([]);
    await expect(createCaseStudy({ name: "Bad", memberIds: ["missing"] }, owner, client)).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });

  it.each([["owner", owner], ["member", member], ["admin", admin]])("allows %s update", async (_label, actor) => {
    const client = db();
    if (actor.id === "u2") client.caseStudy.findUnique.mockResolvedValue({ ...client.caseStudy.findUnique.getMockImplementation?.(), ownerId: "someone", members: [{ userId: "u2" }], updatedAt: version });
    await updateCaseStudy("cs1", { name: "Changed" }, actor, version, client);
    expect(client.caseStudy.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cs1", updatedAt: version } }));
  });

  it("reads back material owner/member/admin update fields with null owner and due date", async () => {
    const client = db();
    const input = { name: "Changed", brief: "Updated brief", dueAt: "2026-09-01T12:00:00.000Z", dueAtEnd: null, ownerId: null, workAreaId: "wa1", departmentIds: ["d2"], memberIds: ["u2"] };
    const result = await updateCaseStudy("cs1", input, owner, version, client);
    expect(result).toMatchObject({ name: "Changed", brief: "Updated brief", ownerId: null, workAreaId: "wa1", departments: [{ departmentId: "d2" }], members: [{ userId: "u2" }] });
    expect(result.dueAt).toEqual(new Date(input.dueAt));
    expect(result.dueAtEnd).toBeNull();
    expect(client.caseStudy.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ dueAt: new Date(input.dueAt), dueAtEnd: null, ownerId: null, workAreaId: "wa1" }) }));
  });

  it("denies capability update for a non-owner non-member while allowing owner/member/Admin", async () => {
    const client = db();
    await expect(updateCaseStudy("cs1", { name: "No" }, member, version, client)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(client.caseStudy.update).not.toHaveBeenCalled();
  });

  it("rejects stale owner update without writing", async () => {
    const client = db();
    await expect(updateCaseStudy("cs1", { name: "Stale" }, owner, new Date("2025-01-01"), client)).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(client.caseStudy.update).not.toHaveBeenCalled();
  });

  it("blocks clearing work area when external actions are attached", async () => {
    const client = db(); client.task.count.mockResolvedValue(1);
    await expect(updateCaseStudy("cs1", { workAreaId: null }, owner, version, client)).rejects.toMatchObject({ status: 409, code: "WORK_AREA_REQUIRED" });
    expect(client.caseStudy.update).not.toHaveBeenCalled();
  });

  it("plans tasks as tasks.create proposals and performs no task write", async () => {
    const client = db();
    const result = await planCaseStudyTasks({ caseStudyId: "cs1", tasks: [{ title: "Follow up" }], allowPartial: false }, owner, client);
    expect(result).toMatchObject({ caseStudyId: "cs1", proposed: true, steps: [{ capability: "tasks.create" }] });
    expect(client.task.count).not.toHaveBeenCalled();
    expect(client.caseStudy.update).not.toHaveBeenCalled();
  });
});
