import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const updateSavedView = vi.fn();
const getSavedViewForActor = vi.fn();
const prisma = vi.hoisted(() => ({ savedView: { findUnique: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/saved-views/commands", () => ({
  updateSavedView: (...args: unknown[]) => updateSavedView(...args),
  getSavedViewForActor: (...args: unknown[]) => getSavedViewForActor(...args),
  SavedViewCommandError: class SavedViewCommandError extends Error {
    constructor(message: string, public status: number, public code: string) { super(message); }
  },
}));

import { GET, PATCH } from "./route";

const session = { user: { id: "owner-1", role: "MEMBER", departmentIds: [] } };
const params = Promise.resolve({ id: "view-1" });
const request = (body: unknown) => new Request("http://localhost/api/saved-views/view-1", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("/api/saved-views/[id] compatibility", () => {
  beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue(session); });

  it("adapts the editor's legacy blocks-only PATCH with the current version", async () => {
    const updatedAt = new Date("2026-08-26T12:00:00.000Z");
    prisma.savedView.findUnique.mockResolvedValue({ id: "view-1", updatedAt });
    updateSavedView.mockResolvedValue({ id: "view-1", blocksJson: "[]" });
    const response = await PATCH(request({ blocksJson: "[]" }), { params });
    expect(response.status).toBe(200);
    expect(updateSavedView).toHaveBeenCalledWith("view-1", expect.objectContaining({
      blocksJson: "[]", expectedUpdatedAt: updatedAt.toISOString(),
    }), expect.anything());
  });

  it("maps stale command failures to stable VERSION_CONFLICT/409", async () => {
    const error = new Error("stale");
    Object.assign(error, { status: 409, code: "VERSION_CONFLICT" });
    updateSavedView.mockRejectedValue(error);
    const response = await PATCH(request({ blocksJson: "[]", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }), { params });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(prisma.savedView.findUnique).not.toHaveBeenCalled();
  });

  it("returns a safe GET projection without voter IDs", async () => {
    getSavedViewForActor.mockResolvedValue({ id: "view-1", votes: [], voteCount: 2, hasVoted: true });
    const response = await GET(new Request("http://localhost/api/saved-views/view-1"), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ voteCount: 2, hasVoted: true });
    expect(JSON.stringify(body)).not.toContain("userId");
  });
});
