import { describe, expect, it, vi } from "vitest";
const prismaMocks = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { aiFeedback: { findMany: prismaMocks.findMany, create: prismaMocks.create } } }));

import { createFeedbackService, createPrismaFeedbackRepository, validatePersistedFeedbackIdentity } from "./service";
import { FeedbackValidationError } from "./contracts";
import type { FeedbackEvent, FeedbackRepository } from "./service";

const actor = { id: "u1", scope: "PERSONAL" as const, scopeId: "u1" };
const source = { kind: "FIELD" as const, id: "project:name", workflowId: "wf1", fieldName: "name", capability: "projects.suggest" };
const validHash = (value: string) => value.repeat(64).slice(0, 64);
const base = { source, outcome: "CORRECTED" as const, proposedDiffHash: validHash("a"), finalDiffHash: validHash("b"), reason: "Use shorter title", context: { action: "APPLY" } };

function repo(): FeedbackRepository {
  const rows: FeedbackEvent[] = [];
  return {
    rows,
    async insert(event) { rows.push(event); return event; },
    async findByFingerprint(fingerprint) { return rows.find((row) => row.fingerprint === fingerprint) ?? null; },
    async list() { return [...rows]; },
  };
}

describe("governed feedback service", () => {
  it("does not write a domain report id into the AiMemorySource foreign key", async () => {
    prismaMocks.findMany.mockResolvedValueOnce([]);
    prismaMocks.create.mockResolvedValueOnce({});
    const service = createFeedbackService(createPrismaFeedbackRepository(), { authorizeSource: async () => true, authorizeScope: async () => true });
    await service.recordFeedback({ source: { kind: "REPORT", id: "report-1", reportId: "report-1" }, outcome: "ACCEPTED", context: { report: "report-1", action: "FINALIZE" } }, actor);
    expect(prismaMocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ sourceId: undefined }) }));
  });
  it("rejects malformed persisted identity and fingerprints", () => {
    expect(validatePersistedFeedbackIdentity({ id: "", actorId: "u1", fingerprint: "a".repeat(64) })).toBe(false);
    expect(validatePersistedFeedbackIdentity({ id: "event-1", actorId: "", fingerprint: "a".repeat(64) })).toBe(false);
    expect(validatePersistedFeedbackIdentity({ id: "event-1", actorId: "u1", fingerprint: "A".repeat(64) })).toBe(false);
    expect(validatePersistedFeedbackIdentity({ id: "event-1", actorId: "u1", fingerprint: "a".repeat(64) })).toBe(true);
  });
  it("redacts secret-like, private, and unbounded descriptors before persistence", async () => {
    const repository = repo();
    const service = createFeedbackService(repository, { authorizeSource: async () => true, authorizeScope: async () => true });
    await expect(service.recordFeedback({ ...base, context: { workflow: "wf1", field: "name", capability: "projects.suggest", report: "r1", privateBody: "sensitive content" }, reason: "Bearer abcdefghijklmnopqrstuvwxyz" }, actor)).rejects.toThrow(/reason|private/i);
    expect(repository.rows).toHaveLength(0);
  });

  it("deduplicates an identical event idempotently and fails closed for unauthorized scope/source", async () => {
    const repository = repo();
    const service = createFeedbackService(repository, { authorizeSource: async () => false, authorizeScope: async () => true });
    await expect(service.recordFeedback(base, actor)).rejects.toThrow(/source/i);
    const allowed = createFeedbackService(repository, { authorizeSource: async () => true, authorizeScope: async () => true });
    const first = await allowed.recordFeedback(base, actor);
    const second = await allowed.recordFeedback(base, actor);
    expect(second).toEqual(first);
    expect(repository.rows).toHaveLength(1);
  });

  it("requires three consistent personal events and five events from two users for shared proposals", async () => {
    const repository = repo();
    const service = createFeedbackService(repository, { authorizeSource: async () => true, authorizeScope: async () => true });
    for (let i = 0; i < 2; i += 1) await service.recordFeedback({ ...base, reason: `event-${i}` }, actor);
    expect((await service.proposeLearningFromSignals({ scope: "PERSONAL", scopeId: "u1" }, actor))).toEqual([]);
    await service.recordFeedback({ ...base, reason: "event-2" }, actor);
    expect((await service.proposeLearningFromSignals({ scope: "PERSONAL", scopeId: "u1" }, actor))).toHaveLength(1);
    for (let i = 0; i < 5; i += 1) await service.recordFeedback({ ...base, scope: "TEAM", scopeId: "team1", reason: `team-${i}` }, { id: i < 3 ? "u1" : "u2", scope: "TEAM", scopeId: "team1" });
    expect((await service.proposeLearningFromSignals({ scope: "TEAM", scopeId: "team1" }, actor))[0]?.type).toBe("PLAYBOOK");
  });

  it("reports bounded signals and rejection lowers rank without creating a negative policy", async () => {
    const repository = repo();
    const service = createFeedbackService(repository, { authorizeSource: async () => true, authorizeScope: async () => true });
    for (let i = 0; i < 3; i += 1) await service.recordFeedback({ ...base, reason: `positive-${i}` }, actor);
    await service.recordFeedback({ ...base, outcome: "REJECTED", reason: "reject" }, actor);
    const signals = await service.getPreferenceSignals({ scope: "PERSONAL", scopeId: "u1" }, actor);
    expect(signals[0]).toMatchObject({ count: 4, rejectionCount: 1 });
    expect(signals[0].confidence).toBeGreaterThanOrEqual(0);
    expect(await service.proposeLearningFromSignals({ scope: "PERSONAL", scopeId: "u1" }, actor)).toEqual([]);
  });

  it("never writes approved learning records", async () => {
    const repository = repo();
    const service = createFeedbackService(repository, { authorizeSource: async () => true, authorizeScope: async () => true });
    for (let i = 0; i < 3; i += 1) await service.recordFeedback({ ...base, reason: `proposal-${i}` }, actor);
    const proposals = await service.proposeLearningFromSignals({ scope: "PERSONAL", scopeId: "u1" }, actor);
    expect(proposals[0]?.state).toBe("PROPOSED");
  });

  it("rejects unknown and non-plain runtime values before authorization or persistence", async () => {
    const repository = repo();
    const authorizeSource = vi.fn(async () => true);
    const service = createFeedbackService(repository, { authorizeSource, authorizeScope: async () => true });
    await expect(service.recordFeedback(Object.assign({}, base, { unexpected: "nope" }), actor)).rejects.toBeInstanceOf(FeedbackValidationError);
    await expect(service.recordFeedback({ ...base, source: Object.assign({}, source, { unexpected: "nope" }) }, actor)).rejects.toBeInstanceOf(FeedbackValidationError);
    expect(authorizeSource).not.toHaveBeenCalled();
    expect(repository.rows).toHaveLength(0);
  });

  it("does not meet a proposal threshold when positive and negative outcomes contradict", async () => {
    const repository = repo();
    const service = createFeedbackService(repository, { authorizeSource: async () => true, authorizeScope: async () => true });
    for (let i = 0; i < 3; i += 1) await service.recordFeedback({ ...base, reason: `positive-${i}` }, actor);
    await service.recordFeedback({ ...base, outcome: "REJECTED", reason: "contradiction" }, actor);
    expect(await service.proposeLearningFromSignals({ scope: "PERSONAL", scopeId: "u1" }, actor)).toEqual([]);
  });
});
