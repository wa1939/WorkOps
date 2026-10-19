import type { SabahActor } from "@/lib/sabah/capabilities/contracts";

export function canWriteSavedView(actor: SabahActor): boolean { return actor.role !== "VIEWER"; }
export function canReadSavedView(view: { scope?: string | null; ownerId?: string | null }, actor: SabahActor): boolean {
  return view.scope !== "PERSONAL" || view.ownerId === actor.id;
}
export function canUpdateSavedView(view: { ownerId?: string | null }, actor: SabahActor): boolean { return view.ownerId === actor.id && canWriteSavedView(actor); }
