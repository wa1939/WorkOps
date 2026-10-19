import { describe, expect, it, vi } from "vitest";
import { executeDraftPmoFollowUp, executeGetPmoAction, executeListPmoActions, mapDueBucket, compactPmoRow, canSeeAction } from "./pmo-executors";
import type { PmoActor } from "@/lib/pmo/authorization";
import type { PmoActionRow } from "@/lib/pmo/portfolio-query";

const mocks = vi.hoisted(() => ({
  resolvePmoActor: vi.fn(), loadPmoPortfolio: vi.fn(), readPmoActionForActor: vi.fn(), generatePmoDraft: vi.fn(),
}));
vi.mock("@/lib/pmo/actor", () => ({ resolvePmoActor: mocks.resolvePmoActor }));
vi.mock("@/lib/pmo/portfolio-query", () => ({ loadPmoPortfolio: mocks.loadPmoPortfolio }));
vi.mock("@/lib/sabah/capabilities/modules/pmo", () => ({ readPmoActionForActor: mocks.readPmoActionForActor, generatePmoDraft: mocks.generatePmoDraft }));

describe("mapDueBucket", () => {
  it("maps friendly values to the parser enum", () => { expect(mapDueBucket("overdue")).toBe("OVERDUE"); expect(mapDueBucket("OVERDUE")).toBe("OVERDUE"); expect(mapDueBucket("due7")).toBe("DUE_7"); expect(mapDueBucket("dueSoon")).toBe("DUE_7"); expect(mapDueBucket("due30")).toBe("DUE_30"); });
  it("returns undefined for unknown/empty", () => { expect(mapDueBucket()).toBeUndefined(); expect(mapDueBucket("nonsense")).toBeUndefined(); });
});

describe("compactPmoRow", () => {
  it("drops contact email/department and evidence (PII minimization)", () => {
    const row = { id: "t1", title: "Action", description: "d", status: "DOING", priority: "HIGH", dueDate: "2026-08-01", dueBucket: "OVERDUE", workAreaName: "WA", parentType: "Project", parentName: "P", ownerName: "Owner", ownerId: "u1", contactName: "Contact", contactId: "c1", contactEmail: "secret@x.com", contactDepartment: "Dept", contactOrganization: "Org", evidence: [{ label: "e", url: "u" }], lastResponseAt: null, lastFollowUpAt: null, nextReminder: null, closedAt: null, closureNote: "" } as PmoActionRow;
    const out = compactPmoRow(row) as Record<string, unknown>; expect(out).not.toHaveProperty("contactEmail"); expect(out).not.toHaveProperty("contactDepartment"); expect(out).not.toHaveProperty("evidence"); expect(out.contactOrganization).toBe("Org"); expect(out.id).toBe("t1");
  });
});

describe("canSeeAction", () => {
  const manager: PmoActor = { id: "m1", role: "MANAGER" as PmoActor["role"] }; const member: PmoActor = { id: "u1", role: "MEMBER" as PmoActor["role"] };
  it("managers see any action", () => { expect(canSeeAction(manager, "someone-else")).toBe(true); });
  it("members see only their own", () => { expect(canSeeAction(member, "u1")).toBe(true); expect(canSeeAction(member, "u2")).toBe(false); });
});

describe("legacy PMO executors", () => {
  const ctx = { userId: "u1" } as any;
  it("delegates list to the shared portfolio adapter and preserves legacy response shape", async () => {
    mocks.resolvePmoActor.mockResolvedValue({ id: "u1", role: "MEMBER" });
    mocks.loadPmoPortfolio.mockResolvedValue({ rows: [{ id: "t1", title: "Action", status: "WAITING", dueDate: "2026-08-01", dueBucket: "DUE_7", ownerName: "Owner", contactName: "Contact", contactOrganization: "Org", workAreaName: "Area", parentName: "Parent", lastFollowUpAt: null, nextReminder: null }], metrics: { total: 1 }, options: { workAreas: [] } });
    const result = await executeListPmoActions({ limit: 10 }, ctx);
    expect(result).toEqual({ ok: true, data: expect.objectContaining({ total: 1, shown: 1, actions: [{ id: "t1", title: "Action", status: "WAITING", dueDate: "2026-08-01", dueBucket: "DUE_7", ownerName: "Owner", contactName: "Contact", contactOrganization: "Org", workAreaName: "Area", parentName: "Parent", lastFollowUpAt: null, nextReminder: null }] }) });
    expect(mocks.loadPmoPortfolio).toHaveBeenCalledOnce();
  });
  it("delegates get and retains the legacy projection shape", async () => {
    mocks.resolvePmoActor.mockResolvedValue({ id: "u1", role: "MEMBER" });
    mocks.readPmoActionForActor.mockResolvedValue({ id: "t1", title: "Action", description: null, status: "WAITING", dueAt: new Date("2026-08-01T00:00:00.000Z"), externalAction: { owner: { name: "Owner" }, externalContact: { name: "Contact", email: "contact@example.com", department: null, organization: null }, evidence: [{ label: "Proof", url: "https://proof.example" }], followUpEvents: [], lastExternalResponseAt: null, closedAt: null, closureNote: null } });
    await expect(executeGetPmoAction({ taskId: "t1" }, ctx)).resolves.toEqual({ ok: true, data: expect.objectContaining({ id: "t1", owner: "Owner", contact: expect.objectContaining({ email: "contact@example.com", department: "", organization: "" }), evidence: [{ label: "Proof", url: "https://proof.example" }], followUps: [] }) });
  });
  it("delegates draft generation and never sends email", async () => {
    mocks.resolvePmoActor.mockResolvedValue({ id: "u1", role: "MEMBER" }); mocks.generatePmoDraft.mockResolvedValue({ subject: "Subject", body: "Body", recipient: "contact@example.com" });
    const result = await executeDraftPmoFollowUp({ taskId: "t1" }, ctx);
    expect(result).toEqual({ ok: true, data: expect.objectContaining({ subject: "Subject", body: "Body", recipient: "contact@example.com", note: expect.stringMatching(/cannot send emails/) }) });
    expect(mocks.generatePmoDraft).toHaveBeenCalledWith("t1", { id: "u1", role: "MEMBER" });
  });
});
