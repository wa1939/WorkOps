import { describe, expect, it, vi } from "vitest";
import { getNotificationForActor, listMine, markAllRead, markOwnRead, markRead, summarizeMine } from "./commands";

const actor = (id: string) => ({ id, role: "MEMBER" as const, departmentIds: [] });
function dbFor(rows: any[]) {
  const notifications = [...rows];
  const db: any = {
    notification: {
      findMany: vi.fn(async ({ where, take }: any) => notifications.filter((n) => n.userId === where.userId && (!where.id?.in || where.id.in.includes(n.id))).slice(0, take)),
      findUnique: vi.fn(async ({ where }: any) => notifications.find((n) => n.id === where.id)),
      update: vi.fn(async ({ where, data }: any) => { const row = notifications.find((n) => n.id === where.id); Object.assign(row, data); return { ...row }; }),
      updateMany: vi.fn(async ({ where, data }: any) => { const matching = notifications.filter((n) => n.userId === where.userId && (!where.id?.in || where.id.in.includes(n.id)) && !n.isRead); matching.forEach((n) => Object.assign(n, data)); return { count: matching.length }; }),
    },
    auditLog: { create: vi.fn() },
  };
  return db;
}

describe("notification commands", () => {
  it("lists only the actor's notifications with a bounded limit", async () => {
    const db = dbFor([{ id: "mine", userId: "me", isRead: false }, { id: "other", userId: "other", isRead: false }]);
    expect((await listMine({ limit: 999 }, actor("me"), db)).map((n: any) => n.id)).toEqual(["mine"]);
    expect(db.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "me" }, take: 50 }));
  });

  it("returns a bounded unread summary without marking anything read", async () => {
    const db = dbFor([{ id: "a", userId: "me", isRead: false }, { id: "b", userId: "me", isRead: true }]);
    await expect(summarizeMine(actor("me"), db)).resolves.toMatchObject({ unreadCount: 1 });
    expect(db.notification.updateMany).not.toHaveBeenCalled();
  });

  it("rejects another user's notification without leaking it", async () => {
    const db = dbFor([{ id: "n1", userId: "other", isRead: false }]);
    await expect(markRead("n1", actor("me"), db)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("marks only requested own notifications and rejects foreign ids", async () => {
    const db = dbFor([{ id: "mine", userId: "me", isRead: false }, { id: "other", userId: "other", isRead: false }]);
    await expect(markOwnRead("me", ["mine"], db)).resolves.toMatchObject({ count: 1 });
    expect(db.notification.updateMany).toHaveBeenCalledWith({ where: { userId: "me", id: { in: ["mine"] }, isRead: false }, data: { isRead: true } });

    const foreignDb = dbFor([{ id: "other", userId: "other", isRead: false }]);
    await expect(markOwnRead("me", ["other"], foreignDb)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(foreignDb.notification.updateMany).not.toHaveBeenCalled();
  });

  it("exposes a read-only self-only lookup for capability authorization", async () => {
    const db = dbFor([{ id: "n1", userId: "other", isRead: false }]);
    await expect(getNotificationForActor("n1", actor("me"), db)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it("makes mark-read and mark-all-read idempotent", async () => {
    const db = dbFor([{ id: "n1", userId: "me", isRead: true }]);
    await expect(markRead("n1", actor("me"), db)).resolves.toMatchObject({ id: "n1", isRead: true });
    await expect(markAllRead(actor("me"), db)).resolves.toMatchObject({ count: expect.any(Number) });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
