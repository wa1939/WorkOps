import { describe, expect, it } from "vitest";
import { createPrismaGraphDb, loadWorkspaceGraph, type GraphDb, type GraphRecord, type GraphRelation } from "./graph";
import type { PrismaClient } from "@prisma/client";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { SourceRef } from "./contracts";

const actor: SabahActor = { id: "u1", role: "MEMBER", departmentIds: ["d1"] };
const ref = (entityType: SourceRef["entityType"], entityId: string): SourceRef => ({ entityType, entityId, label: entityId, href: entityType === "PROJECT" ? `/projects/${entityId}` : entityType === "TASK" ? `/tasks/${entityId}` : entityType === "KPI" ? `/kpis/${entityId}` : entityType === "PMO_ACTION" ? `/pmo/actions/${entityId}` : `/internal/${entityType.toLowerCase()}/${entityId}`, sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `c-${entityId}` });

const graphDb = (records: Record<string, unknown>): GraphDb => ({
  authorize: async (seeds, _actor) => seeds.filter((seed) => seed.entityId !== "private"),
  load: async (seed) => { const record = records[`${seed.entityType}:${seed.entityId}`] as GraphRecord | null; return record && seed.entityType === "TASK" && !("lifecycleStatus" in record) ? { ...record, lifecycleStatus: "TODO" } : record; },
  getCurrentSource: async (seed) => seed,
});

describe("bounded authorized workspace graph", () => {
  it("authorizes exact referenced records beyond the first page without admitting private or missing rows", async () => {
    const records = Array.from({ length: 101 }, (_, index) => ({ id: `task-${String(index).padStart(3, "0")}`, status: "TODO", isPrivate: false, createdById: null, assignments: [] }));
    const privateRow = { id: "private", status: "TODO", isPrivate: true, createdById: "other", assignments: [] };
    const adapter = createPrismaGraphDb({} as PrismaClient, { task: {
      findMany: async ({ take }) => records.slice(0, take),
      findUnique: async ({ where }) => [...records, privateRow].find((row) => row.id === where.id) ?? null,
    } });
    const late = ref("TASK", "task-100");
    expect(await adapter.authorize([late, ref("TASK", "private"), ref("TASK", "missing")], actor)).toEqual([late]);
  });

  it("loads a linked support request beyond the first authorization row while retaining its access guard", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const allowed = { id: "z-support", title: "Visible support", description: null, status: "OPEN", updatedAt: now, createdAt: now, requesterId: "other", claimedById: null, task: null, project: { id: "p1", name: "Project", status: "ACTIVE", ownerId: null, updatedAt: now, createdAt: now } };
    const denied = { ...allowed, id: "denied-support", project: { ...allowed.project, ownerId: "other" } };
    const lookup = async ({ where }: { where: { id: string } }) => [allowed, denied].find((row) => row.id === where.id) ?? null;
    const adapter = createPrismaGraphDb({ supportRequest: { findUnique: lookup } } as unknown as PrismaClient, { supportRequest: {
      findMany: async () => [{ ...allowed, id: "a-support" }, allowed, denied],
      findUnique: lookup,
    } });
    expect((await adapter.load(ref("SUPPORT_REQUEST", "z-support"), actor))?.ref.entityId).toBe("z-support");
    expect(await adapter.load(ref("SUPPORT_REQUEST", "denied-support"), actor)).toBeNull();
  });

  it("walks project relationships and task/PMO/KPI evidence without private bodies", async () => {
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, {}, graphDb({
      "PROJECT:p1": { ref: ref("PROJECT", "p1"), title: "Portfolio", relationships: [ref("TASK", "t1"), ref("KPI", "k1")] },
      "TASK:t1": { ref: ref("TASK", "t1"), title: "Deliver", relationships: [ref("PMO_ACTION", "a1"), ref("TASK", "t1")], evidence: { owners: ["u1"], loadHours: 5, leaveDays: 1, comments: ["safe summary"], rawBody: "must not appear" }, privateBody: "must not appear" },
      "KPI:k1": { ref: ref("KPI", "k1"), title: "On time", relationships: [] },
      "PMO_ACTION:a1": { ref: ref("PMO_ACTION", "a1"), title: "Follow up", relationships: [ref("TASK", "t1")] },
    }));
    expect(result.nodes.map((node) => node.ref.entityId)).toEqual(["p1", "k1", "t1", "a1"]);
    expect(result.nodes.find((node) => node.ref.entityId === "t1")?.evidence).toMatchObject({ loadHours: 5, leaveDays: 1 });
    expect(JSON.stringify(result)).not.toContain("must not appear");
    expect(result.truncated).toBe(false);
  });

  it("is deterministic, cycle-safe, and truthfully reports depth/node/source/character caps", async () => {
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1"), ref("PROJECT", "private")], actor, { maxDepth: 1, maxNodes: 2, maxSources: 1, maxNormalizedCharacters: 400 }, graphDb({
      "PROJECT:p1": { ref: ref("PROJECT", "p1"), title: "A very long project title", relationships: [ref("TASK", "t1"), ref("KPI", "k1")] },
      "TASK:t1": { ref: ref("TASK", "t1"), title: "Task", relationships: [ref("PROJECT", "p1")] },
      "KPI:k1": { ref: ref("KPI", "k1"), title: "KPI", relationships: [] },
    }));
    expect(result.nodes).toHaveLength(1);
    expect(result.sources).toHaveLength(1);
    expect(result.normalizedCharacterCount).toBeLessThanOrEqual(400);
    expect(result.truncated).toBe(true);
    expect(result.nodes.every((node) => node.depth <= 1)).toBe(true);
  });

  it("clamps invalid and oversized limits to safe server bounds", async () => {
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, { maxDepth: 999, maxNodes: 9999, maxSources: -1, maxNormalizedCharacters: Number.POSITIVE_INFINITY }, graphDb({ "PROJECT:p1": { ref: ref("PROJECT", "p1"), title: "p", relationships: [] } }));
    expect(result.nodes[0].depth).toBe(0);
    expect(result.sources).toHaveLength(1);
    expect(result.normalizedCharacterCount).toBeGreaterThan(0);
  });

  it("uses typed schema relations, verifies returned refs, and treats source caps globally", async () => {
    const loaded: string[] = [];
    const relation: GraphRelation = { kind: "PROJECT_OBJECTIVE", label: "Objective", title: "Improve", detail: "bounded" };
    const db: GraphDb = {
      authorize: async (refs) => refs,
      load: async (requested) => { loaded.push(`${requested.entityType}:${requested.entityId}`); return requested.entityId === "p1" ? { ref: ref("TASK", "wrong"), title: "bad", relationships: [], relations: [relation] } : null; },
      getCurrentSource: async (requested) => requested,
    };
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, { maxSources: 1 }, db);
    expect(result.nodes).toEqual([]);
    expect(loaded).toEqual(["PROJECT:p1"]);
    expect(result.sources).toEqual([]);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.9])("enforces explicit character limit %s", async (limit) => {
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, { maxNormalizedCharacters: limit }, graphDb({ "PROJECT:p1": { ref: ref("PROJECT", "p1"), title: "project", relationships: [] } }));
    expect(result.normalizedCharacterCount).toBeLessThanOrEqual(limit === 0 ? 0 : (limit === 1.9 ? 1 : (typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? limit : 20_000)));
  });

  it("authorizes every returned relationship ref and drops denied relation evidence", async () => {
    const denied = ref("KPI", "denied");
    const calls: SourceRef[][] = [];
    const db: GraphDb = {
      authorize: async (refs) => { calls.push(refs); return refs.filter((r) => r.entityId !== "denied"); },
      load: async (requested) => requested.entityType === "PROJECT" ? {
        ref: requested, title: "Project", relationships: [denied],
        relations: [{ kind: "OBJECTIVE_KPI", label: "KPI", title: "Secret", ref: denied }],
      } : null,
      getCurrentSource: async (requested) => requested,
    };
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, {}, db);
    expect(calls.some((batch) => batch.some((r) => r.entityId === "denied"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("denied");
  });

  it("maps all Prisma branches with bounded deterministic nested selectors and canonical fresh refs", async () => {
    const calls: Array<{ model: string; args: { select?: Record<string, unknown> } }> = [];
    const boundedCollections = new Set(["objectives", "outputs", "risks", "stages", "tasks", "members", "assignments", "comments", "dependencies", "blockers", "handoverTasks", "updates", "projectObjectives", "followUpEvents", "evidence"]);
    const model = (name: string, row: unknown) => ({ findUnique: async (args: { select: Record<string, unknown> }) => { calls.push({ model: name, args }); return row; } });
    const now = new Date("2026-08-01T00:00:00.000Z");
    const fake = {
      project: model("project", { id: "p1", name: "Project", description: "desc", status: "Active", updatedAt: now, createdAt: now, objectives: [{ id: "o1", statement: "Objective", measure: "Measure", kpi: { id: "k1", name: "KPI", updatedAt: now } }], outputs: [{ id: "o2", title: "Output", description: "Done", status: "PLANNED", updatedAt: now }], risks: [{ id: "r1", title: "Risk", description: "Risk", status: "OPEN", updatedAt: now }], stages: [{ id: "s1", name: "Stage", status: "ACTIVE", updatedAt: now }], tasks: [{ id: "t1", title: "Task", updatedAt: now, createdAt: now }], members: [{ userId: "u1", role: "Member" }] }),
      task: model("task", { id: "t1", title: "Task", description: "desc", status: "TODO", isPrivate: false, updatedAt: now, createdAt: now, effortHours: 4, actualHours: null, projectId: "p1", stageId: "s1", kpiId: "k1", project: { id: "p1", name: "Project", updatedAt: now, createdAt: now }, stage: { id: "s1", name: "Stage", updatedAt: now, createdAt: now }, kpi: { id: "k1", name: "KPI", updatedAt: now, createdAt: now }, assignments: [{ userId: "u1", createdAt: now }], comments: [{ id: "c1", createdAt: now }], dependencies: [{ dependsOn: { id: "t2", title: "Dependency", updatedAt: now, createdAt: now } }], blockers: [{ task: { id: "t3", title: "Blocker", updatedAt: now, createdAt: now } }], handoverTasks: [{ handover: { leaveRequest: { id: "l1", status: "Approved", startAt: now, endAt: now, userId: "u1", delegateId: "u2", createdAt: now } } }], externalAction: { id: "a1", ownerId: "u1", externalContactId: "c1", closedAt: null, updatedAt: now, createdAt: now } }),
      kPI: model("kPI", { id: "k1", name: "KPI", objective: "Objective", status: "AT_RISK", updatedAt: now, createdAt: now, updates: [{ id: "ku1", note: "Update", period: "Q1", createdAt: now }], projectObjectives: [{ id: "o1", projectId: "p1", statement: "Objective", updatedAt: now }], tasks: [{ id: "t1", title: "Task", updatedAt: now, createdAt: now }] }),
      externalAction: model("externalAction", { id: "a1", taskId: "t1", ownerId: "u1", externalContactId: "c1", closedAt: null, updatedAt: now, createdAt: now, task: { id: "t1", title: "Task", updatedAt: now, createdAt: now }, owner: { id: "u1", name: "Owner" }, externalContact: { id: "c1", name: "Contact", organization: "Org", isArchived: false }, followUpEvents: [{ id: "f1", scheduledDate: now, ownerId: "u1", createdAt: now }], evidence: [{ id: "e1", label: "Evidence", url: "https://example.test", createdAt: now }] }),
    } as unknown as PrismaClient;
    const adapter = createPrismaGraphDb(fake, { task: { findMany: async () => [], findUnique: async () => ({ id: "t1", status: "TODO", isPrivate: false, createdById: null, assignments: [] }) } });
    const records = await Promise.all([adapter.load(ref("PROJECT", "p1"), actor), adapter.load(ref("TASK", "t1"), actor), adapter.load(ref("KPI", "k1"), actor), adapter.load(ref("PMO_ACTION", "a1"), actor)]);
    expect(records.every(Boolean)).toBe(true);
    expect(records[0]?.relations?.map((r) => r.kind)).toContain("PROJECT_OBJECTIVE");
    expect(records[1]?.relations?.map((r) => r.kind)).toEqual(expect.arrayContaining(["TASK_HANDOVER", "TASK_LEAVE", "TASK_EXTERNAL_ACTION"]));
    expect(records[2]?.relations?.map((r) => r.kind)).toContain("KPI_UPDATE");
    expect(records[3]?.relations?.map((r) => r.kind)).toContain("PMO_CONTACT");
    expect(records.map((r) => r?.ref.href)).toEqual(["/projects/p1", "/tasks/t1", "/kpis/k1", "/pmo/actions/a1"]);
    expect(records.every((r) => Boolean(r?.ref.sourceUpdatedAt && r.ref.checksum))).toBe(true);
    for (const call of calls) for (const [name, value] of Object.entries(call.args.select ?? {})) if (boundedCollections.has(name)) { expect(value).toMatchObject({ take: 20 }); expect(value).toHaveProperty("orderBy"); }
  });

  it.each([1, 1.9])("hard-bounds tiny graph caps %s", async (limit) => {
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, { maxNormalizedCharacters: limit }, graphDb({ "PROJECT:p1": { ref: ref("PROJECT", "p1"), title: "project", relationships: [] } }));
    expect(result.normalizedCharacterCount).toBe(0);
    expect(result.nodes).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it("omits malformed generic refs", async () => {
    const malformed = { ...ref("TASK", "t1"), href: "", sourceUpdatedAt: "", checksum: "" };
    const result = await loadWorkspaceGraph([malformed], actor, {}, { ...graphDb({}), authorize: async (refs) => refs, load: async () => null });
    expect(result.nodes).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it("does not emit a Project ref for a stage relation", async () => {
    const result = await loadWorkspaceGraph([ref("TASK", "t1")], actor, {}, { ...graphDb({ "TASK:t1": { ref: ref("TASK", "t1"), title: "Task", relationships: [], relations: [{ kind: "TASK_STAGE", label: "Stage", title: "Stage", ref: ref("PROJECT", "stage-id") }] } }) });
    expect(result.nodes[0]?.relations?.find((item) => item.kind === "TASK_STAGE")?.ref).toBeUndefined();
  });

  it("fails closed for missing or archived PMO related rows", async () => {
    const model = (row: unknown) => ({ findUnique: async () => row });
    const missing = createPrismaGraphDb({ externalAction: model({ id: "a1", closedAt: null, updatedAt: new Date(), createdAt: new Date(), task: null, owner: null, externalContact: null, followUpEvents: [], evidence: [] }) } as unknown as PrismaClient, {});
    expect(await missing.load(ref("PMO_ACTION", "a1"), actor)).toBeNull();
    const archived = createPrismaGraphDb({ externalAction: model({ id: "a1", closedAt: null, updatedAt: new Date(), createdAt: new Date(), task: { id: "t1", title: "Task", updatedAt: new Date(), createdAt: new Date() }, owner: { id: "u1", name: "Owner" }, externalContact: { id: "c1", name: "Contact", organization: "Org", isArchived: true }, followUpEvents: [], evidence: [] }) } as unknown as PrismaClient, {});
    expect(await archived.load(ref("PMO_ACTION", "a1"), actor)).toBeNull();
  });

  it("drops malformed runtime relation objects without throwing", async () => {
    const malformed: unknown = { kind: "PROJECT_OBJECTIVE" };
    const record = { ref: ref("PROJECT", "p1"), title: "Project", relationships: [], relations: [malformed] } as unknown as GraphRecord;
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, {}, { ...graphDb({}), load: async () => record });
    expect(result.nodes[0]?.relations).toEqual([]);
  });

  it("authorizes relation refs and traverses authorized relations into nodes and sources", async () => {
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, {}, graphDb({
      "PROJECT:p1": { ref: ref("PROJECT", "p1"), title: "Project", relationships: [], relations: [{ kind: "OBJECTIVE_KPI", label: "KPI", title: "KPI", ref: ref("KPI", "k1") }] },
      "KPI:k1": { ref: ref("KPI", "k1"), title: "KPI", relationships: [] },
    }));
    expect(result.nodes.map((node) => node.ref.entityId)).toContain("k1");
    expect(result.sources.map((source) => source.entityId)).toContain("k1");
  });

  it("authorizes a current task before reading its title and rejects closed tasks", async () => {
    const order: string[] = [];
    const now = new Date("2026-08-01T00:00:00.000Z");
    const client = { task: { findUnique: async () => { order.push("detail"); return { id: "t1", title: "Closed", status: "CLOSED", updatedAt: now, createdAt: now }; } } } as unknown as PrismaClient;
    const scopeDb = { task: { findMany: async () => { throw new Error("Unexpected scope scan"); }, findUnique: async () => { order.push("authorize"); return { id: "t1", status: "CLOSED", isPrivate: false, createdById: null, assignments: [] }; } } };
    const adapter = createPrismaGraphDb(client, scopeDb);
    expect(await adapter.getCurrentSource(ref("TASK", "t1"), actor)).toBeNull();
    expect(order).toEqual(["authorize"]);
  });

  it("omits ordinary closed Task detail after safe lifecycle metadata gate", async () => {
    const calls: string[] = [];
    const now = new Date("2026-08-01T00:00:00.000Z");
    const client = { task: { findUnique: async (args: { select?: Record<string, unknown> }) => {
      calls.push(args.select?.title ? "detail" : "lifecycle");
      return args.select?.title ? { id: "t1", title: "Closed title", status: "CLOSED", updatedAt: now, createdAt: now } : { id: "t1", status: "CLOSED" };
    } } } as unknown as PrismaClient;
    const adapter = createPrismaGraphDb(client, { task: { findMany: async () => [{ id: "t1", isPrivate: false, createdById: null, assignments: [] }], findUnique: async () => ({ id: "t1", isPrivate: false, createdById: null, assignments: [] }) } });
    const result = await loadWorkspaceGraph([ref("TASK", "t1")], actor, {}, adapter);
    expect(result.nodes).toEqual([]);
    expect(calls).toEqual(["lifecycle"]);
    expect(JSON.stringify(result)).not.toContain("Closed title");
  });

  it("fails closed for a closed Task returned by a generic GraphDb", async () => {
    const result = await loadWorkspaceGraph([ref("TASK", "t1")], actor, {}, graphDb({
      "TASK:t1": { ref: ref("TASK", "t1"), title: "Closed generic title", summary: "Closed generic details", relationships: [], lifecycleStatus: "CLOSED" },
    }));
    expect(result.nodes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Closed generic");
  });

  it("does not authorize an empty seed batch when maxSources is zero", async () => {
    const calls: SourceRef[][] = [];
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, { maxSources: 0 }, {
      ...graphDb({}),
      authorize: async (refs) => { calls.push(refs); return refs; },
    });
    expect(result.nodes).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("rejects relations whose normalized labels or titles become empty", async () => {
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, {}, {
      ...graphDb({}),
      load: async () => ({ ref: ref("PROJECT", "p1"), title: "Project", relationships: [], relations: [
        { kind: "PROJECT_OBJECTIVE", label: String.fromCharCode(0), title: "Valid" },
        { kind: "PROJECT_OBJECTIVE", label: "Valid", title: String.fromCharCode(0) },
      ] }),
    });
    expect(result.nodes[0]?.relations).toEqual([]);
  });

  it("propagates unexpected PMO shell storage failures", async () => {
    const outage = Object.assign(new Error("shell failure"), { code: "DATABASE_UNAVAILABLE" });
    const adapter = createPrismaGraphDb({ externalAction: { findUnique: async () => { throw outage; } } } as unknown as PrismaClient, {});
    await expect(adapter.load(ref("PMO_ACTION", "a1"), actor)).rejects.toBe(outage);
  });

  it("keeps PMO nested detail reads after related-task authorization", async () => {
    const order: string[] = [];
    const now = new Date("2026-08-01T00:00:00.000Z");
    const calls: Array<{ select?: Record<string, unknown> }> = [];
    const client = { externalAction: { findUnique: async (args: { select?: Record<string, unknown> }) => {
      calls.push(args); order.push("pmo-shell");
      return { id: "a1", taskId: "t1", ownerId: "u1", externalContactId: "c1", closedAt: null, updatedAt: now, createdAt: now, task: { id: "t1" } };
    } }, task: { findUnique: async (args: { select?: Record<string, unknown> }) => {
      order.push("task-authorize");
      if (args.select?.title) order.push("task-detail");
      return args.select?.title ? { id: "t1", title: "Task", status: "TODO", updatedAt: now, createdAt: now } : { id: "t1", isPrivate: false, createdById: null, assignments: [] };
    } } } as unknown as PrismaClient;
    const scopeDb = { task: { findMany: async () => [], findUnique: async () => { order.push("task-authorize"); return { id: "t1", isPrivate: false, createdById: null, assignments: [] }; } } };
    const adapter = createPrismaGraphDb(client, scopeDb);
    await adapter.load(ref("PMO_ACTION", "a1"), actor);
    const first = calls[0]?.select ?? {};
    expect(first).not.toHaveProperty("owner");
    expect(first).not.toHaveProperty("externalContact");
    expect(first).not.toHaveProperty("followUpEvents");
    expect(first).not.toHaveProperty("evidence");
    expect(order.indexOf("task-authorize")).toBeGreaterThan(order.indexOf("pmo-shell"));
    expect(order.indexOf("task-detail")).toBeGreaterThan(order.indexOf("task-authorize"));
    expect(calls.some((call) => call.select?.owner && call.select?.externalContact)).toBe(true);
  });

  it("propagates unexpected PMO task and detail storage failures", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const shell = { id: "a1", taskId: "t1", closedAt: null };
    const visibleTask = { id: "t1", isPrivate: false, createdById: null, assignments: [] };
    const visibleScope = { task: { findMany: async () => [], findUnique: async () => visibleTask } };

    const scopeOutage = Object.assign(new Error("scope unavailable"), { code: "SCOPE_UNAVAILABLE" });
    const scopeFailure = createPrismaGraphDb({ externalAction: { findUnique: async () => shell } } as unknown as PrismaClient, {
      task: { findMany: async () => [], findUnique: async () => { throw scopeOutage; } },
    });
    await expect(scopeFailure.load(ref("PMO_ACTION", "a1"), actor)).rejects.toBe(scopeOutage);

    const taskOutage = Object.assign(new Error("task storage unavailable"), { code: "DATABASE_UNAVAILABLE" });
    const taskFailure = createPrismaGraphDb({
      externalAction: { findUnique: async () => shell },
      task: { findUnique: async () => { throw taskOutage; } },
    } as unknown as PrismaClient, visibleScope);
    await expect(taskFailure.load(ref("PMO_ACTION", "a1"), actor)).rejects.toBe(taskOutage);

    const detailOutage = Object.assign(new Error("detail storage unavailable"), { code: "DATABASE_UNAVAILABLE" });
    let detailCalls = 0;
    const detailFailure = createPrismaGraphDb({
      externalAction: { findUnique: async () => { detailCalls += 1; if (detailCalls > 1) throw detailOutage; return shell; } },
      task: { findUnique: async (args: { select?: Record<string, unknown> }) => args.select?.title ? { id: "t1", title: "Task", status: "TODO", updatedAt: now, createdAt: now } : visibleTask },
    } as unknown as PrismaClient, visibleScope);
    await expect(detailFailure.load(ref("PMO_ACTION", "a1"), actor)).rejects.toBe(detailOutage);
  });

  it("fails closed when PMO detail arrays are malformed", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const scopeDb = { task: { findMany: async () => [], findUnique: async () => ({ id: "t1", isPrivate: false, createdById: null, assignments: [] }) } };
    const malformed = createPrismaGraphDb({
      externalAction: { findUnique: async () => ({
        id: "a1", taskId: "t1", closedAt: null, updatedAt: now, createdAt: now,
        owner: { id: "u1", name: "Owner" }, externalContact: { id: "c1", name: "Contact", organization: "Org", isArchived: false },
        followUpEvents: {}, evidence: "not-an-array",
      }) },
      task: { findUnique: async () => ({ id: "t1", title: "Task", status: "TODO", updatedAt: now, createdAt: now }) },
    } as unknown as PrismaClient, scopeDb);
    expect(await malformed.load(ref("PMO_ACTION", "a1"), actor)).toBeNull();
  });

  it("consumes one deterministic global relation authorization budget", async () => {
    const relationBatches: string[][] = [];
    const records: Record<string, GraphRecord> = {
      "PROJECT:p1": { ref: ref("PROJECT", "p1"), title: "Project", relationships: [ref("TASK", "t2"), ref("TASK", "t1")] },
      "TASK:t1": { ref: ref("TASK", "t1"), title: "Task 1", lifecycleStatus: "TODO", relationships: [ref("KPI", "k1")] },
      "TASK:t2": { ref: ref("TASK", "t2"), title: "Task 2", lifecycleStatus: "TODO", relationships: [ref("KPI", "k2")] },
    };
    const db: GraphDb = {
      authorize: async (refs) => { if (refs.length > 1 || refs[0]?.entityType !== "PROJECT") relationBatches.push(refs.map((item) => item.entityId)); return refs; },
      load: async (requested) => records[`${requested.entityType}:${requested.entityId}`] ?? null,
      getCurrentSource: async (requested) => requested,
    };
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, { maxSources: 2 }, db);
    expect(relationBatches.filter((batch) => batch.length > 1).reduce((total, batch) => total + batch.length, 0)).toBeLessThanOrEqual(2);
    expect(result.nodes.map((node) => node.ref.entityId)).toEqual(["p1", "t1"]);
  });

  it("bounds and sorts relation-only entries with the global relation budget", async () => {
    const calls: string[][] = [];
    const relations: GraphRelation[] = [
      { kind: "PROJECT_RISK", label: "z", title: "Zed" },
      { kind: "PROJECT_OBJECTIVE", label: "a", title: "Alpha" },
      { kind: "PROJECT_OUTPUT", label: "m", title: "Middle" },
    ];
    const db: GraphDb = {
      authorize: async (refs) => { calls.push(refs.map((item) => item.entityId)); return refs; },
      load: async () => ({ ref: ref("PROJECT", "p1"), title: "Project", relationships: [], relations }),
      getCurrentSource: async (requested) => requested,
    };
    const result = await loadWorkspaceGraph([ref("PROJECT", "p1")], actor, { maxSources: 2 }, db);
    expect(result.nodes[0]?.relations?.map((item) => item.title)).toEqual(["alpha", "middle"]);
    expect(result.nodes[0]?.relations).toHaveLength(2);
    expect(calls.flat().length).toBeLessThanOrEqual(2);
  });

  it("does not expose a private PMO task title to an actor without task visibility", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    const client = { externalAction: { findUnique: async () => ({ id: "a1", taskId: "t1", ownerId: "u1", externalContactId: "c1", closedAt: null, updatedAt: now, createdAt: now, task: { id: "t1", title: "Private title", updatedAt: now, createdAt: now }, owner: { id: "u1", name: "Owner" }, externalContact: { id: "c1", name: "Contact", organization: "Org", isArchived: false }, followUpEvents: [], evidence: [] }) } } as unknown as PrismaClient;
    const scopeDb = { task: { findMany: async () => [], findUnique: async () => ({ id: "t1", isPrivate: true, createdById: "other", assignments: [] }) } };
    const adapter = createPrismaGraphDb(client, scopeDb);
    expect(await adapter.load(ref("PMO_ACTION", "a1"), actor)).toBeNull();
  });

  it("uses report creation time for current-source freshness, not submission time", async () => {
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    const submittedAt = new Date("2026-08-03T00:00:00.000Z");
    const adapter = createPrismaGraphDb({ weeklyReport: { findUnique: async () => ({ id: "r1", title: "Weekly", finalBody: "safe", submittedAt, createdAt }) } } as unknown as PrismaClient, {});
    const result = await adapter.load(ref("REPORT", "r1"), actor);
    expect(result?.ref.sourceUpdatedAt).toBe(createdAt.toISOString());
  });

  it("never exposes a NOTE body through graph output", async () => {
    const adapter = createPrismaGraphDb({ notePage: { findUnique: async () => ({ id: "n1", title: "Private note", body: "SECRET_NOTE_BODY", isShared: false, authorId: actor.id, updatedAt: null, createdAt: new Date("2026-08-01T00:00:00.000Z"), task: null, caseStudy: null }) } } as unknown as PrismaClient, {});
    const result = await adapter.load(ref("NOTE", "n1"), actor);
    expect(JSON.stringify(result)).not.toContain("SECRET_NOTE_BODY");
  });

  it("propagates unexpected storage failures from current-source checks", async () => {
    const outage = Object.assign(new Error("database unavailable"), { code: "DATABASE_UNAVAILABLE" });
    const adapter = createPrismaGraphDb(
      { task: { findUnique: async () => null } } as unknown as PrismaClient,
      { task: { findMany: async () => [], findUnique: async () => { throw outage; } } },
    );

    await expect(adapter.getCurrentSource(ref("TASK", "t1"), actor)).rejects.toBe(outage);
  });
});
