import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../registry";
import { PMO_CAPABILITIES, PMO_CAPABILITY_NAMES, mapPmoActor, registerPmoCapabilities } from "./pmo";

const prismaMock = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), findUnique: vi.fn() },
  actionEvidence: { findUnique: vi.fn(), findFirst: vi.fn() },
  followUpEvent: { findUnique: vi.fn() },
  comment: { findUnique: vi.fn() },
  externalContact: { findUnique: vi.fn(), findMany: vi.fn() },
  workArea: { findUnique: vi.fn(), findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

describe("verified PMO capabilities", () => {
  beforeEach(() => vi.clearAllMocks());
  it("registers the reviewed PMO surface and no send/delete operations", () => {
    const registry = new CapabilityRegistry(); registerPmoCapabilities(registry);
    expect(PMO_CAPABILITY_NAMES).toEqual(["pmo.actions.search", "pmo.actions.get", "pmo.actions.create", "pmo.actions.update", "pmo.actions.addEvidence", "pmo.actions.addFollowUp", "pmo.actions.recordResponse", "pmo.actions.changeLifecycle", "pmo.contacts.search", "pmo.contacts.create", "pmo.contacts.update", "pmo.workAreas.search", "pmo.workAreas.create", "pmo.workAreas.update", "pmo.drafts.generate", "pmo.drafts.rewrite"]);
    expect(PMO_CAPABILITY_NAMES.some((name) => /delete|email\.send/i.test(name))).toBe(false);
  });
  it("maps Sabah LEAD actors to PMO MANAGER without widening viewer access", () => {
    expect(mapPmoActor({ id: "lead", role: "LEAD", departmentIds: [] })).toEqual({ id: "lead", role: "MANAGER" });
    expect(mapPmoActor({ id: "viewer", role: "VIEWER", departmentIds: [] })).toEqual({ id: "viewer", role: "VIEWER" });
  });
  it("keeps draft generation DRAFT and explicitly marks writes", () => {
    const draft = PMO_CAPABILITIES.find((c) => c.name === "pmo.drafts.generate")!;
    const lifecycle = PMO_CAPABILITIES.find((c) => c.name === "pmo.actions.changeLifecycle")!;
    expect(draft.risk).toBe("DRAFT"); expect(draft.requiresExplicitApproval).toBeUndefined();
    expect(lifecycle.risk).toBe("SENSITIVE_WRITE"); expect(lifecycle.requiresExplicitApproval).toBe(true);
  });
  it("exposes write capabilities as explicit, non-fast-path operations", () => {
    const registry = new CapabilityRegistry(); registerPmoCapabilities(registry);
    for (const name of PMO_CAPABILITY_NAMES.filter((v) => !v.endsWith(".search") && !v.endsWith(".get") && !v.startsWith("pmo.drafts"))) expect(registry.resolve(name).requiresExplicitApproval).toBe(true);
  });
  it("fails action verification when a requested material field reads back differently", async () => {
    prismaMock.task.findFirst.mockResolvedValue({ type: "EXTERNAL_ACTION", title: "wrong", description: "desc", status: "WAITING", priority: "HIGH", dueAt: new Date("2026-08-12T06:00:00.000Z"), projectId: "project", caseStudyId: null, externalAction: { ownerId: "owner", externalContactId: "contact", overdueIntervalDays: 7, reminderRules: [{ daysBeforeDue: 7 }] }, assignments: [{ userId: "owner" }], tags: [], blockers: [] });
    const capability = PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.update")!;
    await expect(capability.verify({ id: "task-1" }, { actor: { id: "u", role: "MEMBER", departmentIds: [] }, requestId: "r", conversationId: null, workflowId: null, now: new Date(), input: { id: "task-1", title: "requested", expectedUpdatedAt: "2026-08-12T00:00:00.000Z" } } as any)).rejects.toThrow(/title mismatch/);
  });
  it("verifies lifecycle target state and rejects closed-action read-back", async () => {
    prismaMock.task.findFirst.mockResolvedValue({ type: "EXTERNAL_ACTION", title: "a", description: "d", status: "WAITING", priority: "HIGH", dueAt: new Date("2026-08-12T06:00:00.000Z"), projectId: "project", caseStudyId: null, externalAction: { ownerId: "owner", externalContactId: "contact", overdueIntervalDays: 7, reminderRules: [] }, assignments: [{ userId: "owner" }], tags: [], blockers: [] });
    const capability = PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.changeLifecycle")!;
    await expect(capability.verify({ id: "task-1" }, { actor: { id: "u", role: "LEAD", departmentIds: [] }, requestId: "r", conversationId: null, workflowId: null, now: new Date(), input: { taskId: "task-1", action: "close", closureNote: "done" } } as any)).rejects.toThrow(/status mismatch/);
  });
  it("keeps every PMO descriptor wired with schemas and verification context", () => {
    for (const capability of PMO_CAPABILITIES) {
      expect(capability).toEqual(expect.objectContaining({ name: expect.stringMatching(/^pmo\./), version: 1, module: "pmo" }));
      expect(capability.inputSchema).toBeDefined();
      expect(capability.outputSchema).toBeDefined();
      expect(capability.preview).toEqual(expect.any(Function));
      expect(capability.authorize).toEqual(expect.any(Function));
      expect(capability.execute).toEqual(expect.any(Function));
      expect(capability.verify).toEqual(expect.any(Function));
    }
  });
  it("verifies evidence material fields and rejects a stale URL", async () => {
    prismaMock.actionEvidence.findUnique.mockResolvedValue({ id: "e1", externalActionId: "a1", label: "Evidence", url: "https://wrong.example", addedById: "u" });
    const capability = PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.addEvidence")!;
    await expect(capability.verify({ id: "e1" }, { actor: { id: "u", role: "LEAD", departmentIds: [] }, requestId: "r", conversationId: null, workflowId: null, now: new Date(), input: { taskId: "t1", evidence: { label: "Evidence", url: "https://requested.example" } } } as any)).rejects.toThrow(/url mismatch/);
  });
  it("enforces Viewer denial and manager-only archived reference reads", async () => {
    const contactSearch = PMO_CAPABILITIES.find((item) => item.name === "pmo.contacts.search")!;
    const viewer = { actor: { id: "v", role: "VIEWER" as const, departmentIds: [] }, requestId: "r", conversationId: null, workflowId: null, now: new Date() };
    await expect((contactSearch.authorize as any)({ query: "", includeArchived: true }, viewer)).rejects.toThrow(/Archived contacts/);
    await expect(PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.create")!.available(viewer.actor)).resolves.toBe(false);
  });

  const context = { actor: { id: "m", role: "LEAD" as const, departmentIds: [] }, requestId: "r", conversationId: null, workflowId: null, now: new Date() };
  it("rejects follow-up material mismatch", async () => {
    prismaMock.followUpEvent.findUnique.mockResolvedValue({ id: "f1", externalActionId: "a1", finalRecipient: "other@example.com", finalSubject: "Subject", finalBody: "Body", sentAt: new Date() });
    const capability = PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.addFollowUp")!;
    await expect(capability.verify({ id: "f1" }, { ...context, input: { taskId: "t1", recipient: "requested@example.com", subject: "Subject", body: "Body" } } as any)).rejects.toThrow(/finalRecipient mismatch/);
  });
  it("accepts matching response comment and evidence action link", async () => {
    prismaMock.comment.findUnique.mockResolvedValueOnce({ id: "c1", taskId: "t1", authorId: "m", body: "Accepted" }).mockResolvedValueOnce({ taskId: "t1" });
    prismaMock.task.findUnique.mockResolvedValue({ externalAction: { id: "a1" } }); prismaMock.actionEvidence.findFirst.mockResolvedValue({ id: "e1" });
    const capability = PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.recordResponse")!;
    await expect(capability.verify({ id: "c1" }, { ...context, input: { taskId: "t1", response: { comment: "Accepted", evidence: { label: "Proof", url: "https://proof.example" } } } } as any)).resolves.toEqual({ id: "c1" });
  });
  it("rejects response comment material mismatch safely", async () => {
    prismaMock.comment.findUnique.mockResolvedValueOnce({ id: "c1", taskId: "t1", authorId: "m", body: "Different" });
    const capability = PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.recordResponse")!;
    await expect(capability.verify({ id: "c1" }, { ...context, input: { taskId: "t1", response: { comment: "Requested" } } } as any)).rejects.toThrow(/body mismatch/);
  });
  it("rejects contact and work-area material mismatches", async () => {
    prismaMock.externalContact.findUnique.mockResolvedValue({ id: "c1", name: "Wrong", email: "person@example.com", normalizedEmail: "person@example.com", department: null, organization: null, isArchived: false });
    await expect(PMO_CAPABILITIES.find((item) => item.name === "pmo.contacts.update")!.verify({ id: "c1" }, { ...context, input: { id: "c1", changes: { name: "Requested" } } } as any)).rejects.toThrow(/name mismatch/);
    prismaMock.workArea.findUnique.mockResolvedValue({ id: "w1", name: "Wrong", normalizedName: "wrong", description: null, displayOrder: 0, isArchived: false });
    await expect(PMO_CAPABILITIES.find((item) => item.name === "pmo.workAreas.update")!.verify({ id: "w1" }, { ...context, input: { id: "w1", changes: { name: "Requested" } } } as any)).rejects.toThrow(/name mismatch/);
  });
  it("rejects stale action updates before the write path", async () => {
    prismaMock.task.findFirst.mockResolvedValue({ type: "EXTERNAL_ACTION", externalAction: { ownerId: "m", owner: { managerId: null } }, project: null, caseStudy: null });
    prismaMock.task.findUnique.mockResolvedValue({ updatedAt: new Date("2026-08-11T00:00:00.000Z") });
    await expect((PMO_CAPABILITIES.find((item) => item.name === "pmo.actions.update")!.authorize as any)({ id: "t1", title: "New", expectedUpdatedAt: "2026-08-12T00:00:00.000Z" }, context as any)).rejects.toMatchObject({ code: "STALE_VERSION" });
  });
});
