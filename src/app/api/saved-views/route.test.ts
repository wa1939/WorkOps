import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const createSavedView = vi.fn();
const listSavedViewsForActor = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));
vi.mock("@/lib/saved-views/commands", () => ({
  createSavedView: (...args: unknown[]) => createSavedView(...args),
  listSavedViewsForActor: (...args: unknown[]) => listSavedViewsForActor(...args),
  SavedViewCommandError: class SavedViewCommandError extends Error {
    constructor(message: string, public status: number, public code: string) { super(message); }
  },
}));

import { POST } from "./route";

const session = { user: { id: "user-1", role: "MEMBER", departmentIds: [] } };
const request = (body: unknown) => new Request("http://localhost/api/saved-views", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("POST /api/saved-views compatibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("defaults omitted scope to TEAM for the existing create UI payload", async () => {
    auth.mockResolvedValue(session);
    createSavedView.mockResolvedValue({ id: "view-1", scope: "TEAM" });
    const response = await POST(request({ name: "Dashboard", blocksJson: "[]" }));
    expect(response.status).toBe(201);
    expect(createSavedView).toHaveBeenCalledWith(expect.objectContaining({ scope: "TEAM" }), expect.anything());
  });
});
