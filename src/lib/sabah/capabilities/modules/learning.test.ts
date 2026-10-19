import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../registry";
import { createLearningCapabilities, createSharedScopePolicy, getLearningDependencies, registerLearningCapabilities, projectLearningRecord } from "./learning";
import type { MemoryAdapter, MemoryRecord } from "@/lib/sabah/memory/contracts";
import type { PlaybookAdapter, PlaybookRecord } from "@/lib/sabah/playbooks/contracts";
import { playbookChecksum } from "@/lib/sabah/playbooks/contracts";
import { createPrismaGraphDb } from "@/lib/sabah/intelligence/graph";
import { assertSourceVisible } from "@/lib/sabah/intelligence/authorized-scope";
import type { SourceRef } from "@/lib/sabah/intelligence/contracts";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { PrismaClient } from "@prisma/client";

const actor = { id: "u1", role: "MEMBER" as const, departmentIds: ["d1"] };
const source = { entityType: "NOTE" as const, entityId: "n1", label: "Visible note", href: "/notes/n1", sourceUpdatedAt: "2026-08-20", checksum: "abc123" };
const memory = (state: MemoryRecord["state"] = "APPROVED"): MemoryRecord => ({ id: "m1", scope: "USER", kind: "FACT", content: "private fact", provenance: "USER_PROVIDED", confidence: 0.9, freshness: "FRESH", state, ownerId: "u1", departmentId: null, sources: [source], createdAt: new Date(), updatedAt: new Date() });
const memoryAdapter = (rows: MemoryRecord[]): MemoryAdapter => ({ list: async () => rows, get: async (id) => rows.find((r) => r.id === id) ?? null, create: async (row) => ({ ...row, id: "created", createdAt: new Date(), updatedAt: new Date() }), update: async (id, patch) => ({ ...rows.find((r) => r.id === id)!, ...patch }), transaction: async (work) => work() });
const playbook = (): PlaybookRecord => { const row = { id: "pbv1", playbookId: "pb", version: 1, name: "Launch", description: "Launch flow", scope: "USER" as const, ownerId: "u1", departmentId: null, triggers: { en: ["launch"], ar: ["إطلاق"] }, requiredContext: ["context"], allowedCapabilities: ["notes.search"], requiredApprovals: ["lead"], outputSchema: { type: "object" }, evaluationCases: [{ input: "launch", expected: "ok" }], state: "APPROVED" as const, builtin: false, createdAt: new Date(), updatedAt: new Date() }; return { ...row, checksum: playbookChecksum(row) }; };
const playbookAdapter = (rows: PlaybookRecord[]): PlaybookAdapter => ({ list: async () => rows, get: async (id) => rows.find((r) => r.id === id) ?? null, create: async (row) => ({ ...row, id: "created", createdAt: new Date(), updatedAt: new Date() }), update: async (id, patch) => ({ ...rows.find((r) => r.id === id)!, ...patch }), transaction: async (work) => work() });
const deps = () => ({ memory: memoryAdapter([memory()]), playbooks: playbookAdapter([playbook()]), playbookOptions: { registry: { resolve: () => ({ name: "notes.search", risk: "READ" as const }) }, sharedAccessPolicy: async () => true, sharedApprovalPolicy: async () => true }, verifySource: async () => "CURRENT" as const, verifyChecksum: async () => true });

describe("learning capabilities", () => {
  it("provides production dependencies backed by Prisma", () => {
    const deps = getLearningDependencies();
    expect(deps).not.toBeNull();
    expect(typeof deps?.memory.list).toBe("function");
    expect(typeof deps?.playbooks.list).toBe("function");
  });
  it("binds TEAM access to the explicit department and keeps WORKSPACE read-only", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: "owner", isActive: true, departments: [{ departmentId: "d1" }, { departmentId: "d2" }] });
    const policy = createSharedScopePolicy({ user: { findUnique } } as never);
    const team = { id: "m1", scope: "TEAM" as const, ownerId: "owner", departmentId: "d2" };

    await expect(policy({ id: "actor", role: "MEMBER", departmentIds: ["d1"] }, team)).resolves.toBe(false);
    await expect(policy({ id: "actor", role: "MEMBER", departmentIds: ["d2"] }, team)).resolves.toBe(true);
    await expect(policy({ id: "actor", role: "MEMBER", departmentIds: ["d1", "d2"] }, { ...team, departmentId: null })).resolves.toBe(false);
    await expect(policy({ id: "admin", role: "ADMIN", departmentIds: [] }, { ...team, scope: "WORKSPACE", departmentId: "d2" })).resolves.toBe(false);
  });

  it("bounds the proposal forwarder to a typed proposal and never approves", async () => {
    const caps = createLearningCapabilities(deps());
    await expect(caps.proposeMemoryOrPlaybookUpdate.execute({ kind: "memory", proposal: { content: "x", scope: "USER", kind: "FACT", provenance: "USER_PROVIDED", confidence: 0.5, sources: [source] } }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).resolves.toMatchObject({ kind: "memory", requiresHumanApproval: true });
    await expect(caps.proposeMemoryOrPlaybookUpdate.inputSchema.safeParse({ kind: "memory", proposal: { decision: "APPROVED" } }).success).toBe(false);
  });

  it.each([
    ["invisible source", async () => ({ ...deps(), verifySource: async () => "INVISIBLE" as const })],
    ["stale source", async () => ({ ...deps(), verifySource: async () => "STALE" as const })],
  ])("rejects %s through capability authorization", async (_name, makeDeps) => {
    const caps = createLearningCapabilities(await makeDeps());
    await expect(caps.proposeMemoryOrPlaybookUpdate.authorize({ kind: "memory", proposal: { scope: "USER", kind: "FACT", content: "x", provenance: "USER_PROVIDED", confidence: .5, sources: [source] } }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).rejects.toMatchObject({ code: "SOURCE_NOT_VISIBLE" });
  });

  it("rejects generic memory proposals with stale checksums and denied shared scope", async () => {
    const checksumDenied = createLearningCapabilities({ ...deps(), verifyChecksum: async () => false });
    await expect(checksumDenied.proposeMemoryOrPlaybookUpdate.authorize({ kind: "memory", proposal: { scope: "USER", kind: "FACT", content: "x", provenance: "GENERATED", confidence: 0.5, sources: [source] } }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).rejects.toMatchObject({ code: "INVALID_SOURCE_CHECKSUM" });
    const sharedDenied = createLearningCapabilities({ ...deps(), sharedMemoryPolicy: async () => false });
    await expect(sharedDenied.proposeMemoryOrPlaybookUpdate.authorize({ kind: "memory", proposal: { scope: "TEAM", ownerId: "team-a", kind: "FACT", content: "x", provenance: "GENERATED", confidence: 0.5, sources: [source] } }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).rejects.toMatchObject({ code: "SCOPE_FORBIDDEN" });
  });

  it("rejects generic memory proposals when checksum verification is unavailable", async () => {
    const { verifyChecksum: _verifyChecksum, ...missingChecksum } = deps();
    const caps = createLearningCapabilities(missingChecksum);
    await expect(caps.proposeMemoryOrPlaybookUpdate.authorize({ kind: "memory", proposal: { scope: "USER", kind: "FACT", content: "x", provenance: "GENERATED", confidence: 0.5, sources: [source] } }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("uses access policy for shared proposals and approval policy for human decisions", async () => {
    const shared = { scope: "TEAM" as const, ownerId: "team-a", kind: "FACT" as const, content: "x", provenance: "GENERATED" as const, confidence: 0.5, sources: [source] };
    const caps = createLearningCapabilities({ ...deps(), sharedMemoryAccessPolicy: async () => true, sharedMemoryApprovalPolicy: async () => false });
    await expect(caps.proposeMemoryOrPlaybookUpdate.authorize({ kind: "memory", proposal: shared }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).resolves.toBeUndefined();
    await expect(caps.memoryPropose.authorize(shared, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).resolves.toBeUndefined();
    await expect(caps.memoryPropose.execute(shared, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).resolves.toMatchObject({ state: "PROPOSED" });
  });

  it("denies shared playbook proposals before generic echo execution", async () => {
    const shared = { playbookId: "new", version: 1, name: "New", description: "New flow", scope: "TEAM" as const, ownerId: "team-a", departmentId: null, triggers: { en: ["new"], ar: ["جديد"] }, requiredContext: ["context"], allowedCapabilities: ["notes.search"], requiredApprovals: ["lead"], outputSchema: { type: "object" }, evaluationCases: [{ input: "new", expected: "ok" }] };
    const caps = createLearningCapabilities({ ...deps(), playbookOptions: { ...deps().playbookOptions, sharedAccessPolicy: async () => false } });
    await expect(caps.proposeMemoryOrPlaybookUpdate.authorize({ kind: "playbook", proposal: shared }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).rejects.toMatchObject({ code: "SCOPE_FORBIDDEN" });
  });

  it("fails closed when projecting malformed memory records", () => {
    expect(projectLearningRecord({ content: "x" })).toBeNull();
  });

  it("registers read/propose capabilities and never approval operations", async () => {
    const registry = new CapabilityRegistry(); registerLearningCapabilities(registry, deps());
    await expect(registry.search("learning", actor).then((x) => x.map((x) => x.name))).resolves.toEqual(["learning.memory.search", "learning.memory.propose", "learning.playbooks.search", "learning.playbooks.propose", "proposeMemoryOrPlaybookUpdate"]);
  });
  it("searches only source-verified scoped memories and masks provenance", async () => {
    const caps = createLearningCapabilities(deps());
    const result = await caps.memorySearch.execute({ query: "private", limit: 50 }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() });
    expect(result.items[0]).toMatchObject({ id: "m1", content: "private fact" });
    expect(result.items[0].sources).toHaveLength(1);
  });
  it("proposes memory through MemoryService and does not expose approve/reject", async () => {
    const caps = createLearningCapabilities(deps());
    expect(Object.keys(caps)).not.toContain("approveMemory");
    const result = await caps.memoryPropose.execute({ scope: "USER", kind: "LESSON", content: "lesson", provenance: "GENERATED", confidence: 0.7, sources: [source] }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() });
    expect(result).toMatchObject({ id: "created", state: "PROPOSED" });
  });
  it("matches approved playbooks and proposes append-only drafts with checksums", async () => {
    const caps = createLearningCapabilities(deps());
    await expect(caps.playbookSearch.execute({ query: "launch", limit: 10 }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).resolves.toEqual([expect.objectContaining({ playbookId: "pb" })]);
    const input = { playbookId: "new", version: 1, name: "New", description: "New flow", scope: "USER" as const, ownerId: "u1", departmentId: null, triggers: { en: ["new"], ar: ["جديد"] }, requiredContext: ["context"], allowedCapabilities: ["notes.search"], requiredApprovals: ["lead"], outputSchema: { type: "object" }, evaluationCases: [{ input: "new", expected: "ok" }] };
    await expect(caps.playbookPropose.execute(input, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).resolves.toMatchObject({ state: "DRAFT", checksum: expect.any(String) });
  });

  it("keeps the review-ID contract compatible through 200 valid rows and rejects overbound metadata", () => {
    const outputSchema = createLearningCapabilities(deps()).memorySearch.outputSchema;
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `m${index}`);
    expect(outputSchema.safeParse({ items: [], reviewIds: ids(17) }).success).toBe(true);
    expect(outputSchema.safeParse({ items: [], reviewIds: ids(200) }).success).toBe(true);
    expect(outputSchema.safeParse({ items: [], reviewIds: ids(201) }).success).toBe(false);
  });

  it("rejects an overbound retrieval result instead of presenting it as an empty search", async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ ...memory(), id: `stale-${index}`, freshness: "STALE" as const }));
    const caps = createLearningCapabilities({ ...deps(), memory: memoryAdapter(rows) });
    await expect(caps.memorySearch.execute({ query: "", limit: 20 }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).rejects.toBeDefined();
  });

  it("propagates a default graph checksum outage through memory search", async () => {
    const outage = Object.assign(new Error("database unavailable"), { code: "DATABASE_UNAVAILABLE" });
    const taskSource = { entityType: "TASK" as const, entityId: "t1", label: "Visible task", href: "/tasks/t1", sourceUpdatedAt: "2026-08-20T00:00:00.000Z", checksum: "abc123" };
    let sourceReads = 0;
    const scopeDb = {
      task: {
        findMany: async () => { throw new Error("Unexpected scope scan"); },
        findUnique: async () => {
          if (++sourceReads > 1) throw outage;
          return { id: "t1", isPrivate: false, createdById: null, assignments: [] };
        },
      },
    };
    const graph = createPrismaGraphDb({ task: { findUnique: async () => null } } as unknown as PrismaClient, scopeDb);
    const defaultStyleDeps = {
      ...deps(),
      memory: memoryAdapter([{ ...memory(), sources: [taskSource] }]),
      verifySource: async (currentActor: SabahActor, ref: SourceRef) => {
        await assertSourceVisible(ref, currentActor, scopeDb);
        return (await graph.getCurrentSource(ref, currentActor)) ? "CURRENT" as const : "INVISIBLE" as const;
      },
      verifyChecksum: async (currentActor: SabahActor, ref: SourceRef) => {
        const current = await graph.getCurrentSource(ref, currentActor);
        return !!current && current.checksum.toLowerCase() === ref.checksum.toLowerCase();
      },
    };
    const caps = createLearningCapabilities(defaultStyleDeps);
    await expect(caps.memorySearch.execute({ query: "", limit: 20 }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() })).rejects.toBe(outage);
  });
});
