import { describe, expect, it } from "vitest";
import { rankAuthorizedCandidates, type EntityKey, type RankCandidate } from "./rank";
import type { SourceRef } from "./contracts";

const source = (entityId: string, label = entityId): SourceRef => ({ entityType: "PROJECT", entityId, label, href: `/projects/${entityId}`, sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `c-${entityId}` });
const candidate = (entityId: string, overrides: Partial<RankCandidate> = {}): RankCandidate => ({ source: source(entityId), ...overrides });

describe("rankAuthorizedCandidates", () => {
  it("prioritizes exact id and title, then fingerprints and normalized Arabic matches", () => {
    const result = rankAuthorizedCandidates({ query: "قياس", candidates: [
      candidate("other", { title: "قياس وتعزيز" }),
      candidate("exact", { title: "other", exactId: true }),
      candidate("finger", { fingerprintMatch: true }),
      candidate("arabic", { title: "قِياس وتعزيز" }),
    ], limit: 10 });
    expect(result.items.map((item) => item.source.entityId)).toEqual(["exact", "finger", "arabic", "other"]);
  });

  it("applies filters, stale penalty and freshness weighting with deterministic ties", () => {
    const result = rankAuthorizedCandidates({ query: "plan", filters: { status: "OPEN" }, candidates: [
      candidate("stale", { title: "plan", status: "OPEN", staleAt: "2026-08-01T00:00:00.000Z", lexicalScore: 1 }),
      candidate("fresh-b", { title: "plan", status: "OPEN", sourceUpdatedAt: "2026-08-02T00:00:00.000Z", lexicalScore: 1 }),
      candidate("fresh-a", { title: "plan", status: "OPEN", sourceUpdatedAt: "2026-08-02T00:00:00.000Z", lexicalScore: 1 }),
      candidate("closed", { title: "plan", status: "CLOSED", lexicalScore: 100 }),
    ], limit: 10 });
    expect(result.items.map((item) => item.source.entityId)).toEqual(["fresh-a", "fresh-b", "stale"]);
  });

  it("uses typed pair keys for authorization and semantic scores", () => {
    const project = candidate("same");
    const task = { ...candidate("same"), source: { ...project.source, entityType: "TASK" as const, href: "/tasks/same" } };
    const result = rankAuthorizedCandidates({ query: "same", candidateIds: new Set<EntityKey>(["PROJECT:same"]), semanticScores: new Map<EntityKey, number>([["TASK:same", 100]]), candidates: [project, task], limit: 10 });
    expect(result.items.map((item) => `${item.source.entityType}:${item.source.entityId}`)).toEqual(["PROJECT:same"]);
  });

  it("rejects malformed cursors and encodes score plus typed key in the cursor", () => {
    expect(() => rankAuthorizedCandidates({ query: "x", candidates: [candidate("a")], cursor: "not-base64-json" })).toThrow();
    const result = rankAuthorizedCandidates({ query: "x", candidates: [candidate("a"), candidate("b")], limit: 1 });
    expect(result.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(result.nextCursor).not.toBe("a");
  });

  it("generates all trigram windows and keeps freshness and semantic scores finite", () => {
    const result = rankAuthorizedCandidates({ query: "abcd", candidates: [
      candidate("all", { text: "abc bcd" }),
      candidate("partial", { text: "abc" }),
      candidate("bad", { semanticScore: Number.NaN, sourceUpdatedAt: "invalid-date" }),
    ], limit: 10, now: new Date("2026-08-10T00:00:00.000Z") });
    expect(result.items.map((item) => item.source.entityId)).toEqual(["all", "partial", "bad"]);
    expect(result.items.every((item) => Number.isFinite(item.score))).toBe(true);
  });

  it("restricts semantic scores, supports stable composite cursor pagination, and reports hasMore truthfully", () => {
    const candidates = [candidate("b", { lexicalScore: 1 }), candidate("c", { lexicalScore: 1 }), candidate("a", { lexicalScore: 1 }), candidate("outside", { semanticScore: 100 })];
    const fixedNow = new Date("2026-08-10T00:00:00.000Z");
    const first = rankAuthorizedCandidates({ query: "x", candidateIds: new Set<EntityKey>(["PROJECT:a", "PROJECT:b", "PROJECT:c"]), semanticScores: new Map<EntityKey, number>([["PROJECT:c", 1], ["PROJECT:outside", 1]]), candidates, limit: 1, now: fixedNow });
    const result = rankAuthorizedCandidates({ query: "x", candidateIds: new Set<EntityKey>(["PROJECT:a", "PROJECT:b", "PROJECT:c"]), semanticScores: new Map<EntityKey, number>([["PROJECT:c", 1], ["PROJECT:outside", 1]]), candidates, limit: 2, cursor: first.nextCursor, now: fixedNow });
    expect(first.items.map((item) => item.source.entityId)).toEqual(["c"]);
    expect(first.nextCursor).toBeDefined();
    expect(result.items.map((item) => item.source.entityId)).toEqual(["a", "b"]);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeUndefined();
  });
});
