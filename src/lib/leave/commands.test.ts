import { describe, expect, it, vi } from "vitest";
import { createLeaveRequest, listMyLeave, updateHandover, updateLeaveRequest, LeaveCommandError } from "./commands";

const actor = { id: "u1", role: "MEMBER" as const };
const base = { startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-03T00:00:00.000Z", delegateId: "u2", reason: "rest" };
function db() {
  const tx: any = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: "u2", isActive: true, name: "Delegate" }) },
    leaveRequest: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn().mockResolvedValue({ id: "l1", ...base, userId: "u1", status: "Approved" }), create: vi.fn().mockResolvedValue({ id: "l1", ...base, userId: "u1", status: "Approved" }), findMany: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({ id: "l1", ...base, userId: "u1", status: "Approved" }) },
    task: { findMany: vi.fn().mockResolvedValue([{ id: "t1", createdById: "u1", isPrivate: false, assignments: [] }]), update: vi.fn() }, handover: { create: vi.fn().mockResolvedValue({ id: "h1" }) },
    comment: { createMany: vi.fn() }, notification: { create: vi.fn() }, auditLog: { create: vi.fn() },
    taskAssignment: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return { ...tx, $transaction: vi.fn(async (fn: any) => fn(tx)) };
}
describe("leave commands", () => {
  it("lists only the actor's leave", async () => { const d = db(); d.leaveRequest.findMany.mockResolvedValue([{ id: "mine", userId: "u1" }]); expect(await listMyLeave(d as any, actor)).toEqual([{ id: "mine", userId: "u1" }]); expect(d.leaveRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1" } })); });
  it("rejects self delegation and invalid ordering", async () => { await expect(createLeaveRequest(db() as any, actor, { ...base, delegateId: "u1" })).rejects.toMatchObject({ code: "SELF_DELEGATE" }); await expect(createLeaveRequest(db() as any, actor, { ...base, startAt: base.endAt })).rejects.toMatchObject({ code: "INVALID_DATE_RANGE" }); });
  it("creates leave, handover, comments, notification in one transaction without touching task assignments", async () => { const d = db(); const result = await createLeaveRequest(d as any, actor, { ...base, handoverTaskIds: ["t1"], handoverNote: "cover" }); expect(result.id).toBe("l1"); expect(d.$transaction).toHaveBeenCalledOnce(); expect(d.handover.create).toHaveBeenCalled(); expect(d.comment.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([expect.objectContaining({ isHandoverUpdate: true })]) })); expect(d.notification.create).toHaveBeenCalled(); expect(d.taskAssignment.deleteMany).not.toHaveBeenCalled(); expect(d.taskAssignment.createMany).not.toHaveBeenCalled(); });
  it("keeps handover advisory: updateHandover records handover, comments, notification without touching task assignments", async () => { const d = db(); d.leaveRequest.findFirst.mockResolvedValue({ id: "l1", ...base, userId: "u1", status: "Approved" }); const result = await updateHandover(d as any, actor, { id: "l1", handoverTaskIds: ["t1"], handoverNote: "cover" }); expect(result.id).toBe("l1"); expect(d.handover.create).toHaveBeenCalled(); expect(d.comment.createMany).toHaveBeenCalled(); expect(d.notification.create).toHaveBeenCalled(); expect(d.taskAssignment.deleteMany).not.toHaveBeenCalled(); expect(d.taskAssignment.createMany).not.toHaveBeenCalled(); });
  it("rejects duplicate and non-eligible handover tasks without leaking details", async () => { const d = db(); d.task.findMany.mockResolvedValue([{ id: "t1", createdById: "someone", isPrivate: true, assignments: [] }]); await expect(createLeaveRequest(d as any, actor, { ...base, handoverTaskIds: ["t1", "t1"] })).rejects.toMatchObject({ code: "DUPLICATE_TASK" }); await expect(createLeaveRequest(d as any, actor, { ...base, handoverTaskIds: ["t1"] })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" }); });
  it("rejects writes by viewers", async () => { await expect(createLeaveRequest(db() as any, { id: "v", role: "VIEWER" }, base)).rejects.toMatchObject({ status: 403 }); });
});


it("filters leave search by reason query", async () => { const d = db(); await listMyLeave(d as any, actor, { query: "medical", limit: 10 }); expect(d.leaveRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "u1", reason: { contains: "medical", mode: "insensitive" } }, take: 10 })); });

it("uses current dates for one-sided updates and rejects overlap without writing", async () => { const d = db(); const existing = { id: "l1", ...base, userId: "u1", status: "Approved" }; const overlap = { id: "l2" }; d.leaveRequest.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(overlap); await expect(updateLeaveRequest(d as any, actor, { id: "l1", endAt: "2026-09-02T00:00:00.000Z" })).rejects.toMatchObject({ code: "OVERLAP" }); expect(d.leaveRequest.update).not.toHaveBeenCalled(); });

it("rejects a one-sided update that makes the resulting range invalid without writing", async () => { const d = db(); d.leaveRequest.findFirst.mockResolvedValueOnce({ id: "l1", ...base, userId: "u1", status: "Approved" }); await expect(updateLeaveRequest(d as any, actor, { id: "l1", startAt: "2026-09-04T00:00:00.000Z" })).rejects.toMatchObject({ code: "INVALID_DATE_RANGE" }); expect(d.leaveRequest.update).not.toHaveBeenCalled(); });

it("fails closed when handover read-back is missing", async () => { const d = db(); d.leaveRequest.findFirst.mockResolvedValue({ id: "l1", ...base, userId: "u1", status: "Approved" }); d.leaveRequest.findUnique.mockResolvedValue(null); await expect(updateHandover(d as any, actor, { id: "l1", handoverTaskIds: ["t1"] })).rejects.toMatchObject({ code: "READBACK_FAILED" }); });
