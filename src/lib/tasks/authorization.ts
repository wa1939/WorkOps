import type { SabahActor } from "@/lib/sabah/auth/actor";
import { composeScopes, workspaceScopeWhere } from "@/lib/workspaces/scope";

export type TaskActor = Pick<SabahActor, "id" | "role">;
export class TaskCommandError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = "TASK_ERROR") { super(message); this.name = "TaskCommandError"; }
}
export const privateTaskVisibility = (actor: TaskActor) => actor.role === "ADMIN" ? {} : {
  OR: [{ isPrivate: false }, { createdById: actor.id }, { assignments: { some: { userId: actor.id } } }],
};
export function taskScopeForActor(actor: TaskActor, workspaceId?: string): unknown {
  const privacyScope = privateTaskVisibility(actor);
  return workspaceId === undefined
    ? privacyScope
    : composeScopes(privacyScope, workspaceScopeWhere(workspaceId));
}
export function canMutateTask(task: { createdById?: string | null; assignments?: Array<{ userId: string }>; type?: string }, actor: TaskActor) {
  return actor.role !== "VIEWER" && (actor.role === "ADMIN" || task.createdById === actor.id || (task.assignments ?? []).some(a => a.userId === actor.id));
}
export function canReassignTask(task: { createdById?: string | null }, actor: TaskActor) { return actor.role !== "VIEWER" && (actor.role === "ADMIN" || task.createdById === actor.id); }
export function assertViewerAllowed(actor: TaskActor) { if (actor.role === "VIEWER") throw new TaskCommandError("VIEWER cannot mutate tasks", 403, "FORBIDDEN"); }
