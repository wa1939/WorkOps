import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { MemoryRecord, MemoryScope, SharedScopePolicy } from "./contracts";

export class MemoryAuthorizationError extends Error { constructor(message: string, readonly code: string) { super(message); this.name = "MemoryAuthorizationError"; } }

export async function canApproveMemory(actor: SabahActor, memory: Pick<MemoryRecord, "id" | "scope" | "ownerId" | "departmentId">, policy?: SharedScopePolicy): Promise<boolean> {
  if (actor.role === "ADMIN" && memory.scope !== "TEAM" && memory.scope !== "WORKSPACE") return true;
  if (memory.scope === "USER") return memory.ownerId === actor.id || actor.role === "ADMIN";
  if (memory.scope === "DEPARTMENT") return actor.role === "LEAD" && !!memory.departmentId && actor.departmentIds.includes(memory.departmentId);
  return (actor.role === "LEAD" || actor.role === "ADMIN") && !!policy && await policy(actor, memory);
}

export async function canAccessMemory(actor: SabahActor, memory: Pick<MemoryRecord, "id" | "scope" | "ownerId" | "departmentId">, policy?: SharedScopePolicy): Promise<boolean> {
  if (actor.role === "ADMIN" && memory.scope !== "TEAM" && memory.scope !== "WORKSPACE") return true;
  if (memory.scope === "USER") return memory.ownerId === actor.id;
  if (memory.scope === "DEPARTMENT") return !!memory.departmentId && actor.departmentIds.includes(memory.departmentId);
  return !!policy && await policy(actor, memory);
}

export function validateScopeOwnership(actor: SabahActor, input: Pick<MemoryRecord, "scope" | "ownerId" | "departmentId">): void {
  if (input.scope === "USER" && input.ownerId !== actor.id) throw new MemoryAuthorizationError("User memory belongs to another actor", "MEMORY_SCOPE_FORBIDDEN");
  if (input.scope === "DEPARTMENT" && (!input.departmentId || !actor.departmentIds.includes(input.departmentId))) throw new MemoryAuthorizationError("Actor is outside department scope", "MEMORY_SCOPE_FORBIDDEN");
  if ((input.scope === "TEAM" || input.scope === "WORKSPACE") && !input.ownerId) throw new MemoryAuthorizationError("Shared memory requires a stable scope identity", "MEMORY_SCOPE_FORBIDDEN");
}

export function sharedScope(scope: MemoryScope): boolean { return scope !== "USER"; }
