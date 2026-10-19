import { describe, expect, it, vi } from "vitest";
import { createKpi, getKpiForActor, linkProjectObjective, listKpisForActor, logKpiUpdate, updateKpi } from "./commands";
import { KpiCommandError } from "./authorization";

const actor = { id: "u1", role: "MEMBER" as const, departmentIds: ["d1"] };
const viewer = { id: "u2", role: "VIEWER" as const, departmentIds: ["d1"] };
const noDepartments = { id: "u3", role: "MEMBER" as const, departmentIds: [] };
const adminNoDepartments = { id: "admin", role: "ADMIN" as const, departmentIds: [] };
const version = new Date("2026-08-25T00:00:00.000Z");
const kpi = { id: "k1", name: "Revenue", updatedAt: version, annualTarget: 100, q1Target: 100, q2Target: null, q3Target: null, q4Target: null, level1: 40, level2: 60, level3: 80, level4: 100, level5: 120 };
function db() {
  return {
    kPI: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn() },
    kPIUpdate: { create: vi.fn() },
    projectObjective: { findUnique: vi.fn(), update: vi.fn() },
    project: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  } as any;
}

describe("KPI commands privacy, references, and history", () => {
  it("passes actor visibility policy to list and get and does not expose history in list", async () => {
    const client = db(); client.kPI.findMany.mockResolvedValue([{ id: "k1", updates: [{ id: "u" }] }]); client.kPI.findUnique.mockResolvedValue(kpi);
    await listKpisForActor({}, actor, client); await getKpiForActor("k1", actor, client);
    expect(client.kPI.findMany.mock.calls[0][0].where).toMatchObject({});
    expect(client.kPI.findMany.mock.calls[0][0].include.updates).toMatchObject({ take: 1 });
    expect(client.kPI.findUnique.mock.calls[0][0].where).toMatchObject({ id: "k1" });
  });

  it("rejects an unauthorized KPI read without leaking the record", async () => {
    const client = db(); client.kPI.findUnique.mockResolvedValue(null);
    await expect(getKpiForActor("secret", { ...viewer, id: "" }, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(client.kPI.findUnique).not.toHaveBeenCalled();
  });

  it("requires department membership for non-admin reads without leaking existence", async () => {
    const client = db();
    await expect(listKpisForActor({}, noDepartments, client)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(getKpiForActor("secret", noDepartments, client)).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(client.kPI.findMany).not.toHaveBeenCalled();
    expect(client.kPI.findUnique).not.toHaveBeenCalled();
    client.kPI.findMany.mockResolvedValue([]);
    await expect(listKpisForActor({}, adminNoDepartments, client)).resolves.toEqual([]);
  });

  it("blocks viewer writes and stale edits before mutation", async () => {
    const client = db();
    await expect(updateKpi("k1", { name: "Changed", expectedUpdatedAt: version.toISOString() }, viewer, undefined, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    client.kPI.findUnique.mockResolvedValue(kpi);
    await expect(updateKpi("k1", { name: "Changed", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" }, actor, undefined, client)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(client.kPI.update).not.toHaveBeenCalled();
  });

  it("uses an atomic expected-version predicate for edits", async () => {
    const client = db();
    client.kPI.findUnique.mockResolvedValue(kpi);
    client.kPI.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    client.kPI.findUnique.mockResolvedValueOnce(kpi).mockResolvedValueOnce({ ...kpi, name: "Changed", updates: [], tasks: [], projectObjectives: [] });
    await updateKpi("k1", { name: "Changed", expectedUpdatedAt: version.toISOString() }, actor, undefined, client);
    expect(client.kPI.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "k1", updatedAt: version }) }));
    expect(client.kPI.update).not.toHaveBeenCalled();
  });

  it("rejects stale logging before any write and preserves threshold scoring/history", async () => {
    const client = db(); client.kPI.findUnique.mockResolvedValue(kpi);
    await expect(logKpiUpdate("k1", { value: 100, period: "Q1", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" }, actor, client)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(client.kPIUpdate.create).not.toHaveBeenCalled(); expect(client.kPI.update).not.toHaveBeenCalled();
    client.kPI.findUnique.mockResolvedValue({ ...kpi, updatedAt: version }); client.kPIUpdate.create.mockResolvedValue({ id: "up1", score: 4 }); client.kPI.update.mockResolvedValue({}); client.kPI.findUnique.mockResolvedValueOnce(kpi).mockResolvedValueOnce({ ...kpi, updates: [] });
    await logKpiUpdate("k1", { value: 100, period: "Q1", expectedUpdatedAt: version.toISOString() }, actor, client);
    expect(client.kPIUpdate.create.mock.calls[0][0].data.score).toBe(4);
    expect(client.auditLog.create).toHaveBeenCalled();
  });

  it("claims the KPI version atomically before logging dependent history", async () => {
    const client = db(); client.kPI.findUnique.mockResolvedValue(kpi);
    client.kPI.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    client.kPIUpdate.create.mockResolvedValue({ id: "up1", score: 4 }); client.kPI.update.mockResolvedValue({});
    client.kPI.findUnique.mockResolvedValueOnce(kpi).mockResolvedValueOnce({ ...kpi, updates: [] });
    await logKpiUpdate("k1", { value: 100, period: "Q1", expectedUpdatedAt: version.toISOString() }, actor, client);
    expect(client.kPI.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "k1", updatedAt: version }) }));
    expect(client.kPIUpdate.create).toHaveBeenCalled();
  });

  it("validates objective belongs to project and checks both references before relation-only update", async () => {
    const client = db(); client.kPI.findUnique.mockResolvedValue({ id: "k1", updatedAt: version }); client.projectObjective.findUnique.mockResolvedValue({ id: "o1", projectId: "p1" }); client.project.findUnique.mockResolvedValue(null);
    await expect(linkProjectObjective({ kpiId: "k1", projectObjectiveId: "o1", expectedUpdatedAt: version.toISOString() }, actor, client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(client.projectObjective.update).not.toHaveBeenCalled();
  });

  it("audits create and reads back the canonical department-level record", async () => {
    const client = db();
    client.kPI.create.mockResolvedValue({ id: "k2" });
    client.kPI.findUnique.mockResolvedValue({ id: "k2", ownerId: null, name: "New", updates: [], tasks: [], projectObjectives: [] });
    const result = await createKpi({ perspective: "P", objective: "O", name: "New", ownerId: null }, actor, client);
    expect(result.ownerId).toBeNull();
    expect(client.kPI.create.mock.calls[0][0].data.ownerId).toBeNull();
    expect(client.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "created", actorId: actor.id }) }));
  });
});
