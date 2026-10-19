import type { SabahActor } from "@/lib/sabah/auth/actor";

export type SupportActor = Pick<SabahActor, "id" | "role">;

export class SupportCommandError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = "SUPPORT_ERROR") {
    super(message);
    this.name = "SupportCommandError";
  }
}

export function assertSupportWriteAllowed(actor: SupportActor): void {
  if (actor.role === "VIEWER") throw new SupportCommandError("VIEWER cannot mutate support requests", 403, "FORBIDDEN");
}

const projectVisibility = (actor: SupportActor) => ({
  OR: [
    { ownerId: actor.id },
    { managerId: actor.id },
    { sponsorId: actor.id },
    { members: { some: { userId: actor.id } } },
  ],
});

const taskVisibility = (actor: SupportActor) => ({
  OR: [
    { isPrivate: false },
    { createdById: actor.id },
    { assignments: { some: { userId: actor.id } } },
  ],
});

export function supportVisibility(actor: SupportActor): Record<string, unknown> {
  if (actor.role === "ADMIN") return {};
  // A request with two linked entities is visible only when both links are
  // visible. In particular, project membership never bypasses private-task
  // access (and a public task never bypasses project access).
  return {
    OR: [
      { requesterId: actor.id },
      {
        AND: [
          { OR: [{ projectId: null }, { project: { is: projectVisibility(actor) } }] },
          { OR: [{ taskId: null }, { task: { is: taskVisibility(actor) } }] },
        ],
      },
    ],
  };
}
