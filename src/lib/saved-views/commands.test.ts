import { describe, expect, it, vi } from "vitest";
import { createSavedView, getSavedViewForActor, listSavedViewsForActor, updateSavedView, voteSavedView } from "./commands";

const actor = (id: string, role: any = "MEMBER") => ({ id, role, departmentIds: [] });
const validBlocks = JSON.stringify({ __meta: { cover: null }, blocks: [{ id: "b1", type: "header", content: "Hello", size: "h1", width: "full" }] });

function dbFor(rows: any[]) {
  const views = [...rows];
  const db: any = {
    savedView: {
      findMany: vi.fn(async () => views),
      findUnique: vi.fn(async ({ where }: any) => views.find((view) => view.id === where.id)),
      create: vi.fn(async ({ data }: any) => ({ id: "new-view", updatedAt: new Date("2026-01-02"), createdAt: new Date("2026-01-02"), ...data })),
      update: vi.fn(async ({ where, data }: any) => ({ ...views.find((view) => view.id === where.id), ...data, updatedAt: new Date("2026-01-03") })),
    },
    savedViewVote: {
      findUnique: vi.fn(async ({ where }: any) => rows.find((row) => row.vote && row.vote.viewId === where.viewId_userId.viewId && row.vote.userId === where.viewId_userId.userId)?.vote ?? null),
      create: vi.fn(async ({ data }: any) => { const vote = { id: `vote-${rows.length + 1}`, ...data }; rows.push({ vote }); return vote; }),
      delete: vi.fn(async ({ where }: any) => { const index = rows.findIndex((row) => row.vote?.id === where.id); const [removed] = index >= 0 ? rows.splice(index, 1) : []; return removed?.vote; }),
      upsert: vi.fn(async ({ where, create }: any) => {
        const existing = rows.find((row) => row.vote && row.vote.viewId === where.viewId_userId.viewId && row.vote.userId === where.viewId_userId.userId)?.vote;
        if (existing) return existing;
        const vote = { id: "vote-1", ...create }; rows.push({ vote }); return vote;
      }),
    },
    auditLog: { create: vi.fn() },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return db;
}

describe("saved view commands", () => {
  it("returns team views and only the actor's personal views", async () => {
    const db = dbFor([
      { id: "team", scope: "TEAM", ownerId: "other" },
      { id: "mine", scope: "PERSONAL", ownerId: "me" },
      { id: "secret", scope: "PERSONAL", ownerId: "other" },
    ]);
    expect((await listSavedViewsForActor({ query: "" }, actor("me"), db)).map((view: any) => view.id)).toEqual(["team", "mine"]);
  });

  it("rejects unsupported blocks before creating a view", async () => {
    const db = dbFor([]);
    await expect(createSavedView({ name: "bad", blocksJson: JSON.stringify({ blocks: [{ id: "x", type: "not-supported" }] }), scope: "PERSONAL" }, actor("me"), db)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(db.savedView.create).not.toHaveBeenCalled();
  });

  it("creates with explicit scope, audits, and reads back", async () => {
    const db = dbFor([]);
    const result = await createSavedView({ name: "Mine", blocksJson: validBlocks, scope: "PERSONAL" }, actor("me"), db);
    expect(result).toMatchObject({ id: "new-view", ownerId: "me", scope: "PERSONAL" });
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it("allows only the owner to update and rejects stale versions", async () => {
    const current = { id: "v1", name: "Old", scope: "TEAM", ownerId: "owner", blocksJson: validBlocks, updatedAt: new Date("2026-01-01") };
    const db = dbFor([current]);
    await expect(updateSavedView("v1", { name: "No", expectedUpdatedAt: "2026-01-01T00:00:00.000Z" }, actor("other"), db)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSavedView("v1", { name: "New", expectedUpdatedAt: "2025-01-01T00:00:00.000Z" }, actor("owner"), db)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(db.savedView.update).not.toHaveBeenCalled();
  });

  it("hides another user's personal view from get and vote", async () => {
    const db = dbFor([{ id: "secret", scope: "PERSONAL", ownerId: "other" }]);
    await expect(getSavedViewForActor("secret", actor("me"), db)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await expect(voteSavedView("secret", actor("me"), db)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(db.savedViewVote.upsert).not.toHaveBeenCalled(); expect(db.savedViewVote.create).not.toHaveBeenCalled(); expect(db.savedViewVote.delete).not.toHaveBeenCalled();
  });

  it("toggles votes under the unique view/user key", async () => {
    const db = dbFor([{ id: "v1", scope: "TEAM", ownerId: "owner" }]);
    const first = await voteSavedView("v1", actor("me"), db);
    const second = await voteSavedView("v1", actor("me"), db);
    expect(first).toMatchObject({ voted: true });
    expect(second).toMatchObject({ voted: false });
    expect(db.savedViewVote.create).toHaveBeenCalledOnce();
    expect(db.savedViewVote.delete).toHaveBeenCalledOnce();
  });

  it("does not expose a delete command", async () => expect((await import("./commands") as any).deleteSavedView).toBeUndefined());
});
