import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), toSabahActor: vi.fn(), listKpisForActor: vi.fn() }));
const { auth, toSabahActor, listKpisForActor } = mocks;
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: mocks.toSabahActor }));
vi.mock("@/lib/kpis/commands", () => ({ listKpisForActor: mocks.listKpisForActor, createKpi: vi.fn() }));
vi.mock("@/lib/kpis/schemas", () => ({ createKpiSchema: { parse: vi.fn() } }));

import { GET } from "./route";

describe("GET /api/kpis error parity", () => {
  it("preserves command status, code, and error instead of forcing 500", async () => {
    auth.mockResolvedValue({ user: { id: "u1", role: "MEMBER" } });
    toSabahActor.mockResolvedValue({ id: "u1", role: "MEMBER", departmentIds: [] });
    listKpisForActor.mockRejectedValue(Object.assign(new Error("Actor has no department membership"), { status: 403, code: "FORBIDDEN" }));
    const response = await GET(new Request("http://localhost/api/kpis"));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Actor has no department membership", code: "FORBIDDEN" });
  });
});
