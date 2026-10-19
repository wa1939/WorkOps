import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/capabilities/contracts";
import { canReadSavedView, canUpdateSavedView } from "./authorization";
import { createSavedViewSchema, savedViewSearchSchema, updateSavedViewSchema, type SavedViewActorInput, type SavedViewSearchInput, type SavedViewUpdateInput } from "./schemas";

export class SavedViewCommandError extends Error { constructor(message: string, readonly status: number, readonly code: string) { super(message); this.name = "SavedViewCommandError"; } }
function invalid(message: string): never { throw new SavedViewCommandError(message, 400, "INVALID_INPUT"); }
function notFound(): never { throw new SavedViewCommandError("Saved view not found", 404, "NOT_FOUND"); }
function visible(view: any, actor: SabahActor): any { if (!view || !canReadSavedView(view, actor)) notFound(); return view; }
function versionMatches(updatedAt: Date | string, expected: string): boolean { return new Date(updatedAt).getTime() === new Date(expected).getTime(); }
function fields(input: Record<string, unknown>) { return Object.keys(input).filter((key) => !["expectedUpdatedAt"].includes(key)); }

export async function listSavedViewsForActor(input: Partial<SavedViewSearchInput> = {}, actor: SabahActor, db: any = prisma) {
  const parsed = savedViewSearchSchema.parse(input);
  const rows = await db.savedView.findMany({ where: { OR: [{ scope: "TEAM" }, { ownerId: actor.id }] }, include: { owner: { select: { id: true, name: true, image: true } }, _count: { select: { votes: true } } }, orderBy: { createdAt: "desc" }, take: parsed.limit });
  const query = parsed.query.toLowerCase();
  return rows.filter((row: any) => (row.scope === "TEAM" || row.ownerId === actor.id) && (!query || `${row.name ?? ""} ${row.description ?? ""}`.toLowerCase().includes(query)));
}

export async function getSavedViewForActor(id: string, actor: SabahActor, db: any = prisma) {
  const view = await db.savedView.findUnique({ where: { id }, include: { owner: { select: { id: true, name: true, image: true } }, votes: { where: { userId: actor.id }, select: { id: true } }, _count: { select: { votes: true } } } });
  const safe = visible(view, actor);
  // Keep the public votes field shape while never returning voter identities.
  return { ...safe, votes: [], voteCount: safe._count?.votes ?? 0, hasVoted: safe.votes.length > 0 };
}

export async function createSavedView(input: Partial<SavedViewActorInput>, actor: SabahActor, db: any = prisma) {
  const parsed = createSavedViewSchema.safeParse(input); if (!parsed.success) invalid("Invalid saved view details");
  if (actor.role === "VIEWER") throw new SavedViewCommandError("VIEWER cannot create saved views", 403, "FORBIDDEN");
  const created = await db.$transaction(async (tx: any) => {
    const row = await tx.savedView.create({ data: { ...parsed.data, ownerId: actor.id } });
    await tx.auditLog?.create?.({ data: { entityType: "saved_view", entityId: row.id, action: "created", actorId: actor.id, metaJson: JSON.stringify({ fields: fields(parsed.data as any) }) } });
    return row;
  });
  const readBack = await db.savedView.findUnique({ where: { id: created.id } });
  return readBack ?? created;
}

export async function updateSavedView(id: string, input: SavedViewUpdateInput, actor: SabahActor, db: any = prisma) {
  const parsed = updateSavedViewSchema.safeParse({ ...input }); if (!parsed.success) invalid("Invalid saved view details");
  const current = visible(await db.savedView.findUnique({ where: { id } }), actor);
  if (!canUpdateSavedView(current, actor)) throw new SavedViewCommandError("Only the owner can update a saved view", 403, "FORBIDDEN");
  if (!versionMatches(current.updatedAt, parsed.data.expectedUpdatedAt)) throw new SavedViewCommandError("Saved view was modified by someone else", 409, "VERSION_CONFLICT");
  const { expectedUpdatedAt: _expected, ...data } = parsed.data;
  let updated: any;
  try {
    updated = await db.$transaction(async (tx: any) => {
      const row = await tx.savedView.update({ where: { id, updatedAt: new Date(parsed.data.expectedUpdatedAt) }, data });
      await tx.auditLog?.create?.({ data: { entityType: "saved_view", entityId: id, action: "updated", actorId: actor.id, metaJson: JSON.stringify({ fields: fields(data as any) }) } });
      return row;
    });
  } catch (error: any) {
    if (error?.code === "P2025") throw new SavedViewCommandError("Saved view was modified by someone else", 409, "VERSION_CONFLICT");
    throw error;
  }
  const readBack = await db.savedView.findUnique({ where: { id } });
  return readBack ?? updated;
}

export async function voteSavedView(id: string, actor: SabahActor, db: any = prisma) {
  visible(await db.savedView.findUnique({ where: { id } }), actor);
  const where = { viewId_userId: { viewId: id, userId: actor.id } };
  const existing = await db.savedViewVote.findUnique({ where });
  if (existing) {
    try {
      await db.savedViewVote.delete({ where: { id: existing.id } });
    } catch (error: any) {
      // P2025: a concurrent request already removed the vote — same outcome.
      if (error?.code !== "P2025") throw error;
    }
    return { viewId: id, voted: false };
  }
  try {
    await db.savedViewVote.create({ data: { viewId: id, userId: actor.id } });
  } catch (error: any) {
    // P2002: a concurrent request already created the vote under the unique key.
    if (error?.code !== "P2002") throw error;
  }
  return { viewId: id, voted: true };
}
