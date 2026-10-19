import { describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../registry";
import { createPrismaWorkspaceDb, registerWorkspaceCapabilities, workspaceCapabilities } from "./workspace";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { PrismaClient } from "@prisma/client";
import { createEntityFingerprint } from "@/lib/sabah/intelligence/fingerprint";
import { workspaceSearch } from "@/lib/sabah/intelligence/search";

const actor: SabahActor = { id: "actor-1", role: "MEMBER", departmentIds: ["dept-1"] };

describe("workspace capabilities", () => {
  it("registers the four read/draft capabilities without model-controlled actor input", async () => {
    const registry = new CapabilityRegistry();
    registerWorkspaceCapabilities(registry);
    const names = workspaceCapabilities.map((capability) => capability.name);
    expect(names).toEqual(["workspace.search", "workspace.contextPack", "workspace.relatedWork", "workspace.assignmentCandidates"]);
    for (const capability of workspaceCapabilities) {
      expect(capability.risk).toBe("READ");
      expect(await capability.available(actor)).toBe(true);
      expect(() => capability.inputSchema.parse({ actorId: "forged" })).toThrow();
    }
  });

  it("fails closed when the Prisma client does not expose every authorized model", () => {
    expect(() => createPrismaWorkspaceDb(Object.create(null) as PrismaClient)).toThrow(/model unavailable: project/i);
  });

  it("uses the default typed adapter for an authorized current source and index-compatible checksum", async () => {
    const projectFindMany = vi.fn(async () => [{ id: "p1", status: "Active", ownerId: null, managerId: null, sponsorId: null, responsibleDepartmentId: null, members: [] }]);
    const projectFindUnique = vi.fn(async () => ({ id: "p1", name: "Project", description: null, status: "Active", ownerId: null, managerId: null, sponsorId: null, responsibleDepartmentId: null, updatedAt: new Date("2026-08-27T00:00:00.000Z"), createdAt: new Date("2026-08-26T00:00:00.000Z"), objectives: [], outputs: [], risks: [], stages: [], tasks: [], members: [] }));
    const emptyModel = () => ({ findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) });
    const client = {
      project: { findMany: projectFindMany, findUnique: projectFindUnique },
      task: emptyModel(), kPI: emptyModel(), externalAction: emptyModel(), notePage: emptyModel(), leaveRequest: emptyModel(), caseStudy: emptyModel(), weeklyReport: emptyModel(), supportRequest: emptyModel(),
      user: emptyModel(), aiKnowledgeChunk: emptyModel(), aiEntityFingerprint: emptyModel(), aiWorkflow: { ...emptyModel(), findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const db = createPrismaWorkspaceDb(client);

    const current = await db.getCurrentSource({ entityType: "PROJECT", entityId: "p1" }, actor);

    expect(projectFindMany).not.toHaveBeenCalled();
    expect(projectFindUnique).toHaveBeenCalledTimes(2);
    expect(projectFindUnique).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: "p1" }, select: expect.objectContaining({ ownerId: true }) }));
    expect(projectFindUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: "p1" }, select: expect.objectContaining({ name: true }) }));
    expect(current).toMatchObject({ entityType: "PROJECT", entityId: "p1", label: "Project", href: "/projects/p1", sourceUpdatedAt: "2026-08-27T00:00:00.000Z" });
    expect(current?.checksum).toBe(createEntityFingerprint({ entityType: "PROJECT", entityId: "p1", label: "Project", href: "/projects/p1" }));
  });

  it("runs the registered search capability through the default Prisma-shaped adapter", async () => {
    const updatedAt = new Date("2026-08-27T00:00:00.000Z");
    const identityValue = { entityType: "PROJECT", entityId: "p1", label: "Project", href: "/projects/p1" };
    const identity = { id: "identity-p1", entityType: "PROJECT" as const, entityId: "p1", chunkKind: "identity", text: JSON.stringify(identityValue), normalizedText: "project", checksum: createEntityFingerprint(identityValue), sourceUpdatedAt: updatedAt, staleAt: null, deletedAt: null };
    const content = { id: "content-p1", entityType: "PROJECT" as const, entityId: "p1", chunkKind: "content", text: "Needle project context", normalizedText: "needle project context", checksum: "content-p1", sourceUpdatedAt: updatedAt, staleAt: null, deletedAt: null };
    const projectFindMany = vi.fn(async () => [{ id: "p1", status: "Active", ownerId: null, managerId: null, sponsorId: null, responsibleDepartmentId: null, members: [] }]);
    const projectFindUnique = vi.fn(async () => ({ id: "p1", name: "Project", description: "Needle project context", status: "Active", updatedAt, createdAt: new Date("2026-08-26T00:00:00.000Z"), objectives: [], outputs: [], risks: [], stages: [], tasks: [], members: [], ownerId: null, managerId: null, sponsorId: null, responsibleDepartmentId: null }));
    const emptyModel = () => ({ findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) });
    const aiKnowledgeChunk = { findMany: vi.fn(async (args: { where: Record<string, unknown> }) => args.where.chunkKind === "identity" ? [identity] : [content]) };
    const client = {
      project: { findMany: projectFindMany, findUnique: projectFindUnique },
      task: emptyModel(), kPI: emptyModel(), externalAction: emptyModel(), notePage: emptyModel(), leaveRequest: emptyModel(), caseStudy: emptyModel(), weeklyReport: emptyModel(), supportRequest: emptyModel(),
      user: emptyModel(), aiKnowledgeChunk, aiEntityFingerprint: emptyModel(), aiWorkflow: { ...emptyModel(), findFirst: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const defaultDb = createPrismaWorkspaceDb(client);
    const registry = new CapabilityRegistry();
    registerWorkspaceCapabilities(registry, { searchDb: defaultDb, search: workspaceSearch });
    const current = await defaultDb.getCurrentSource({ entityType: "PROJECT", entityId: "p1" }, actor);
    expect(current).toMatchObject({ entityType: "PROJECT", entityId: "p1", label: "Project", href: "/projects/p1", sourceUpdatedAt: "2026-08-27T00:00:00.000Z" });

    const result = await registry.resolve("workspace.search").execute({ query: "Needle", entityTypes: ["PROJECT"], limit: 1 }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() });
    expect(result).toMatchObject({ items: [{ source: identityValue, snippet: "Needle project context" }] });
    expect(JSON.stringify(result)).not.toContain("score");
  });

  it("uses the injected search seam and applies the server hard cap", async () => {
    const search = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const registry = new CapabilityRegistry();
    registerWorkspaceCapabilities(registry, { search });
    const capability = registry.resolve("workspace.search");
    await capability.execute({ query: "status", entityTypes: ["TASK"], limit: 100 }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() });
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: "status", entityTypes: ["TASK"], limit: 20 }), actor, expect.anything(), expect.anything());
  });

  it("rejects similarity-only duplicate output and bounds search projections", async () => {
    const search = vi.fn().mockResolvedValue({ items: [{ source: { entityType: "TASK", entityId: "t1", label: "Task", href: "/tasks/t1", sourceUpdatedAt: new Date().toISOString(), checksum: "c" }, snippet: "safe", score: 0.8, status: "OPEN" }], hasMore: false });
    const registry = new CapabilityRegistry();
    registerWorkspaceCapabilities(registry, { search });
    const result = await registry.resolve("workspace.search").execute({ query: "x", entityTypes: ["TASK"] }, { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() });
    expect(result).toMatchObject({ items: [{ source: { entityId: "t1" }, snippet: "safe" }] });
    expect(JSON.stringify(result)).not.toContain("privateBody");
    expect(JSON.stringify(result)).not.toContain("score");
  });

  it("keeps each registry bound to its own injected search dependency", async () => {
    const first = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const second = vi.fn().mockResolvedValue({ items: [], hasMore: false });
    const one = new CapabilityRegistry();
    const two = new CapabilityRegistry();
    registerWorkspaceCapabilities(one, { search: first });
    registerWorkspaceCapabilities(two, { search: second });
    const input = { query: "x", entityTypes: ["TASK"] };
    const context = { actor, requestId: "r", conversationId: null, workflowId: null, now: new Date() };
    await one.resolve("workspace.search").execute(input, context);
    await two.resolve("workspace.search").execute(input, context);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
