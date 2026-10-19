import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/capabilities/contracts";

export class NotificationCommandError extends Error { constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = "NotificationCommandError"; } }
function notFound(): never { throw new NotificationCommandError("Notification not found", 404, "NOT_FOUND"); }
function selfOnly(row: any, actor: SabahActor): any { if (!row || row.userId !== actor.id) notFound(); return row; }

/** Read-only self-scoped lookup for capability authorization and previews. */
export async function getNotificationForActor(id: string, actor: SabahActor, db: any = prisma) {
  return selfOnly(await db.notification.findUnique({ where: { id } }), actor);
}

export async function listMine(input: { limit?: number } = {}, actor: SabahActor, db: any = prisma) {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 50);
  return db.notification.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function summarizeMine(actor: SabahActor, db: any = prisma) {
  const notifications = await listMine({ limit: 50 }, actor, db);
  return { unreadCount: notifications.filter((notification: any) => !notification.isRead).length, totalCount: notifications.length, items: notifications.slice(0, 5) };
}

export async function markRead(id: string, actor: SabahActor, db: any = prisma) {
  const current = await getNotificationForActor(id, actor, db);
  if (current.isRead) return current;
  const updated = await db.notification.update({ where: { id, userId: actor.id }, data: { isRead: true } });
  await db.auditLog?.create?.({ data: { entityType: "notification", entityId: id, action: "marked_read", actorId: actor.id } });
  return selfOnly(await db.notification.findUnique({ where: { id } }) ?? updated, actor);
}

/** Mark one or more notifications read without ever accepting a recipient from the payload. */
export async function markOwnRead(userId: string, ids?: string[], db: any = prisma) {
  const requestedIds = ids === undefined ? undefined : Array.from(new Set(ids));
  if (requestedIds?.length === 0) return { count: 0 };

  if (requestedIds) {
    const owned = await db.notification.findMany({
      where: { userId, id: { in: requestedIds } },
      select: { id: true },
    });
    if (owned.length !== requestedIds.length) notFound();
  }

  const where = {
    userId,
    ...(requestedIds ? { id: { in: requestedIds } } : {}),
    isRead: false,
  };
  const result = await db.notification.updateMany({ where, data: { isRead: true } });
  await db.auditLog?.create?.({
    data: {
      entityType: "notification",
      entityId: userId,
      action: "marked_read",
      actorId: userId,
      metaJson: JSON.stringify({ count: result.count, ids: requestedIds ?? "all" }),
    },
  });
  return result;
}

export async function markAllRead(actor: SabahActor, db: any = prisma) {
  const result = await db.notification.updateMany({ where: { userId: actor.id, isRead: false }, data: { isRead: true } });
  await db.auditLog?.create?.({ data: { entityType: "notification", entityId: actor.id, action: "marked_all_read", actorId: actor.id, metaJson: JSON.stringify({ count: result.count }) } });
  return result;
}
