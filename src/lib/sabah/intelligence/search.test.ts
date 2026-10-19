import { describe, expect, it, vi } from "vitest";
import { workspaceSearch, type IndexedFindManyArgs, type IndexedRow, type WorkspaceSearchDb } from "./search";
import type { ScopeRow } from "./authorized-scope";
import type { SourceRef } from "./contracts";
import { rankAuthorizedCandidates } from "./rank";

const actor = { id: "alice", role: "MEMBER" as const, departmentIds: ["d1"] };
const source = (entityId: string): SourceRef => ({ entityType: "PROJECT", entityId, label: entityId, href: `/projects/${entityId}`, sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `c-${entityId}` });
const identity = (entityId: string) => ({ id: `identity-${entityId}`, entityType: "PROJECT" as const, entityId, chunkKind: "identity", text: JSON.stringify(source(entityId)), normalizedText: entityId, checksum: `c-${entityId}`, sourceUpdatedAt: new Date("2026-08-01"), staleAt: null, deletedAt: null });
const taskIdentity = (entityId: string) => ({ ...identity(entityId), entityType: "TASK" as const, text: JSON.stringify({ ...source(entityId), entityType: "TASK", href: `/tasks/${entityId}` }), });
const project = (id: string): ScopeRow => ({ id, ownerId: null, status: "OPEN", isArchived: false, closedAt: null, responsibleDepartmentId: "d1", members: [] });
const dbFor = (chunks: IndexedRow[], fingerprints: IndexedRow[] = [], projects: ScopeRow[] = []): WorkspaceSearchDb => ({
  project: { findMany: async (): Promise<ScopeRow[]> => projects, findUnique: async ({ where }): Promise<ScopeRow | null> => projects.find((row) => row.id === where.id) ?? null },
  aiKnowledgeChunk: { findMany: async ({ where }: IndexedFindManyArgs): Promise<IndexedRow[]> => where.chunkKind === "identity" ? chunks.filter((row) => row.chunkKind === "identity") : chunks },
  aiEntityFingerprint: { findMany: async (_args: IndexedFindManyArgs): Promise<IndexedRow[]> => fingerprints },
  getCurrentSource: async (ref) => projects.some((row) => row.id === ref.entityId) ? { sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `c-${ref.entityId}` } : null,
});

describe("workspaceSearch", () => {
  it("authorizes before indexed retrieval and never returns private embedding neighbors", async () => {
    const calls: string[] = [];
    const db = dbFor([identity("public"), { ...identity("private"), entityId: "private", text: "EVP", checksum: "c-private" }], [], [project("public")]);
    const original = db.aiKnowledgeChunk.findMany;
    db.aiKnowledgeChunk.findMany = async (args: IndexedFindManyArgs): Promise<IndexedRow[]> => { calls.push("index"); return original(args); };
    const projectModel = db.project;
    if (!projectModel) throw new Error("project model missing");
    projectModel.findMany = async (..._args): Promise<ScopeRow[]> => { calls.push("scope"); return [project("public")]; };
    const result = await workspaceSearch({ query: "EVP", entityTypes: ["PROJECT"], limit: 10 }, actor, db);
    expect(calls[0]).toBe("scope");
    expect(result.items.map((item) => item.source.entityId)).not.toContain("private");
  });

  it("uses schema-valid selects, deterministic order, and SQL-side lexical/exact fingerprint predicates", async () => {
    const chunkFindMany = vi.fn(async ({ where }: IndexedFindManyArgs): Promise<IndexedRow[]> => where.chunkKind === "identity" ? [] : []);
    const fingerprintFindMany = vi.fn(async (_args: IndexedFindManyArgs): Promise<IndexedRow[]> => []);
    const db = dbFor([], [], [project("p1")]);
    db.aiKnowledgeChunk.findMany = chunkFindMany;
    db.aiEntityFingerprint.findMany = fingerprintFindMany;
    await workspaceSearch({ query: "abc", entityTypes: ["PROJECT"], limit: 10 }, actor, db);
    const chunkArgs = chunkFindMany.mock.calls[0]?.[0];
    const fingerprintArgs = fingerprintFindMany.mock.calls[0]?.[0];
    expect(chunkArgs).toBeDefined();
    expect(fingerprintArgs).toBeDefined();
    expect(chunkArgs).toMatchObject({ orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { id: "asc" }] });
    expect(chunkArgs?.select).not.toHaveProperty("sourceRef");
    expect(chunkArgs?.where.AND).toContainEqual({ OR: [{ text: { contains: "abc", mode: "insensitive" } }, { normalizedText: { contains: "abc", mode: "insensitive" } }] });
    expect(fingerprintArgs?.where.fingerprint).toEqual({ equals: "abc" });
  });

  it("rejects redirected identity provenance and current-source disappearance", async () => {
    const redirected = { ...identity("same"), text: JSON.stringify({ ...source("same"), entityType: "TASK" }), checksum: "c-same" };
    expect((await workspaceSearch({ query: "same", entityTypes: ["PROJECT"] }, actor, dbFor([redirected], [], [project("same")]))).items).toEqual([]);
    expect((await workspaceSearch({ query: "gone", entityTypes: ["PROJECT"] }, actor, dbFor([identity("gone")], [], []))).items).toEqual([]);
  });

  it("matches exact fingerprints only and excludes stale rows while bounding snippets", async () => {
    const db = dbFor([identity("ok"), { ...identity("ok"), id: "content-ok", text: "x".repeat(20_000), chunkKind: "content" }, { ...identity("stale"), staleAt: new Date() }], [{ id: "fp", entityType: "PROJECT", entityId: "ok", kind: "default", fingerprint: "ok", checksum: "c-ok", sourceUpdatedAt: new Date("2026-08-01"), staleAt: null, deletedAt: null }], [project("ok"), project("stale")]);
    const result = await workspaceSearch({ query: "ok", entityTypes: ["PROJECT"], limit: 10 }, actor, db);
    expect(result.items.map((item) => item.source.entityId)).toEqual(["ok"]);
    expect((result.items[0].snippet ?? "").length).toBeLessThanOrEqual(500);
  });

  it("does not return indexed NOTE body text at the model-facing boundary", async () => {
    const note = { ...identity("n1"), entityType: "NOTE" as const, text: JSON.stringify({ entityType: "NOTE", entityId: "n1", label: "Private note", href: "/internal/note/n1" }) };
    const db = dbFor([note, { ...note, id: "body", chunkKind: "content", text: "SECRET_NOTE_BODY" }], [], [project("n1")]);
    db.notePage = { findMany: async () => [{ id: "n1", isShared: true, authorId: actor.id }] };
    db.getCurrentSource = async () => ({ sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: "c-n1" });
    const result = await workspaceSearch({ query: "SECRET_NOTE_BODY", entityTypes: ["NOTE"] }, actor, db);
    expect(JSON.stringify(result)).not.toContain("SECRET_NOTE_BODY");
  });

  it("includes a fingerprint-only entity even when no content chunk contains the query", async () => {
    const db = dbFor([identity("finger-only")], [{ id: "fp", entityType: "PROJECT", entityId: "finger-only", kind: "content", fingerprint: "needle", sourceUpdatedAt: new Date("2026-08-01"), staleAt: null, deletedAt: null }], [project("finger-only")]);
    db.aiKnowledgeChunk.findMany = async ({ where }: IndexedFindManyArgs): Promise<IndexedRow[]> => where.chunkKind === "identity" ? [identity("finger-only")] : [];
    const result = await workspaceSearch({ query: "needle", entityTypes: ["PROJECT"] }, actor, db);
    expect(result.items.map((item) => item.source.entityId)).toEqual(["finger-only"]);
  });

  it("discards a source whose authoritative freshness or checksum changed", async () => {
    const db = dbFor([identity("changed")], [], [project("changed")]);
    db.getCurrentSource = async () => ({ sourceUpdatedAt: "2026-08-02T00:00:00.000Z", checksum: "c-changed" });
    expect((await workspaceSearch({ query: "changed", entityTypes: ["PROJECT"] }, actor, db)).items).toEqual([]);
    db.getCurrentSource = async () => ({ sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: "different" });
    expect((await workspaceSearch({ query: "changed", entityTypes: ["PROJECT"] }, actor, db)).items).toEqual([]);
  });

  it("fails closed when the authoritative current source omits its checksum", async () => {
    const db = dbFor([identity("no-checksum")], [], [project("no-checksum")]);
    const current = { sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: "c-no-checksum" };
    Reflect.deleteProperty(current, "checksum");
    db.getCurrentSource = async () => current;
    expect((await workspaceSearch({ query: "no-checksum", entityTypes: ["PROJECT"] }, actor, db)).items).toEqual([]);
  });

  it("requires an authoritative current-source resolver instead of silently returning empty results", async () => {
    const db = dbFor([identity("resolver-required")], [], [project("resolver-required")]);
    Reflect.deleteProperty(db, "getCurrentSource");
    await expect(workspaceSearch({ query: "resolver-required", entityTypes: ["PROJECT"] }, actor, db)).rejects.toMatchObject({ code: "CURRENT_SOURCE_RESOLVER_REQUIRED" });
  });

  it("propagates current source status into workspace search filters", async () => {
    const open = project("open");
    const closed = { ...project("closed"), status: "CLOSED" };
    const db = dbFor([identity("open"), identity("closed")], [], [open, closed]);
    db.getCurrentSource = async (ref) => {
      const row = [open, closed].find((candidate) => candidate.id === ref.entityId);
      return row ? { sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `c-${ref.entityId}`, status: row.status ?? null } : null;
    };
    const result = await workspaceSearch({ query: "open", entityTypes: ["PROJECT"], filters: { status: "OPEN" } }, actor, db);
    expect(result.items.map((item) => item.source.entityId)).toEqual(["open"]);
  });

  it("adds every normalized query trigram to the authorized SQL fallback", async () => {
    const db = dbFor([], [], [project("p1")]);
    const findMany = vi.fn(async (_args: IndexedFindManyArgs): Promise<IndexedRow[]> => []);
    db.aiKnowledgeChunk.findMany = findMany;
    await workspaceSearch({ query: "abcdef", entityTypes: ["PROJECT"] }, actor, db);
    const where = findMany.mock.calls[0]?.[0].where;
    const clauses = (where.AND as Array<{ OR?: Array<{ text?: { contains?: string }; normalizedText?: { contains?: string } }> }>).find((clause) => (clause.OR?.length ?? 0) > 2)?.OR ?? [];
    expect(clauses.map((clause) => clause.text?.contains).filter(Boolean)).toEqual(expect.arrayContaining(["abc", "bcd", "cde", "def"]));
  });

  it("hydrates identities across every authorized type page", async () => {
    const projects = Array.from({ length: 100 }, (_, i) => project(`p-${i}`));
    const tasks = Array.from({ length: 100 }, (_, i) => ({ ...project(`t-${i}`), isPrivate: false }));
    const chunks = [...projects.map((row) => identity(row.id)), ...tasks.map((row) => taskIdentity(row.id))];
    const db = dbFor([], [], projects);
    db.task = { findMany: async (): Promise<ScopeRow[]> => tasks, findUnique: async ({ where }): Promise<ScopeRow | null> => tasks.find((row) => row.id === where.id) ?? null };
    let identityTake = 0;
    db.aiKnowledgeChunk.findMany = async ({ where, take }: IndexedFindManyArgs): Promise<IndexedRow[]> => {
      if (where.chunkKind === "identity") { identityTake = take; return chunks.slice(0, take); }
      const rows = chunks.map((row) => ({ ...row, text: "needle" }));
      return rows.slice(0, take);
    };
    db.getCurrentSource = async (ref) => ({ sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `c-${ref.entityId}` });
    await workspaceSearch({ query: "needle", entityTypes: ["PROJECT", "TASK"], limit: 100 }, actor, db);
    expect(identityTake).toBe(200);
  });

  it("rejects unsupported and invalid rank filters", () => {
    expect(() => rankAuthorizedCandidates({ query: "x", candidates: [], filters: { madeUp: "x" } })).toThrow(/filter/i);
    expect(() => rankAuthorizedCandidates({ query: "x", candidates: [], filters: { updatedAfter: "not-a-date" } })).toThrow(/date/i);
  });

  it("only swallows an explicitly unavailable semantic provider", async () => {
    const db = dbFor([identity("semantic")], [], [project("semantic")]);
    const unavailable = Object.assign(new Error("optional provider unavailable"), { code: "SEMANTIC_UNAVAILABLE" });
    const unavailableResult = await workspaceSearch({ query: "semantic", entityTypes: ["PROJECT"] }, actor, db, { semanticSearch: async () => { throw unavailable; } });
    expect(unavailableResult.items).toHaveLength(1);
    await expect(workspaceSearch({ query: "semantic", entityTypes: ["PROJECT"] }, actor, db, { semanticSearch: async () => { throw new Error("database down"); } })).rejects.toThrow("database down");
  });
});
