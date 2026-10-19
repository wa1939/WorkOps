import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { CapabilityRegistry } from "../registry";
import { registerSavedViewCapabilities } from "./saved-views";
import { registerNotificationCapabilities } from "./notifications";
import { savedViewsUpdateCapability, savedViewsVoteCapability } from "./saved-views";
import { notificationsMarkReadCapability } from "./notifications";

vi.mock("@/lib/saved-views/commands", () => ({
  createSavedView: vi.fn(), listSavedViewsForActor: vi.fn(), updateSavedView: vi.fn(), voteSavedView: vi.fn(),
  getSavedViewForActor: vi.fn(async (id: string) => { if (id === "mine-view") return { id, name: "Mine", scope: "PERSONAL", ownerId: "me", updatedAt: new Date() }; throw Object.assign(new Error("Saved view not found"), { code: "NOT_FOUND" }); }),
}));
vi.mock("@/lib/notifications/commands", () => ({
  listMine: vi.fn(), markAllRead: vi.fn(), markRead: vi.fn(), summarizeMine: vi.fn(),
  getNotificationForActor: vi.fn(async (id: string, actor: any) => { if (id === "mine-notification" && actor.id === "me") return { id, userId: actor.id }; throw Object.assign(new Error("Notification not found"), { code: "NOT_FOUND" }); }),
}));

describe("personal tool capabilities", () => {
  it("registers exactly the approved saved-view and notification surface", () => {
    const registry = new CapabilityRegistry();
    registerSavedViewCapabilities(registry);
    registerNotificationCapabilities(registry);
    expect(["savedViews.search", "savedViews.create", "savedViews.update", "savedViews.vote", "notifications.listMine", "notifications.markRead", "notifications.markAllRead", "notifications.summarize"].every((name) => { try { registry.resolve(name); return true; } catch { return false; } })).toBe(true);
    expect(() => registry.resolve("savedViews.delete")).toThrow();
    expect(() => registry.resolve("notifications.send")).toThrow();
  });

  it("requires explicit approval for saved-view writes and exposes typed form fields", () => {
    const registry = new CapabilityRegistry();
    registerSavedViewCapabilities(registry);
    const create = registry.resolve("savedViews.create") as any;
    expect(create.requiresExplicitApproval).toBe(true);
    expect(create.inputSchema.safeParse({ name: "Ops", scope: "PERSONAL", blocksJson: "[]" }).success).toBe(true);
    expect(create.inputSchema.safeParse({ name: "Ops", scope: "PERSONAL", blocksJson: '{"blocks":[{"id":"x","type":"bad"}]}' }).success).toBe(false);
  });

  it("marks notification summary as a read-only capability", () => {
    const registry = new CapabilityRegistry();
    registerNotificationCapabilities(registry);
    expect((registry.resolve("notifications.summarize") as any).risk).toBe("READ");
  });

  it("fails closed for foreign saved views and notifications before preview/execute", async () => {
    const context: any = { actor: { id: "me", role: "MEMBER", departmentIds: [] }, requestId: "r", now: new Date() };
    await expect(savedViewsUpdateCapability.authorize({ id: "foreign-view", expectedUpdatedAt: new Date().toISOString() } as any, context)).rejects.toBeDefined();
    await expect(savedViewsVoteCapability.authorize({ id: "foreign-view" }, context)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(savedViewsVoteCapability.preview({ id: "foreign-view" }, context)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(notificationsMarkReadCapability.authorize({ id: "foreign-notification" }, context)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
