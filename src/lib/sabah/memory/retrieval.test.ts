import { describe, expect, it } from "vitest";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { MemoryAdapter, MemoryRecord, SourceRef } from "./contracts";
import { createMemoryService } from "./service";
import { retrieveMemories } from "./retrieval";

const actor: SabahActor = { id: "u1", role: "MEMBER", departmentIds: ["d1"] };
const source = (id: string): SourceRef => ({ entityType: "TASK", entityId: id, label: id, href: `/tasks/${id}`, sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `sum-${id}` });
function db(rows: MemoryRecord[]): MemoryAdapter { return { list: async () => rows, get: async (id) => rows.find((r) => r.id === id) ?? null, create: async (r) => ({ ...r, id: "new", createdAt: new Date(), updatedAt: new Date() }), update: async (id, p) => ({ ...rows.find((r) => r.id === id)!, ...p }), transaction: async (work) => work() }; }
const row = (id: string, content: string, extra: Partial<MemoryRecord> = {}): MemoryRecord => ({ id, scope: "USER", kind: "PREFERENCE", state: "APPROVED", content, provenance: "USER_PROVIDED", confidence: .9, freshness: "FRESH", expiresAt: null, ownerId: actor.id, departmentId: null, sources: [source(id)], createdAt: new Date("2026-08-01"), updatedAt: new Date("2026-08-01"), ...extra });

it("filters expiry, state, superseded rows before ranking and bounds projections", async () => {
  const rows = [row("expired", "prefer expired", { expiresAt: new Date("2020-01-01") }), row("pending", "pending", { state: "PROPOSED" }), row("old", "old", { supersededById: "new" }), row("new", "prefer concise updates", { content: "x".repeat(2000) })];
  const result = await retrieveMemories({ adapter: db(rows), actor, query: "concise", now: new Date("2026-08-20"), limit: 2 });
  expect(result.items).toHaveLength(1);
  expect(result.items[0].content.length).toBeLessThanOrEqual(500);
  expect(result.items[0].sources).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ provenance: "USER_PROVIDED", sources: [{ entityType: "TASK", entityId: "new", href: "/tasks/new", sourceUpdatedAt: "2026-08-01T00:00:00.000Z" }] });
});

it("fails closed for malformed caller term arrays and never treats empty terms as matches", async () => {
  const rows = [row("term", "ordinary content", { kind: "PREFERENCE" }), row("other", "different content")];
  const result = await retrieveMemories({ adapter: db(rows), actor, query: "ordinary", terminologyTerms: ["", "   ", "x".repeat(101)], triggerTerms: ["   "] });
  expect(result.items[0].id).toBe("term");
  const emptyQuery = await retrieveMemories({ adapter: db(rows), actor, query: "", terminologyTerms: [""] });
  expect(emptyQuery.items).toHaveLength(2);
});

it("ranks exact terminology and triggers above broad scope matches", async () => {
  const rows = [row("team", "updates for project", { scope: "TEAM", ownerId: "team-alpha" }), row("term", "project status terminology", { kind: "TERMINOLOGY", scope: "TEAM", ownerId: "team-alpha", terminologyTerms: ["project status"] }), row("pref", "prefer concise project updates")];
  const result = await retrieveMemories({ adapter: db(rows), actor, query: "project status", limit: 3, canAccessSharedScope: (_, memory) => memory.ownerId === "team-alpha" });
  expect(result.items[0].id).toBe("term");
});

it("fails closed for absent shared access policy and allows only scoped shared access", async () => {
  const rows = [row("team", "team memory", { scope: "TEAM", ownerId: "team-alpha" }), row("mine", "mine")];
  expect((await retrieveMemories({ adapter: db(rows), actor })).items.map((item) => item.id)).toEqual(["mine"]);
  expect((await retrieveMemories({ adapter: db(rows), actor, canAccessSharedScope: (_, memory) => memory.ownerId === "team-alpha" })).items.map((item) => item.id).sort()).toEqual(["mine", "team"]);
});

it("re-verifies factual sources and excludes stale or contradicted entries", async () => {
  const rows = [row("fact", "Project is approved", { kind: "FACT" }), row("stale", "Old fact", { kind: "DECISION", freshness: "STALE" })];
  const checks: string[] = [];
  const result = await retrieveMemories({ adapter: db(rows), actor, sourceVerifier: async (_, ref) => { checks.push(ref.entityId); return ref.entityId === "fact" ? "CURRENT" : "CONTRADICTED"; } });
  expect(checks).toEqual(["fact"]);
  expect(result.items.map((item) => item.id)).toEqual(["fact"]);
  expect(result.reviewIds).toEqual(["stale"]);
});

it("fails closed for factual memories without a verifier and reports every non-current status", async () => {
  const factual = row("fact", "Project is approved", { kind: "FACT" });
  expect((await retrieveMemories({ adapter: db([factual]), actor })).items).toEqual([]);
  for (const status of ["INVISIBLE", "STALE", "CONTRADICTED"] as const) {
    const result = await retrieveMemories({ adapter: db([factual]), actor, sourceVerifier: async () => status });
    expect(result.items).toEqual([]);
    expect(result.reviewIds).toEqual(["fact"]);
  }
});

it("deduplicates normalized semantic content and ranks terms and scope precedence", async () => {
  const rows = [
    row("broad", "workspace project update", { scope: "WORKSPACE", ownerId: "workspace-1", updatedAt: new Date("2026-08-03") }),
    row("department", "department project update", { scope: "DEPARTMENT", ownerId: "dept-1", departmentId: "d1", updatedAt: new Date("2026-08-02") }),
    row("duplicate-old", "  Project Update ", { updatedAt: new Date("2026-08-01") }),
    row("term", "delivery vocabulary", { kind: "TERMINOLOGY", terminologyTerms: ["project update"], triggerTerms: ["status"] }),
  ];
  const result = await retrieveMemories({ adapter: db(rows), actor, query: "project update", canAccessSharedScope: (_, memory) => memory.ownerId === "workspace-1" || memory.ownerId === "dept-1", limit: 10 });
  expect(result.items.map((item) => item.id)).toEqual(["term", "duplicate-old", "department", "broad"]);
});

it("uses the memory ID as a deterministic tie-break for semantic duplicates", async () => {
  const timestamp = new Date("2026-08-01");
  const result = await retrieveMemories({ adapter: db([row("z-memory", "same content", { updatedAt: timestamp }), row("a-memory", " same   content ", { updatedAt: timestamp })]), actor });
  expect(result.items.map((item) => item.id)).toEqual(["a-memory"]);
});

it("does not return memories from another actor or department", async () => {
  const rows = [row("other", "private", { ownerId: "u2" }), row("dept", "department", { scope: "DEPARTMENT", ownerId: null, departmentId: "d2" }), row("mine", "mine")];
  const result = await retrieveMemories({ adapter: db(rows), actor });
  expect(result.items.map((item) => item.id)).toEqual(["mine"]);
});

it("ranks approved memories sourced from the explicit typed entity above unrelated content", async () => {
  const result = await retrieveMemories({
    adapter: db([row("unrelated", "General guidance", { sources: [source("other")] }), row("entity", "Specific guidance", { sources: [source("t1")] })]),
    actor,
    query: "TASK t1",
  });
  expect(result.items.map((item) => item.id)).toEqual(["entity", "unrelated"]);
});

it("marks a source-not-found factual memory for review without returning it", async () => {
  const memoryId = "missing-source";
  const result = await retrieveMemories({
    adapter: db([row(memoryId, "Project is approved", { kind: "FACT" })]),
    actor,
    sourceVerifier: async () => { throw { code: "NOT_FOUND" }; },
  });
  expect(result).toEqual({ items: [], reviewIds: [memoryId] });
});

it("propagates unexpected source verifier outages", async () => {
  const outage = Object.assign(new Error("database unavailable"), { code: "DATABASE_UNAVAILABLE" });
  await expect(retrieveMemories({
    adapter: db([row("outage", "Project is approved", { kind: "FACT" })]),
    actor,
    sourceVerifier: async () => { throw outage; },
  })).rejects.toBe(outage);
});

it("collects stale review IDs only after memory authorization", async () => {
  const result = await retrieveMemories({
    adapter: db([
      row("own-stale", "My old fact", { kind: "FACT", freshness: "STALE" }),
      row("foreign-user-stale", "Another actor old fact", { kind: "FACT", freshness: "STALE", ownerId: "u2" }),
      row("foreign-department-stale", "Another department old fact", { kind: "FACT", freshness: "STALE", scope: "DEPARTMENT", ownerId: null, departmentId: "d2" }),
    ]),
    actor,
  });

  expect(result.items).toEqual([]);
  expect(result.reviewIds).toEqual(["own-stale"]);
  expect(result.reviewIds).not.toContain("foreign-user-stale");
  expect(result.reviewIds).not.toContain("foreign-department-stale");
});
