import type { SourceRef } from "../intelligence/contracts";

export const SABAH_LIFECYCLE_EVENT_NAMES = ["workflow.planned", "approval.requested", "step.completed", "step.failed", "memory.proposed", "playbook.proposed"] as const;
export type SabahLifecycleEventName = (typeof SABAH_LIFECYCLE_EVENT_NAMES)[number];

export type SabahLifecycleEvent = {
  id: string;
  name: SabahLifecycleEventName;
  occurredAt: string;
  correlationId: string;
  actorId: string | null;
  entityRefs: SourceRef[];
  payload: unknown;
};

export type LifecycleEventInput = Omit<SabahLifecycleEvent, "id" | "occurredAt"> & { id?: string; occurredAt?: string };
export type EventHandler = (event: SabahLifecycleEvent) => Promise<void> | void;
