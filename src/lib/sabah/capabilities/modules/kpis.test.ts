import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/kpis/commands", () => ({ listKpisForActor: vi.fn(), getKpiForActor: vi.fn().mockResolvedValue({ id: "k1", name: "Revenue" }), createKpi: vi.fn(), updateKpi: vi.fn(), logKpiUpdate: vi.fn(), linkProjectObjective: vi.fn() }));
import { kpisCreateCapability, kpisGetCapability, kpisLogUpdateCapability, kpisSearchCapability, kpisUpdateCapability, registerKpiCapabilities } from "./kpis";
const member = { id: "u1", role: "MEMBER" as const, departmentIds: ["d1"] };
const viewer = { id: "u2", role: "VIEWER" as const, departmentIds: ["d1"] };
const context = (actor: typeof member | typeof viewer = member) => ({ actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() });
describe("KPI capabilities", () => {
  it("registers exact names and no delete", () => { const register = vi.fn(); registerKpiCapabilities({ register } as any); expect(register.mock.calls.map(([x]) => x.name)).toEqual(["kpis.search", "kpis.get", "kpis.create", "kpis.update", "kpis.logUpdate", "kpis.linkProjectObjective"]); });
  it("allows reads for viewers but rejects writes in authorize", async () => { await expect(kpisSearchCapability.authorize({ query: "" }, context(viewer))).resolves.toBeUndefined(); await expect(kpisGetCapability.authorize({ id: "k1" }, context(viewer))).resolves.toBeUndefined(); await expect(kpisCreateCapability.authorize({ perspective: "P", objective: "O", name: "N", ownerId: null }, context(viewer))).rejects.toMatchObject({ status: 403 }); });
  it("requires explicit approval for logging even in Fast and previews current/proposed values", async () => { const c = context(); (c as any).approvalMode = "FAST"; await expect(kpisLogUpdateCapability.authorize({ id: "k1", value: 90, period: "Q1", expectedUpdatedAt: new Date().toISOString() }, c as any)).resolves.toBeUndefined(); expect(kpisLogUpdateCapability.requiresExplicitApproval).toBe(true); const preview = await kpisUpdateCapability.preview({ id: "k1", name: "New", expectedUpdatedAt: new Date().toISOString() }, c); expect(preview.fields[0]).toMatchObject({ path: "name", proposed: "New" }); });
});
