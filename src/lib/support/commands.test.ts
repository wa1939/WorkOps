import { describe, expect, it, vi } from "vitest";
import { claimSupportRequest, createSupportRequest, listSupportForActor } from "./commands";

const actor = { id: "u-requester", role: "MEMBER" as const };
const project = { id: "p1", status: "Active", ownerId: null, managerId: null, sponsorId: null, members: [{ userId: "u-requester" }] };
const task = { id: "t1", projectId: "p1", status: "TODO", isPrivate: false, createdById: null, assignments: [{ userId: "u-recipient" }] };

function dbFor(row: any = { id: "sr1", title: "Need help", status: "Open", claimedById: null, requesterId: actor.id, projectId: "p1", taskId: "t1", project, task }) {
  const notifications = { createMany: vi.fn(), create: vi.fn() };
  const auditLog = { create: vi.fn() };
  const db: any = {
    supportRequest: { create: vi.fn().mockResolvedValue(row), findFirst: vi.fn().mockResolvedValue(row), findMany: vi.fn().mockResolvedValue([row]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    project: { findUnique: vi.fn().mockResolvedValue(project) },
    task: { findUnique: vi.fn().mockResolvedValue(task) },
    projectMember: { findMany: vi.fn().mockResolvedValue([{ userId: actor.id }, { userId: "u-recipient" }]) },
    taskAssignment: { findMany: vi.fn().mockResolvedValue([{ userId: "u-recipient" }, { userId: "u-recipient" }]) },
    notification: notifications, auditLog,
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db, notifications, auditLog, row };
}

describe("support commands", () => {
  it("creates with linked visibility, deduped recipient notifications, audit, and read-back", async () => {
    const { db, notifications, auditLog } = dbFor();
    const result = await createSupportRequest({ title: "Need help", projectId: "p1", taskId: "t1" }, actor, db);
    expect(result.id).toBe("sr1");
    expect(notifications.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ userId: "u-recipient" })] });
    expect(notifications.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityType: "SupportRequest", action: "CREATE" }) }));
  });

  it("keeps list queries actor-scoped, including private task rules", async () => {
    const { db } = dbFor();
    await listSupportForActor({}, actor, db);
    expect(db.supportRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]) }) }));
  });

  it("does not notify unrelated project members about a private linked task", async () => {
    const privateTask = { ...task, isPrivate: true, createdById: actor.id, assignments: [{ userId: "u-assignee" }] };
    const { db, notifications } = dbFor({ ...dbFor().row, task: privateTask });
    db.projectMember.findMany.mockResolvedValue([{ userId: actor.id }, { userId: "u-unrelated" }]);
    db.task.findUnique.mockResolvedValue(privateTask);
    db.taskAssignment.findMany.mockResolvedValue([{ userId: "u-assignee" }]);

    await createSupportRequest({ title: "Private task help", projectId: "p1", taskId: "t1" }, actor, db);

    expect(notifications.createMany.mock.calls[0][0].data.map((notification: any) => notification.userId)).toEqual(["u-assignee"]);
  });

  it("requires private linked-task visibility in addition to project membership", async () => {
    const { db } = dbFor({ ...dbFor().row, task: { ...task, isPrivate: true, createdById: "u-owner", assignments: [] } });
    await listSupportForActor({}, actor, db);
    const where = db.supportRequest.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain("createdById");
    expect(JSON.stringify(where)).toContain("assignments");
    expect(JSON.stringify(where)).toContain("taskId");
  });

  it("does not expose sensitive requester or claimant fields in command readback", async () => {
    const sensitive = { id: actor.id, name: "Requester", title: "Analyst", role: "MEMBER", email: "secret@example.com", password: "hash", emailVerified: new Date() };
    const { db, row } = dbFor();
    row.requester = sensitive;
    row.claimedBy = { ...sensitive, id: "u-claimer" };
    const result = await listSupportForActor({}, actor, db);
    expect(result[0].requester).toEqual({ id: actor.id, name: "Requester", title: "Analyst", role: "MEMBER" });
    expect(result[0].claimedBy).toEqual({ id: "u-claimer", name: "Requester", title: "Analyst", role: "MEMBER" });
    expect(result[0].requester).not.toHaveProperty("email");
    expect(result[0].requester).not.toHaveProperty("password");
    expect(result[0].requester).not.toHaveProperty("emailVerified");
  });

  it("blocks VIEWER writes and invalid cross-linked entities", async () => {
    await expect(createSupportRequest({ title: "x", projectId: "p1" }, { id: "viewer", role: "VIEWER" }, dbFor().db)).rejects.toMatchObject({ status: 403 });
    const { db } = dbFor();
    db.task.findUnique.mockResolvedValue({ ...task, projectId: "other" });
    await expect(createSupportRequest({ title: "x", projectId: "p1", taskId: "t1" }, actor, db)).rejects.toMatchObject({ code: "INVALID_LINK" });
  });

  it("uses an atomic nullable-claim predicate and returns 409 on contention", async () => {
    const { db } = dbFor();
    db.supportRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimSupportRequest("sr1", { id: "u-claimer", role: "MEMBER" }, db)).rejects.toMatchObject({ status: 409 });
    expect(db.supportRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "sr1", status: "Open", claimedById: null } }));
  });

  it("claims once, notifies requester, audits, and reads back the claimed row", async () => {
    const { db, notifications, auditLog, row } = dbFor();
    row.requesterId = "u-requester";
    row.claimedById = null;
    db.supportRequest.updateMany.mockImplementation(async () => { row.claimedById = "u-claimer"; row.status = "Claimed"; return { count: 1 }; });
    const result = await claimSupportRequest("sr1", { id: "u-claimer", role: "MEMBER" }, db);
    expect(result.claimedById).toBe("u-claimer");
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: "u-requester" }) }));
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "CLAIM" }) }));
  });
});
