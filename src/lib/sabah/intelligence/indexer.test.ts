import { describe, expect, it, vi } from "vitest";
import { indexEntity, removeEntityFromIndex, reconcileEntityBatch, SELECT_BY_TYPE, processIndexRetryEvent, processPendingIndexRetryEvents } from "./indexer";

const ref = { entityType: "PROJECT" as const, entityId: "p1", label: "Project", href: "/projects/p1", sourceUpdatedAt: "2026-08-26T00:00:00.000Z", checksum: "abc" };
function db() {
  return {
    project: { findUnique: vi.fn().mockResolvedValue({ id: "p1", name: " Alpha ", description: "Goal", status: "Active", updatedAt: new Date(ref.sourceUpdatedAt) }) },
    aiKnowledgeChunk: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({ id: "chunk-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    aiEntityFingerprint: { findMany: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  } as any;
}
describe("authoritative entity indexer", () => {
  it("writes deterministic bounded chunks with provenance and does not rewrite unchanged content", async () => {
    const database = db();
    await indexEntity(ref, database);
    expect(database.aiKnowledgeChunk.upsert).toHaveBeenCalled();
    const first = database.aiKnowledgeChunk.upsert.mock.calls[0][0];
    expect(first.create.text).toContain("identity");
    expect(first.create.text.length).toBeLessThanOrEqual(12000);
    const checksums = database.aiKnowledgeChunk.upsert.mock.calls.map((call: any[]) => ({ chunkKind: call[0].create.chunkKind, checksum: call[0].create.checksum }));
    database.aiKnowledgeChunk.upsert.mockClear();
    database.aiKnowledgeChunk.findMany.mockResolvedValue(checksums);
    await indexEntity(ref, database);
    expect(database.aiKnowledgeChunk.upsert).not.toHaveBeenCalled();
  });
  it("marks every chunk and fingerprint stale/deleted when removed", async () => {
    const database = db();
    await removeEntityFromIndex(ref, database);
    expect(database.aiKnowledgeChunk.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entityType: "PROJECT", entityId: "p1" }, data: expect.objectContaining({ staleAt: expect.any(Date), deletedAt: expect.any(Date) }) }));
  });
  it("uses explicit safe projection, per-facet checksums, authoritative freshness, and PMO model mapping", async () => {
    const database = db();
    const externalAction = { findUnique: vi.fn().mockResolvedValue({ id: "a1", title: "Action", status: "OPEN", updatedAt: new Date("2026-08-20T00:00:00.000Z") }) };
    const pmoDb = { ...database, externalAction, pmoAction: { findUnique: vi.fn() } } as any;
    const actionRef = { ...ref, entityType: "PMO_ACTION" as const, entityId: "a1", sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: "caller-metadata" };
    await indexEntity(actionRef, pmoDb);
    expect(externalAction.findUnique).toHaveBeenCalledWith({ where: { id: "a1" }, select: expect.any(Object) });
    expect(pmoDb.pmoAction.findUnique).not.toHaveBeenCalled();
    const writes = pmoDb.aiKnowledgeChunk.upsert.mock.calls.map((c: any[]) => c[0].create);
    expect(writes.length).toBeGreaterThan(1);
    expect(new Set(writes.map((w: any) => w.checksum)).size).toBe(writes.length);
    expect(writes.every((w: any) => w.sourceUpdatedAt.toISOString() === "2026-08-20T00:00:00.000Z")).toBe(true);
    expect(writes.some((w: any) => w.visibilityClass === "PRIVATE")).toBe(false);
  });
  it("keeps private nested PMO task content out of workspace visibility", async () => {
    const database = db() as any;
    database.externalAction = { findUnique: vi.fn().mockResolvedValue({
      id: "a1", taskId: "t1", task: { id: "t1", title: "Private task", description: "Secret", isPrivate: true },
    }) };
    const actionRef = { ...ref, entityType: "PMO_ACTION" as const, entityId: "a1" };
    await indexEntity(actionRef, database);
    const writes = database.aiKnowledgeChunk.upsert.mock.calls.map((c: any[]) => c[0].create);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every((write: any) => write.visibilityClass === "PRIVATE")).toBe(true);
  });
  it("reconciles bounded live entities once and returns entity continuation", async () => {
    const database = db() as any;
    database.aiEntityFingerprint.findMany.mockResolvedValue([
      { id: "f1", entityType: "PROJECT", entityId: "p1", sourceUpdatedAt: new Date(ref.sourceUpdatedAt), fingerprint: "old", staleAt: null, deletedAt: null },
      { id: "f2", entityType: "PROJECT", entityId: "p1", sourceUpdatedAt: new Date(ref.sourceUpdatedAt), fingerprint: "old2", staleAt: null, deletedAt: null },
    ]);
    const result = await reconcileEntityBatch(undefined, 2, database, { resolve: async () => ({ id: "p1", name: "P", updatedAt: new Date(ref.sourceUpdatedAt) }) });
    expect(database.aiEntityFingerprint.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, orderBy: { id: "asc" }, where: expect.objectContaining({ staleAt: null, deletedAt: null }) }));
    expect(result).toEqual({ count: 1, nextCursor: "f2" });
  });
  it("uses only schema-valid scalar selections and indexes every supported entity", async () => {
    const expected: Record<string, string[]> = {
      PROJECT: ["id", "name", "description", "status", "startAt", "dueAt", "dueAtEnd", "priority", "health", "objective", "scope", "successCriteria", "updatedAt", "createdAt"],
      TASK: ["id", "title", "description", "type", "status", "priority", "startAt", "dueAt", "dueAtEnd", "isPrivate", "projectId", "caseStudyId", "kpiId", "updatedAt", "createdAt"],
      KPI: ["id", "perspective", "objective", "name", "definition", "formula", "dataSource", "metric", "unit", "annualTarget", "status", "updatedAt", "createdAt"],
      PMO_ACTION: ["id", "taskId", "closedAt", "closureNote", "createdAt", "updatedAt", "task"], NOTE: ["id", "title", "body", "isShared", "taskId", "caseStudyId", "createdAt", "updatedAt"],
      LEAVE: ["id", "startAt", "endAt", "reason", "status", "createdAt"], CASE_STUDY: ["id", "name", "brief", "status", "dueAt", "dueAtEnd", "reportBody", "createdAt", "updatedAt"],
      REPORT: ["id", "weekStart", "weekEnd", "title", "body", "type", "aiSummary", "finalBody", "createdAt"], SUPPORT_REQUEST: ["id", "projectId", "taskId", "title", "description", "status", "createdAt", "updatedAt"],
    };
    for (const [type, keys] of Object.entries(expected)) expect(Object.keys(SELECT_BY_TYPE[type as keyof typeof SELECT_BY_TYPE])).toEqual(expect.arrayContaining(keys));
    expect(Object.keys(SELECT_BY_TYPE.KPI)).not.toEqual(expect.arrayContaining(["description", "target", "actual"]));
    expect(SELECT_BY_TYPE.PMO_ACTION.task).toEqual({ select: expect.objectContaining({ id: true, title: true, status: true }) });
  });
  it("marks removed facet kinds stale and deleted using one timestamp", async () => {
    const database = db() as any;
    database.aiKnowledgeChunk.findMany.mockResolvedValue([{ chunkKind: "identity", checksum: "same" }, { chunkKind: "removed", checksum: "old" }]);
    database.aiEntityFingerprint.findMany.mockResolvedValue([]);
    await indexEntity(ref, database, { resolve: async () => ({ id: "p1", name: "Alpha", updatedAt: new Date(ref.sourceUpdatedAt) }), now: () => new Date("2026-08-26T01:00:00.000Z") });
    expect(database.aiKnowledgeChunk.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ chunkKind: "removed" }), data: expect.objectContaining({ staleAt: expect.any(Date), deletedAt: expect.any(Date) }) }));
  });
  it("consumes a durable retry event with validated safe metadata", async () => {
    const database = db();
    await processIndexRetryEvent({ eventType: "WORKSPACE_INDEX_RETRY", metadataJson: JSON.stringify({ entityType: "PROJECT", entityId: "p1", href: "/projects/p1", label: "Project", sourceUpdatedAt: ref.sourceUpdatedAt, checksum: "x", errorCode: "Error" }) }, database);
    expect(database.project.findUnique).toHaveBeenCalled();
  });
  it("reactivates a current facet when its stored row is tombstoned", async () => {
    const database = db() as any;
    database.aiKnowledgeChunk.findMany.mockResolvedValue([{ chunkKind: "identity", checksum: "same", staleAt: new Date(), deletedAt: new Date() }]);
    await indexEntity(ref, database, { resolve: async () => ({ id: "p1", name: "Alpha", updatedAt: new Date(ref.sourceUpdatedAt) }) });
    expect(database.aiKnowledgeChunk.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ staleAt: null, deletedAt: null }) }));
  });
  it("tombstones obsolete orphan fingerprint kinds", async () => {
    const database = db() as any;
    database.aiKnowledgeChunk.findMany.mockResolvedValue([]);
    database.aiEntityFingerprint.findMany.mockResolvedValue([{ kind: "orphan", fingerprint: "old" }]);
    await indexEntity(ref, database, { resolve: async () => ({ id: "p1", name: "Alpha", updatedAt: new Date(ref.sourceUpdatedAt) }), now: () => new Date("2026-08-26T01:00:00.000Z") });
    expect(database.aiEntityFingerprint.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: "orphan" }), data: expect.objectContaining({ staleAt: expect.any(Date), deletedAt: expect.any(Date) }) }));
  });
  it.each([
    { href: "//evil", label: "bad href" },
    { href: "/ok", label: "x".repeat(257) },
    { href: "/ok", label: "bad\u0000label" },
    { href: "/ok", label: "ok", checksum: "" },
  ])("rejects strict retry metadata %#", async (invalid) => {
    await expect(processIndexRetryEvent({ eventType: "WORKSPACE_INDEX_RETRY", metadataJson: JSON.stringify({ ...ref, ...invalid }) }, db())).rejects.toThrow();
  });
  it("uses a valid fallback when now returns Invalid Date", async () => {
    const database = db() as any;
    await removeEntityFromIndex(ref, database, { now: () => new Date("invalid") });
    const at = database.aiKnowledgeChunk.updateMany.mock.calls[0][0].data.staleAt;
    expect(Number.isFinite(at.getTime())).toBe(true);
  });
  it("acknowledges successful retries, skips acknowledged events, tolerates poison events, and returns bounded continuation", async () => {
    const database = db() as any;
    const events = [
      { id: "e1", eventType: "WORKSPACE_INDEX_RETRY", metadataJson: "{" },
      { id: "e2", eventType: "WORKSPACE_INDEX_RETRY", metadataJson: JSON.stringify({ ...ref, errorCode: "Error" }) },
      { id: "e3", eventType: "WORKSPACE_INDEX_RETRY", metadataJson: JSON.stringify({ ...ref, entityId: "p3", errorCode: "Error" }) },
    ];
    database.aiWorkflowEvent = {
      findMany: vi.fn().mockImplementation(async ({ where, take }: any) => events.filter((event) => event.eventType === where.eventType && (!where.id?.gt || event.id > where.id.gt)).slice(0, take)),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => { const event = events.find((item) => item.id === where.id); if (event) event.eventType = data.eventType; return event; }),
    };
    const first = await processPendingIndexRetryEvents(database, { retryLimit: 2 });
    expect(first).toEqual({ processed: 1, failed: 1, nextCursor: "e2" });
    expect(database.aiWorkflowEvent.update).toHaveBeenCalledWith({ where: { id: "e2" }, data: { eventType: "WORKSPACE_INDEX_RETRY_COMPLETED" } });
    expect(database.project.findUnique).toHaveBeenCalledTimes(1);
    const second = await processPendingIndexRetryEvents(database, { retryLimit: 2, retryCursor: first.nextCursor ?? undefined });
    expect(second).toEqual({ processed: 1, failed: 0, nextCursor: null });
    expect(database.project.findUnique).toHaveBeenCalledTimes(2);
    expect(database.aiWorkflowEvent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { eventType: "WORKSPACE_INDEX_RETRY", id: { gt: "e2" } }, take: 2 }));
  });
});
