import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  toSabahActor: vi.fn(),
  approveReportStyleMemo: vi.fn(),
  rejectReportStyleMemo: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/sabah/auth/actor", () => ({ toSabahActor: mocks.toSabahActor }));
vi.mock("@/lib/reports/history", () => ({
  approveReportStyleMemo: mocks.approveReportStyleMemo,
  rejectReportStyleMemo: mocks.rejectReportStyleMemo,
}));

import { POST } from "./route";

const actor = { id: "actor-1", role: "ADMIN", departmentIds: [] };
const params = { params: Promise.resolve({ id: "proposal-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "actor-1", role: "ADMIN" } });
  mocks.toSabahActor.mockResolvedValue(actor);
  mocks.approveReportStyleMemo.mockResolvedValue({ learned: true, memoryId: "proposal-1", auditId: "audit-1", supersededCount: 0, disabled: false });
  mocks.rejectReportStyleMemo.mockResolvedValue({ learned: false, memoryId: "proposal-1", auditId: "audit-2", supersededCount: 0, disabled: false });
});

describe("POST /api/reports/lessons/[id]/decision", () => {
  it("accepts an explicit approval decision", async () => {
    const response = await POST(new Request("http://localhost/api/reports/lessons/proposal-1/decision", { method: "POST", body: JSON.stringify({ approved: true, reason: "Reviewed" }) }), params);

    expect(response.status).toBe(200);
    expect(mocks.approveReportStyleMemo).toHaveBeenCalledWith({ memoryId: "proposal-1", ownerId: "actor-1", reason: "Reviewed" });
    expect(mocks.rejectReportStyleMemo).not.toHaveBeenCalled();
  });

  it("accepts an explicit rejection decision", async () => {
    const response = await POST(new Request("http://localhost/api/reports/lessons/proposal-1/decision", { method: "POST", body: JSON.stringify({ approved: false, reason: "Not representative" }) }), params);

    expect(response.status).toBe(200);
    expect(mocks.rejectReportStyleMemo).toHaveBeenCalledWith({ memoryId: "proposal-1", ownerId: "actor-1", reason: "Not representative" });
    expect(mocks.approveReportStyleMemo).not.toHaveBeenCalled();
  });
});
