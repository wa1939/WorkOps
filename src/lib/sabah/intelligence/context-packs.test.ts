import { describe, expect, it } from "vitest";
import { buildContextPack, type ContextPackDb, type ContextPackKind } from "./context-packs";
import { recommendAssignments } from "./recommendations";
import { createEntityFingerprint } from "./fingerprint";
import { normalizeWorkspaceText } from "./normalize";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { SourceRef } from "./contracts";

const actor: SabahActor = { id: "u1", role: "MEMBER", departmentIds: ["d1"] };
const source = (entityType: SourceRef["entityType"], entityId: string): SourceRef => ({ entityType, entityId, label: entityId, href: entityType === "PROJECT" ? `/projects/${entityId}` : entityType === "TASK" ? `/tasks/${entityId}` : entityType === "KPI" ? `/kpis/${entityId}` : entityType === "PMO_ACTION" ? `/pmo/actions/${entityId}` : `/internal/${entityType.toLowerCase()}/${entityId}`, sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `sum-${entityId}` });
const db: ContextPackDb = {
  authorize: async (refs) => refs.filter((item) => item.entityId !== "private"),
  load: async (item) => ({ ref: item, title: `${item.entityType} ${item.entityId}`, summary: "bounded summary", relationships: [], ...(item.entityType === "TASK" ? { lifecycleStatus: "TODO" } : {}), relations: item.entityType === "PROJECT" ? [{ kind: "PROJECT_OBJECTIVE", label: "Objective", title: "Objective", detail: "target", ref: source("KPI", "k1") }] : item.entityType === "TASK" ? [{ kind: "TASK_DEPENDENCY", label: "Dependency", title: "Dependency", ref: source("TASK", "t2") }, { kind: "TASK_ASSIGNMENT", label: "Owner", title: "u2" }] : item.entityType === "KPI" ? [{ kind: "KPI_UPDATE", label: "Update", title: "Update", detail: "Q1" }] : [{ kind: "PMO_CONTACT", label: "Contact", title: "Partner", detail: "Org" }] }),
  authorizeCandidates: async (_actor, ids) => ids.filter((id) => id === "u2" || id === "u3"),
  capacity: async () => [
    { userId: "u2", displayName: "Available", capacityHours: 35, loadHours: 10, leaveDays: 0 },
    { userId: "u3", displayName: "On leave", capacityHours: 35, loadHours: 30, leaveDays: 3 },
  ],
  getCurrentSource: async (item) => ({ ...item, sourceUpdatedAt: "2026-08-02T00:00:00.000Z", checksum: `fresh-${item.entityId}` }),
};

const kinds: ContextPackKind[] = ["TASK_CREATION", "PROJECT_PORTFOLIO", "TEAM_CAPACITY", "KPI_RECOVERY", "PMO_FOLLOW_UP", "FORM"];
describe("bounded context packs", () => {
  it("supports exactly the six pack kinds with typed bounded sections and fresh sources", async () => {
    for (const kind of kinds) {
      const pack = await buildContextPack(kind, { seedRefs: [source("PROJECT", "p1"), source("TASK", "private")], maxCharacters: 400, maxItems: 2 }, actor, db);
      expect(pack.kind).toBe(kind);
      expect(pack.sections.length).toBeLessThanOrEqual(2);
      expect(pack.sources.every((item) => item.entityId !== "private")).toBe(true);
      expect(pack.normalizedCharacterCount).toBeLessThanOrEqual(400);
      expect(pack.sources[0]).toMatchObject({ checksum: "sum-p1", sourceUpdatedAt: "2026-08-01T00:00:00.000Z" });
      expect(JSON.stringify(pack)).not.toContain("rawBody");
    }
  });

  it("returns deterministic capacity evidence and reasons, never an opaque score", async () => {
    const result = await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2", "u3"], effortHours: 8 }, actor, db);
    expect(result.recommendations.map((item) => item.userId)).toEqual(["u2", "u3"]);
    expect(result.recommendations[0].evidence).toMatchObject({ capacityHours: 35, loadHours: 10, leaveDays: 0 });
    expect(result.recommendations[0].reasons.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/performance|score|ranking/i);
  });

  it("emits kind-specific relation categories and explicit form field metadata", async () => {
    const seeds: Record<ContextPackKind, SourceRef> = { TASK_CREATION: source("TASK", "t1"), PROJECT_PORTFOLIO: source("PROJECT", "p1"), TEAM_CAPACITY: source("TASK", "t1"), KPI_RECOVERY: source("KPI", "k1"), PMO_FOLLOW_UP: source("PMO_ACTION", "a1"), FORM: source("TASK", "t1") };
    const expected = { TASK_CREATION: "TASK_DEPENDENCY", PROJECT_PORTFOLIO: "PROJECT_OBJECTIVE", TEAM_CAPACITY: "capacity", KPI_RECOVERY: "KPI_UPDATE", PMO_FOLLOW_UP: "PMO_CONTACT" } as const;
    for (const kind of kinds) {
      const pack = await buildContextPack(kind, { seedRefs: [seeds[kind]], query: "context", maxCharacters: 800, maxItems: 5 }, actor, db);
      expect(pack.normalizedCharacterCount).toBeLessThanOrEqual(800);
      if (kind === "FORM") expect(pack.sections[0]?.items[0]?.evidence).toMatchObject({ field: "title", sourceType: "TASK" });
      else if (kind === "TEAM_CAPACITY") expect(pack.sections[0]?.items.some((item) => item.evidence?.evidenceType === "capacity")).toBe(true);
      else expect(pack.sections[0]?.items.some((item) => item.evidence?.relationKind === expected[kind])).toBe(true);
    }
  });

  it("builds differentiated semantic sections and honors zero hard caps", async () => {
    const expected: Record<ContextPackKind, string> = {
      TASK_CREATION: "task-capacity", PROJECT_PORTFOLIO: "portfolio", TEAM_CAPACITY: "capacity", KPI_RECOVERY: "kpi-recovery", PMO_FOLLOW_UP: "pmo-follow-up", FORM: "form",
    };
    for (const kind of kinds) {
      const pack = await buildContextPack(kind, { seedRefs: [source("PROJECT", "p1")], maxItems: 0, maxCharacters: 0 }, actor, db);
      expect(pack.sections[0]?.type).toBe(expected[kind]);
      expect(pack.normalizedCharacterCount).toBe(0);
      expect(pack.truncated).toBe(true);
    }
  });

  it("rejects malformed recommendation inputs and sanitizes candidate evidence", async () => {
    const malformed: ContextPackDb = { ...db, capacity: async () => [
      { userId: "", displayName: "", capacityHours: Number.NaN, loadHours: -2, leaveDays: Number.POSITIVE_INFINITY },
      { userId: "u2", displayName: "Available", capacityHours: 35, loadHours: 10, leaveDays: 0 },
    ] };
    expect((await recommendAssignments({ taskRef: source("TASK", "private"), candidateUserIds: ["", "u2"], effortHours: 999999 }, actor, malformed)).recommendations).toEqual([]);
    expect((await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["", "u2"], effortHours: 8 }, actor, malformed)).recommendations).toEqual([]);
  });

  it.each([1, 1.9, 0])("hard-bounds tiny pack caps %s", async (limit) => {
    const pack = await buildContextPack("FORM", { seedRefs: [source("TASK", "t1")], maxCharacters: limit }, actor, db);
    expect(pack.normalizedCharacterCount).toBeLessThanOrEqual(limit === 1.9 ? 1 : limit);
    expect(pack.normalizedCharacterCount).toBe(0);
  });

  it("fails closed for malformed current-source label and timestamp metadata", async () => {
    const malformedLabelValue: unknown = 42;
    const malformedLabel: ContextPackDb = { ...db, getCurrentSource: async (item) => ({ ...item, label: malformedLabelValue as SourceRef["label"], sourceUpdatedAt: "2026-08-02T00:00:00.000Z" }) };
    expect((await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2"], effortHours: 2 }, actor, malformedLabel)).recommendations).toEqual([]);
    const malformedTimestamp: ContextPackDb = { ...db, getCurrentSource: async (item) => ({ ...item, label: "Task", sourceUpdatedAt: "not-a-date" }) };
    expect((await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2"], effortHours: 2 }, actor, malformedTimestamp)).recommendations).toEqual([]);
  });

  it("checksums the exact truncated long label returned to callers", async () => {
    const longLabel = "L".repeat(140);
    const longLabelDb: ContextPackDb = { ...db, getCurrentSource: async (item) => ({ ...item, label: longLabel, sourceUpdatedAt: "2026-08-02T00:00:00.000Z" }) };
    const result = await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2"], effortHours: 2 }, actor, longLabelDb);
    const returned = result.sources[0];
    expect(returned?.label).toBe(normalizeWorkspaceText(longLabel)?.slice(0, 120));
    const returnedLabel = returned?.label ?? "";
    const returnedTimestamp = returned?.sourceUpdatedAt ?? "";
    expect(returned?.checksum).toBe(createEntityFingerprint({ entityType: "TASK", entityId: "t1", label: returnedLabel, updatedAt: returnedTimestamp }));
    expect(returned?.checksum).not.toBe(createEntityFingerprint({ entityType: "TASK", entityId: "t1", label: longLabel, updatedAt: "2026-08-02T00:00:00.000Z" }));
  });

  it("uses a fresh server source and fails closed when it is unavailable", async () => {
    const result = await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2"], effortHours: 2 }, actor, db);
    expect(result.sources[0]).toMatchObject({ href: "/tasks/t1", sourceUpdatedAt: "2026-08-02T00:00:00.000Z", checksum: createEntityFingerprint({ entityType: "TASK", entityId: "t1", label: "t1", updatedAt: "2026-08-02T00:00:00.000Z" }) });
    const unavailable: ContextPackDb = { ...db, getCurrentSource: async () => null };
    expect((await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2"], effortHours: 2 }, actor, unavailable)).recommendations).toEqual([]);
    const invalidFallback: ContextPackDb = { ...db, load: async () => null, authorize: async () => [{ ...source("TASK", "t1"), href: "", checksum: "" }] };
    expect((await buildContextPack("FORM", { seedRefs: [source("TASK", "t1")] }, actor, invalidFallback)).sources).toEqual([]);
  });

  it("recomputes a forged current-source checksum", async () => {
    const forged: ContextPackDb = { ...db, getCurrentSource: async (item) => ({ ...item, sourceUpdatedAt: "2026-08-02T00:00:00.000Z", checksum: "forged" }) };
    const result = await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2"], effortHours: 2 }, actor, forged);
    expect(result.sources[0]?.checksum).not.toBe("forged");
    expect(result.sources[0]?.checksum).toBe(createEntityFingerprint({ entityType: "TASK", entityId: "t1", label: "t1", updatedAt: "2026-08-02T00:00:00.000Z" }));
  });

  it("fails closed on malformed fallback seed arrays before authorization", async () => {
    const authorized: unknown[][] = [];
    const guarded: ContextPackDb = { ...db, load: async () => null, authorize: async (refs) => { authorized.push(refs); return refs; } };
    const malformed = { seedRefs: [null, { entityType: "TASK" }, { entityType: "TASK", entityId: "bad" }] } as unknown as Parameters<typeof buildContextPack>[1];
    const result = await buildContextPack("FORM", malformed, actor, guarded);
    expect(result.sources).toEqual([]);
    expect(authorized).toEqual([]);
  });

  it("does not authorize an empty fallback seed batch at zero source budget", async () => {
    const authorized: SourceRef[][] = [];
    const guarded: ContextPackDb = { ...db, load: async () => null, authorize: async (refs) => { authorized.push(refs); return refs; } };
    const result = await buildContextPack("FORM", { seedRefs: [source("TASK", "t1")], maxSources: 0 }, actor, guarded);
    expect(result.sources).toEqual([]);
    expect(authorized).toEqual([]);
  });

  it("does not authorize capacity candidates when no valid capacity rows exist", async () => {
    const authorized: string[][] = [];
    const guarded: ContextPackDb = { ...db, capacity: async () => [], authorizeCandidates: async (_actor, ids) => { authorized.push(ids); return ids; } };
    const result = await buildContextPack("TEAM_CAPACITY", { seedRefs: [source("TASK", "t1")] }, actor, guarded);
    expect(result.sections[0]?.items.some((item) => item.evidence?.evidenceType === "capacity")).toBe(false);
    expect(authorized).toEqual([]);
  });

  it.each([null, undefined, "malformed"])("fails closed for malformed runtime request container %s without authorization", async (request) => {
    const authorized: SourceRef[][] = [];
    const loaded: SourceRef[] = [];
    const guarded: ContextPackDb = { ...db, load: async (ref) => { loaded.push(ref); return null; }, authorize: async (refs) => { authorized.push(refs); return refs; } };
    const runtimeRequest: unknown = request;
    const result = await buildContextPack("FORM", runtimeRequest as Parameters<typeof buildContextPack>[1], actor, guarded);
    expect(result.sources).toEqual([]);
    expect(result.sections[0]?.items).toEqual([]);
    expect(authorized).toEqual([]);
    expect(loaded).toEqual([]);
  });

  it("rejects malformed candidate IDs before authorization", async () => {
    let called = false;
    const guarded: ContextPackDb = { ...db, authorizeCandidates: async () => { called = true; return ["u2"]; } };
    expect((await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2", "bad id"], effortHours: 2 }, actor, guarded)).recommendations).toEqual([]);
    expect(called).toBe(false);
  });

  it("filters capacity rows using explicit candidate authorization", async () => {
    const denied: ContextPackDb = { ...db, authorizeCandidates: async (_actor, ids) => ids.filter((id) => id === "u2"), capacity: async () => [
      { userId: "u2", displayName: "Allowed", capacityHours: 35, loadHours: 10, leaveDays: 0 },
      { userId: "u9", displayName: "Unauthorized", capacityHours: 35, loadHours: 10, leaveDays: 0 },
    ] };
    const pack = await buildContextPack("TEAM_CAPACITY", { seedRefs: [source("TASK", "t1")], maxCharacters: 5000 }, actor, denied);
    expect(JSON.stringify(pack)).not.toContain("u9");
  });

  it("fails closed when capacity authorization returns malformed output", async () => {
    const malformed: ContextPackDb = { ...db, authorizeCandidates: async () => ["not requested"] };
    const pack = await buildContextPack("TEAM_CAPACITY", { seedRefs: [source("TASK", "t1")], maxCharacters: 5000 }, actor, malformed);
    expect(pack.sections[0]?.items.some((item) => item.evidence?.evidenceType === "capacity")).toBe(false);
  });

  it("keeps recommendations when caller metadata already matches current source", async () => {
    const matching: ContextPackDb = { ...db, getCurrentSource: async (item) => item };
    const result = await recommendAssignments({ taskRef: source("TASK", "t1"), candidateUserIds: ["u2"], effortHours: 2 }, actor, matching);
    expect(result.recommendations).toHaveLength(1);
  });

  it("counts returned source and form metadata in the normalized character bound", async () => {
    const pack = await buildContextPack("FORM", { seedRefs: [source("TASK", "t1")], maxCharacters: 2000 }, actor, db);
    const item = pack.sections[0]?.items[0];
    expect(item?.evidence).toMatchObject({ sourceType: "TASK", sourceId: "t1", field: "title", availableFields: ["title", "summary", "status"] });
    expect(pack.normalizedCharacterCount).toBeGreaterThan("TASKt1titlesummarystatus".length);
  });
});
