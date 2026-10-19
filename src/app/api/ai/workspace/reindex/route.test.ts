import { describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => vi.fn());
const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth }));
const findUser = vi.hoisted(() => vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, role: where.id === "admin" ? "ADMIN" : "MEMBER", isActive: true, departments: [] })));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: findUser } } }));
vi.mock("@/lib/sabah/intelligence/indexer", () => ({ reconcileEntityBatch: reconcile }));
import { POST } from "./route";
const request = (body: unknown) => new Request("http://localhost/api/ai/workspace/reindex", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
describe("workspace reindex route", () => {
  it("denies non-admins", async () => { auth.mockResolvedValue({ user: { id: "member", role: "MEMBER" } }); expect((await POST(request({ entityTypes: ["PROJECT"], limit: 1 }))).status).toBe(403); });
  it("rejects a stale admin JWT when the persisted role was demoted", async () => { auth.mockResolvedValue({ user: { id: "demoted", role: "ADMIN" } }); expect((await POST(request({ entityTypes: ["PROJECT"], limit: 1 }))).status).toBe(403); });
  it("returns 401 without a session", async () => { auth.mockResolvedValue(null); expect((await POST(request({ entityTypes: ["PROJECT"], limit: 1 }))).status).toBe(401); });
  it("rejects malformed JSON, invalid and duplicate entity types", async () => {
    auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } });
    expect((await POST(new Request("http://localhost/api/ai/workspace/reindex", { method: "POST", body: "{", headers: { "content-type": "application/json" } }))).status).toBe(400);
    expect((await POST(request({ entityTypes: ["BOGUS"], limit: 1 }))).status).toBe(400);
    expect((await POST(request({ entityTypes: ["PROJECT", "PROJECT"], limit: 1 }))).status).toBe(400);
  });
  it("rejects invalid cursor and limit", async () => { auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); expect((await POST(request({ entityTypes: ["PROJECT"], cursor: "x".repeat(257), limit: 1 }))).status).toBe(400); expect((await POST(request({ entityTypes: ["PROJECT"], limit: 0 }))).status).toBe(400); });
  it("returns safe 500 when reconciliation fails", async () => { auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); reconcile.mockRejectedValue(new Error("private body must not leak")); const response = await POST(request({ entityTypes: ["PROJECT"], limit: 1 })); expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "Failed to reindex workspace" }); });
  it("passes bounded inputs and returns the batch cursor", async () => { auth.mockResolvedValue({ user: { id: "admin", role: "ADMIN" } }); reconcile.mockResolvedValue({ count: 2, nextCursor: "fp2" }); const response = await POST(request({ entityTypes: ["PROJECT"], cursor: "fp0", limit: 2 })); expect(response.status).toBe(200); expect(await response.json()).toEqual({ count: 2, nextCursor: "fp2" }); expect(reconcile).toHaveBeenCalledWith("fp0", 2, expect.anything(), expect.objectContaining({ entityTypes: ["PROJECT"] })); });
});
