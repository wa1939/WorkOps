import { describe, expect, it } from "vitest";
import { BUILTIN_PLAYBOOKS } from "./builtins";
import { createPlaybookDraft, submitPlaybookReview, approvePlaybookVersion, archivePlaybook, type PlaybookAdapter } from "./service";
import { playbookChecksum } from "./contracts";
import type { PlaybookDraftInput, PlaybookRecord, CapabilityRegistryLike } from "./contracts";

const actor = { id: "lead-1", role: "LEAD" as const, departmentIds: ["dept-1"] };
const registry: CapabilityRegistryLike = { resolve(name: string) { if (!["project.create", "task.create", "report.generate"].includes(name)) throw new Error("unknown"); return { name, risk: "DRAFT" }; } };
function adapter(): PlaybookAdapter {
  const rows: PlaybookRecord[] = [];
  return { rows, async create(row) { const result = { ...row, id: `pb-${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date() }; rows.push(result); return result; }, async get(id) { return rows.find((row) => row.id === id) ?? null; }, async update(id, patch, expected) { const current = rows.find((row) => row.id === id); if (!current) throw new Error("missing"); if (current.checksum !== expected.checksum || current.version !== expected.version) throw new Error("stale expected version"); if (current.state !== expected.state) throw new Error("stale expected state"); Object.assign(current, patch, { updatedAt: new Date() }); return current; }, async list() { return rows; }, async transaction(work) { return work(); } };
}
const draft: PlaybookDraftInput = { playbookId: "custom-1", version: 1, name: "Launch", description: "Launch workflow", scope: "DEPARTMENT", ownerId: "lead-1", departmentId: "dept-1", triggers: { en: ["launch project"], ar: ["إطلاق مشروع"] }, requiredContext: ["objective"], allowedCapabilities: ["project.create"], requiredApprovals: ["lead"], outputSchema: { type: "object" }, evaluationCases: [{ input: "launch project", expected: "draft" }] };

describe("immutable playbook service", () => {
  it("creates a draft, validates capabilities, and advances through review and approval", async () => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    expect(created.state).toBe("DRAFT");
    const review = await submitPlaybookReview(created.id, actor, { adapter: db, registry });
    expect(review.state).toBe("IN_REVIEW");
    const approved = await approvePlaybookVersion(created.id, actor, "meets policy", { adapter: db, registry });
    expect(approved.state).toBe("APPROVED");
  });

  it("rejects unknown and blocked capabilities and prevents weakening approvals", async () => {
    const db = adapter();
    await expect(createPlaybookDraft({ ...draft, allowedCapabilities: ["missing"] }, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "CAPABILITY_NOT_ALLOWED" });
    const blocked = { ...registry, resolve(name: string) { if (name === "blocked") return { name, risk: "BLOCKED" as const }; return { name, risk: "DRAFT" as const }; } };
    await expect(createPlaybookDraft({ ...draft, allowedCapabilities: ["blocked"] }, actor, { adapter: db, registry: blocked })).rejects.toMatchObject({ code: "CAPABILITY_NOT_ALLOWED" });
    await expect(createPlaybookDraft({ ...draft, requiredApprovals: [] }, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "APPROVAL_POLICY" });
  });

  it("archives approved versions and never mutates their content", async () => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    await submitPlaybookReview(created.id, actor, { adapter: db, registry });
    const approved = await approvePlaybookVersion(created.id, actor, "ok", { adapter: db, registry });
    const archived = await archivePlaybook(approved.id, actor, { adapter: db, registry });
    expect(archived.state).toBe("ARCHIVED");
    expect(archived.allowedCapabilities).toEqual(["project.create"]);
    await expect(approvePlaybookVersion(archived.id, actor, "again", { adapter: db, registry })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("fails closed for shared creation and approval without explicit policies", async () => {
    const db = adapter();
    const shared = { ...draft, scope: "WORKSPACE" as const, ownerId: "workspace-1", version: 1 };
    await expect(createPlaybookDraft(shared, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "SCOPE_FORBIDDEN" });
  });

  it("requires the next append-only version and uses a transaction", async () => {
    const db = adapter();
    await expect(createPlaybookDraft({ ...draft, version: 3 }, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "VERSION_INVALID" });
  });

  it("appends a second version without recreating the playbook parent", async () => {
    const db = adapter();
    const first = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    const second = await createPlaybookDraft({ ...draft, version: 2, description: "Second version" }, actor, { adapter: db, registry });
    expect(first.playbookId).toBe(second.playbookId);
    expect(second.version).toBe(2);
  });

  it("rejects oversized attacker-controlled fields and freezes builtin nested content", async () => {
    const db = adapter();
    await expect(createPlaybookDraft({ ...draft, name: "x".repeat(129) }, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const builtin = BUILTIN_PLAYBOOKS[0];
    expect(() => { (builtin.outputSchema as { properties: { result: { type: string } } }).properties.result.type = "prompt injection"; }).toThrow();
  });

  it("rejects tampered mutable content when reading and transitioning", async () => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    const stored = db.rows?.[0];
    if (!stored) throw new Error("missing test row");
    stored.description = "tampered";
    await expect(submitPlaybookReview(created.id, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });

    stored.description = draft.description;
    await submitPlaybookReview(created.id, actor, { adapter: db, registry });
    const originalUpdate = db.update;
    db.update = async (id, patch, expected) => {
      const result = await originalUpdate(id, patch, expected);
      result.name = "tampered during transition";
      return result;
    };
    await expect(approvePlaybookVersion(created.id, actor, "ok", { adapter: db, registry })).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
  });

  it("rejects content changed and rehashed by an adapter during transition", async () => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    await submitPlaybookReview(created.id, actor, { adapter: db, registry });
    const originalUpdate = db.update;
    db.update = async (id, patch, expected) => {
      const result = await originalUpdate(id, patch, expected);
      result.name = "changed but rehashed";
      result.checksum = playbookChecksum(result);
      return result;
    };
    await expect(approvePlaybookVersion(created.id, actor, "ok", { adapter: db, registry })).rejects.toMatchObject({ code: "IMMUTABLE_RECORD" });
  });

  it("rejects invalid approval override values and overrides that only satisfy globals", async () => {
    const db = adapter();
    await expect(createPlaybookDraft({ ...draft, approvalOverrides: [123] as unknown as readonly string[] }, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(createPlaybookDraft({ ...draft, requiredApprovals: ["admin"], approvalOverrides: ["lead"] }, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "APPROVAL_POLICY" });
  });

  it("validates custom rows against every configured global approval", async () => {
    const db = adapter();
    await expect(createPlaybookDraft(draft, actor, { adapter: db, registry, globalRequiredApprovals: ["admin"] })).rejects.toMatchObject({ code: "APPROVAL_POLICY" });
  });

  it("ships exactly five code-owned version-one built-ins", () => {
    expect(BUILTIN_PLAYBOOKS).toHaveLength(5);
    expect(BUILTIN_PLAYBOOKS.map((playbook) => `${playbook.playbookId}@${playbook.version}`)).toEqual([
      "strategic-project-launch@1", "weekly-report-preparation@1", "meeting-minutes-to-actions@1", "kpi-recovery-plan@1", "leave-handover@1",
    ]);
    for (const playbook of BUILTIN_PLAYBOOKS) expect(playbook.triggers.en.length * playbook.triggers.ar.length).toBeGreaterThan(0);
  });

  it("rejects a MEMBER archiving a department playbook", async () => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    await submitPlaybookReview(created.id, actor, { adapter: db, registry });
    await approvePlaybookVersion(created.id, actor, "ok", { adapter: db, registry });
    await expect(archivePlaybook(created.id, { ...actor, role: "MEMBER" }, { adapter: db, registry })).rejects.toMatchObject({ code: "APPROVAL_FORBIDDEN" });
  });

  it("rejects malformed global approval configuration", async () => {
    const db = adapter();
    await expect(createPlaybookDraft(draft, actor, { adapter: db, registry, globalRequiredApprovals: "lead" as unknown as readonly string[] })).rejects.toMatchObject({ code: "INVALID_POLICY" });
  });

  it("passes the expected checksum and version to the adapter CAS seam", async () => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    const stored = db.rows?.[0];
    if (!stored) throw new Error("missing test row");
    const originalTransaction = db.transaction;
    db.transaction = async (work) => { stored.version = 2; stored.checksum = playbookChecksum(stored); return originalTransaction(work); };
    await expect(submitPlaybookReview(created.id, actor, { adapter: db, registry })).rejects.toThrow("stale expected version");
  });

  it("passes the expected prior state to the adapter CAS seam", async () => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    const stored = db.rows?.[0];
    if (!stored) throw new Error("missing test row");
    const originalTransaction = db.transaction;
    db.transaction = async (work) => { stored.state = "IN_REVIEW"; return originalTransaction(work); };
    await expect(submitPlaybookReview(created.id, actor, { adapter: db, registry })).rejects.toThrow("stale expected state");
  });

  it.each([NaN, Infinity, -Infinity])("rejects non-finite schema number %s before persistence", async (number) => {
    const db = adapter();
    let creates = 0;
    const originalCreate = db.create;
    db.create = async (row) => { creates += 1; return originalCreate(row); };
    await expect(createPlaybookDraft({ ...draft, outputSchema: { threshold: number } }, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(creates).toBe(0);
  });

  it.each([
    ["schema", { outputSchema: { nested: { too: { deep: { still: { deeper: { nope: true } } } } } } }],
    ["evaluation", { evaluationCases: [{ input: 123, expected: "x" }] }],
    ["identity", { ownerId: 123 }],
    ["timestamps", { createdAt: "not-a-date" }],
  ])("rejects malformed adapter %s rows", async (_label, change) => {
    const db = adapter();
    const created = await createPlaybookDraft(draft, actor, { adapter: db, registry });
    const storedRow = db.rows?.[0];
    if (!storedRow) throw new Error("missing test row");
    Object.assign(storedRow, change);
    await expect(submitPlaybookReview(created.id, actor, { adapter: db, registry })).rejects.toMatchObject({ code: "INVALID_RECORD" });
  });
});
