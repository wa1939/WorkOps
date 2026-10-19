import type { SabahActor } from "@/lib/sabah/capabilities/contracts";
export type LeaveActor = Pick<SabahActor, "id" | "role">;
export class LeaveCommandError extends Error { constructor(message: string, public readonly status: number, public readonly code = "LEAVE_ERROR") { super(message); this.name = "LeaveCommandError"; } }
export function assertLeaveReader(actor: LeaveActor) { if (!actor.id) throw new LeaveCommandError("Invalid actor", 401, "UNAUTHENTICATED"); }
export function assertLeaveWriter(actor: LeaveActor) { assertLeaveReader(actor); if (actor.role === "VIEWER") throw new LeaveCommandError("Viewer cannot write leave", 403, "FORBIDDEN"); }
export function assertOwnLeave(leave: { userId: string }, actor: LeaveActor) { if (leave.userId !== actor.id) throw new LeaveCommandError("Leave request not found", 404, "NOT_FOUND"); }
export function taskMayBeHandedOver(task: { createdById?: string | null; isPrivate?: boolean; assignments?: Array<{ userId: string }> }, actor: LeaveActor) { return task.isPrivate !== true ? (task.createdById === actor.id || (task.assignments ?? []).some(a => a.userId === actor.id)) : (task.createdById === actor.id || (task.assignments ?? []).some(a => a.userId === actor.id)); }
