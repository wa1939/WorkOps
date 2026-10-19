import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listMine: vi.fn(),
  markOwnRead: vi.fn(),
  NotificationCommandError: class NotificationCommandError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) { super(message); }
  },
}));

vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock("@/lib/notifications/commands", () => ({
  listMine: (...args: unknown[]) => mocks.listMine(...args),
  markOwnRead: (...args: unknown[]) => mocks.markOwnRead(...args),
  NotificationCommandError: mocks.NotificationCommandError,
}));

import { GET, PATCH, PUT } from "./route";

describe("/api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "u1", role: "MEMBER", departmentIds: [] } });
  });

  it("rejects a non-numeric limit with a stable 400 instead of passing NaN", async () => {
    const response = await GET(new Request("http://localhost/api/notifications?limit=not-a-number"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_LIMIT" });
    expect(mocks.listMine).not.toHaveBeenCalled();
  });

  it("other users notifications forbidden", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-b", role: "MEMBER", departmentIds: [] } });
    mocks.listMine.mockResolvedValue([]);
    mocks.markOwnRead.mockRejectedValue(new mocks.NotificationCommandError("Notification not found", 404, "NOT_FOUND"));

    const getResponse = await GET(new Request("http://localhost/api/notifications"));
    const body = JSON.stringify({ userId: "user-a", ids: ["notification-owned-by-a"] });
    const patchResponse = await PATCH(new Request("http://localhost/api/notifications", { method: "PATCH", body }));
    const putResponse = await PUT(new Request("http://localhost/api/notifications", { method: "PUT", body }));

    expect(getResponse.status).toBe(200);
    expect(mocks.listMine).toHaveBeenCalledWith({ limit: undefined }, { id: "user-b", role: "MEMBER", departmentIds: [] });
    expect(patchResponse.status).toBe(404);
    expect(putResponse.status).toBe(404);
    expect(mocks.markOwnRead).toHaveBeenNthCalledWith(1, "user-b", ["notification-owned-by-a"]);
    expect(mocks.markOwnRead).toHaveBeenNthCalledWith(2, "user-b", ["notification-owned-by-a"]);
  });
});
