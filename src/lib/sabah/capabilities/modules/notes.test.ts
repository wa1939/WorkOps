import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const state: any = {
    nextId: 2,
    notes: [{ id: "n1", title: "Old", body: "Body", isShared: true, isPinned: false, color: "default", authorId: "u1", taskId: null, caseStudyId: null, updatedAt: new Date("2026-08-24T00:00:00.000Z"), tags: [{ tagId: "old-tag" }], links: [{ label: "Old", url: "https://old.example" }] }],
    tags: new Set(["old-tag", "new-tag-1", "new-tag-2"]),
  };
  const visibleNote = (id: string) => state.notes.find((n: any) => n.id === id);
  const db: any = {
    notePage: {
      findMany: vi.fn(async () => state.notes),
      findFirst: vi.fn(async ({ where }: any) => visibleNote(where.id)),
      create: vi.fn(async ({ data }: any) => { const n = { id: `n${state.nextId++}`, updatedAt: new Date("2026-08-24T00:00:00.000Z"), ...data, tags: data.tags?.create?.map((x: any) => ({ tagId: x.tagId })) ?? [], links: data.links?.create ?? [] }; state.notes.push(n); return n; }),
      updateMany: vi.fn(async ({ where, data }: any) => { const n = visibleNote(where.id); if (!n || n.updatedAt.getTime() !== where.updatedAt.getTime()) return { count: 0 }; Object.assign(n, data); n.updatedAt = new Date("2026-08-24T01:00:00.000Z"); return { count: 1 }; }),
      update: vi.fn(async ({ where, data }: any) => { const n = visibleNote(where.id); Object.assign(n, data); if (data.tags?.create) n.tags = data.tags.create.map((x: any) => ({ tagId: x.tagId })); if (data.links?.create) n.links = data.links.create; return n; }),
    },
    noteTag: { deleteMany: vi.fn(async ({ where }: any) => { const n = visibleNote(where.noteId); if (n) n.tags = []; }) },
    link: { deleteMany: vi.fn(async ({ where }: any) => { const n = visibleNote(where.noteId); if (n) n.links = []; }) },
    tag: { findMany: vi.fn(async ({ where }: any) => (where.id.in as string[]).filter(id => state.tags.has(id)).map(id => ({ id }))) },
    task: { findFirst: vi.fn(async () => ({ id: "task-1" })) },
    caseStudy: { findFirst: vi.fn(async () => ({ id: "case-1" })) },
    auditLog: { create: vi.fn(async () => undefined) },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db, state };
});
vi.mock("@/lib/prisma", () => ({ prisma: fixture.db }));

import { NOTES_CAPABILITIES, notesConvertToActionsCapability, notesCreateCapability, notesSearchCapability, notesSummarizeCapability, notesUpdateCapability } from "./notes";

const actor = { id: "u1", role: "MEMBER", departmentIds: [] } as any;
const ctx = { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() } as any;
const note = { id: "n1", title: "New", body: "Body", isShared: true, isPinned: false, color: "default", taskId: null, caseStudyId: null, tags: [{ tagId: "new-tag-1" }], links: [{ label: "Spec", url: "https://example.com" }] };

describe("notes capabilities", () => {
  it("registers exact names and exposes no delete", () => expect(NOTES_CAPABILITIES.map(c => c.name)).toEqual(["notes.search", "notes.get", "notes.create", "notes.update", "notes.summarize", "notes.convertToActions"]));
  it("normalizes optional search input and preserves read behavior", async () => { await expect(notesSearchCapability.execute({} as any, ctx)).resolves.toEqual(fixture.state.notes); });
  it("previews updates with current and proposed values", async () => { const preview = await notesUpdateCapability.preview({ id: "n1", changes: { title: "New", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" } }, ctx); expect(preview.fields).toEqual(expect.arrayContaining([{ path: "title", current: "Old", proposed: "New" }])); });
  it("rejects a visible non-author update preview without writing", async () => { fixture.state.notes.push({ ...fixture.state.notes[0], id: "n2", title: "Foreign", authorId: "u2" }); try { await expect(notesUpdateCapability.preview({ id: "n2", changes: { title: "Nope", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" } }, ctx)).rejects.toMatchObject({ status: 403 }); expect(fixture.db.notePage.update).not.toHaveBeenCalled(); } finally { fixture.state.notes.pop(); } });
  it("rejects viewer update previews before reading", async () => { const viewer = { ...ctx, actor: { ...ctx.actor, role: "VIEWER" } }; await expect(notesUpdateCapability.preview({ id: "n1", changes: { title: "Nope", expectedUpdatedAt: "2026-08-24T00:00:00.000Z" } }, viewer as any)).rejects.toMatchObject({ status: 403 }); });
  it("executes real create and update command paths with relation replacement", async () => {
    const created: any = await notesCreateCapability.execute({ title: "Created", body: "Body", isShared: true, tagIds: ["new-tag-2", "new-tag-1"], links: [{ label: "New", url: "https://new.example" }], taskId: "task-1", caseStudyId: "case-1" }, ctx);
    expect(created.tags.map((x: any) => x.tagId)).toEqual(["new-tag-2", "new-tag-1"]);
    const updated: any = await notesUpdateCapability.execute({ id: "n1", changes: { title: "Replaced", tagIds: ["new-tag-2", "new-tag-1"], links: [{ label: "New", url: "https://new.example" }], expectedUpdatedAt: "2026-08-24T00:00:00.000Z" } }, ctx);
    expect(updated.tags.map((x: any) => x.tagId)).toEqual(["new-tag-2", "new-tag-1"]);
    expect(updated.links).toEqual([{ label: "New", url: "https://new.example" }]);
    expect(updated.tags).not.toContainEqual({ tagId: "old-tag" });
    expect(updated.links).not.toContainEqual({ label: "Old", url: "https://old.example" });
    expect(fixture.db.noteTag.deleteMany).toHaveBeenCalledWith({ where: { noteId: "n1" } });
    expect(fixture.db.link.deleteMany).toHaveBeenCalledWith({ where: { noteId: "n1" } });
  });
  it("summarizes without writing and converts to a draft tasks.create proposal", async () => {
    const before = structuredClone(fixture.state.notes);
    fixture.db.notePage.create.mockClear();
    fixture.db.notePage.update.mockClear();
    fixture.db.notePage.updateMany.mockClear();
    const summary = await notesSummarizeCapability.execute({ id: "n1" }, ctx);
    expect(summary).toMatchObject({ noteId: "n1", draftOnly: true });
    const proposal = await notesConvertToActionsCapability.execute({ id: "n1" }, ctx);
    expect(proposal).toMatchObject({ noteId: "n1", draftOnly: true, workflow: { capability: "tasks.create" } });
    expect(fixture.state.notes).toEqual(before);
    expect(fixture.db.notePage.create).not.toHaveBeenCalled();
    expect(fixture.db.notePage.update).not.toHaveBeenCalled();
    expect(fixture.db.notePage.updateMany).not.toHaveBeenCalled();
    expect(notesSummarizeCapability.summarize(summary)).toMatch(/nothing was written/);
  });
  it("rejects capability verification when a relation differs", async () => { await expect(notesUpdateCapability.verify({ ...note, links: [] }, ctx)).rejects.toMatchObject({ code: "VERIFY_FAILED" }); });
});
