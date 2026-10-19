import { describe, expect, it } from "vitest";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { MemoryAdapter, MemoryInput, MemoryRecord, SourceRef } from "./contracts";
import { createMemoryService } from "./service";

const actor: SabahActor = { id: "u1", role: "MEMBER", departmentIds: ["d1"] };
const lead: SabahActor = { id: "lead", role: "LEAD", departmentIds: ["d1"] };
const source = (id = "t1"): SourceRef => ({ entityType: "TASK", entityId: id, label: "Task", href: `/tasks/${id}`, sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: `sum-${id}` });
const input = (extra: Partial<MemoryInput> = {}): MemoryInput => ({ scope: "USER", kind: "PREFERENCE", content: "Prefer concise updates", provenance: "USER_PROVIDED", confidence: 0.95, sources: [source()], ...extra });

type TestAdapter = MemoryAdapter & { rows: MemoryRecord[] };
function adapter(seed: MemoryRecord[] = []): TestAdapter {
  const rows = [...seed];
  return {
    rows,
    create: async (row) => { const created = { ...row, id: `m${rows.length + 1}`, createdAt: new Date(), updatedAt: new Date() }; rows.push(created); return created; },
    get: async (id) => rows.find((row) => row.id === id) ?? null,
    update: async (id, patch) => { const index = rows.findIndex((row) => row.id === id); if (index < 0) throw new Error("not found"); rows[index] = { ...rows[index], ...patch, updatedAt: new Date() }; return rows[index]; },
    list: async () => [...rows],
    transaction: async (work) => work(),
  };
}

it("auto-approves only clearly non-sensitive user presentation preferences", async () => {
  const service = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" });
  const result = await service.proposeMemory(input(), actor);
  expect(result.state).toBe("APPROVED");
  expect(result.approval?.actorId).toBe(actor.id);
});

it("keeps business facts proposed even for a user scope", async () => {
  const result = await createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" }).proposeMemory(input({ kind: "FACT", content: "Project X is approved" }), actor);
  expect(result.state).toBe("PROPOSED");
});

it("requires an authorized approver for shared scopes", async () => {
  const service = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT", canApproveSharedScope: () => true });
  const proposed = await service.proposeMemory(input({ scope: "DEPARTMENT", kind: "PREFERENCE", departmentId: "d1" }), actor);
  await expect(service.approveMemory(proposed.id, actor, "looks good")).rejects.toMatchObject({ code: "APPROVAL_FORBIDDEN" });
  expect((await service.approveMemory(proposed.id, lead, "reviewed")).approval?.reason).toBe("reviewed");
});

it("fails closed when source verification is absent or non-current", async () => {
  await expect(createMemoryService(adapter()).proposeMemory(input(), actor)).rejects.toMatchObject({ code: "SOURCE_NOT_VISIBLE" });
  for (const status of ["INVISIBLE", "STALE", "CONTRADICTED"] as const) {
    const service = createMemoryService(adapter(), { sourceVerifier: async () => status });
    await expect(service.proposeMemory(input(), actor)).rejects.toMatchObject({ code: "SOURCE_NOT_VISIBLE" });
  }
});

it("normalizes checksums and rejects empty or mismatched source checksums", async () => {
  const seen: string[] = [];
  const service = createMemoryService(adapter(), { sourceVerifier: async (_, ref) => { seen.push(ref.checksum); return true; }, sourceChecksumVerifier: async () => true });
  await service.proposeMemory(input(), actor);
  expect(seen).toEqual(["sum-t1"]);
  await expect(service.proposeMemory(input({ sources: [{ ...source(), checksum: "   " }] }), actor)).rejects.toMatchObject({ code: "INVALID_SOURCE_CHECKSUM" });
  await expect(createMemoryService(adapter(), { sourceVerifier: async () => false }).proposeMemory(input(), actor)).rejects.toMatchObject({ code: "SOURCE_NOT_VISIBLE" });
  await expect(createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT", sourceChecksumVerifier: async () => false }).proposeMemory(input(), actor)).rejects.toMatchObject({ code: "INVALID_SOURCE_CHECKSUM" });
  await expect(createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" }).proposeMemory(input({ sources: [{ ...source(), checksum: "sum t1" }] }), actor)).rejects.toMatchObject({ code: "INVALID_SOURCE_CHECKSUM" });
});

it("requires scoped shared policies and passes actor and stable scope identity", async () => {
  const seen: string[] = [];
  const shared = input({ scope: "TEAM", ownerId: "team-alpha", sources: [source()] });
  const blocked = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT", canApproveSharedScope: () => false });
  const proposed = await blocked.proposeMemory(shared, actor);
  await expect(blocked.approveMemory(proposed.id, lead, "reviewed")).rejects.toMatchObject({ code: "APPROVAL_FORBIDDEN" });
  const allowed = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT", canApproveSharedScope: (approver, memory) => { seen.push(`${approver.id}:${memory.ownerId}`); return approver.id === lead.id && memory.ownerId === "team-alpha"; } });
  const allowedRow = await allowed.proposeMemory(shared, actor);
  await allowed.approveMemory(allowedRow.id, lead, "reviewed");
  expect(seen).toEqual(["lead:team-alpha"]);
});

it("only approves or rejects unexpired proposed memories after source re-verification", async () => {
  const now = new Date("2026-08-20T00:00:00.000Z");
  let current = now;
  const service = createMemoryService(adapter(), { now: () => current, sourceVerifier: async () => "CURRENT", canApproveSharedScope: () => true });
  const approved = await service.proposeMemory(input(), actor);
  await expect(service.approveMemory(approved.id, lead, "again")).rejects.toMatchObject({ code: "INVALID_STATE" });
  const proposed = await service.proposeMemory(input({ scope: "DEPARTMENT", departmentId: "d1", kind: "FACT" }), actor);
  await expect(service.rejectMemory(proposed.id, lead, "no")).resolves.toMatchObject({ state: "REJECTED" });
  const expired = await service.proposeMemory(input({ scope: "DEPARTMENT", departmentId: "d1", kind: "FACT", content: "new fact", expiresAt: new Date("2026-08-21") }), actor);
  current = new Date("2026-08-22T00:00:00.000Z");
  await expect(service.approveMemory(expired.id, lead, "late")).rejects.toMatchObject({ code: "INVALID_STATE" });
});

it("rejects archived, rejected, and superseded rows during decisions", async () => {
  const service = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" });
  const archived = await service.proposeMemory(input({ kind: "FACT" }), actor);
  await service.archiveMemory(archived.id, actor);
  await expect(service.approveMemory(archived.id, lead, "late")).rejects.toMatchObject({ code: "INVALID_STATE" });
  const rejected = await service.proposeMemory(input({ scope: "DEPARTMENT", departmentId: "d1", kind: "FACT", content: "reject me" }), actor);
  await service.rejectMemory(rejected.id, lead, "no");
  await expect(service.approveMemory(rejected.id, lead, "again")).rejects.toMatchObject({ code: "INVALID_STATE" });
  const old = await service.proposeMemory(input({ content: "old" }), actor);
  const next = await service.proposeMemory(input({ content: "next" }), actor);
  await service.supersedeMemory(old.id, next.id, actor);
  await expect(service.approveMemory(old.id, lead, "late")).rejects.toMatchObject({ code: "INVALID_STATE" });
});

it("rejects missing, invisible, credential, and inappropriate PII sources/content", async () => {
  const invisible = createMemoryService(adapter(), { sourceVerifier: async () => false });
  await expect(invisible.proposeMemory(input(), actor)).rejects.toMatchObject({ code: "SOURCE_NOT_VISIBLE" });
  await expect(createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" }).proposeMemory(input({ sources: [] }), actor)).rejects.toMatchObject({ code: "SOURCE_REQUIRED" });
  await expect(createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" }).proposeMemory(input({ content: "password: hunter2" }), actor)).rejects.toMatchObject({ code: "CONTENT_REJECTED" });
  await expect(createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" }).proposeMemory(input({ content: "SSN 123-45-6789" }), actor)).rejects.toMatchObject({ code: "CONTENT_REJECTED" });
});

it("enforces user ownership when mutating a memory", async () => {
  const service = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" });
  const row = await service.proposeMemory(input(), actor);
  await expect(service.archiveMemory(row.id, { ...actor, id: "u2" })).rejects.toMatchObject({ code: "MEMORY_SCOPE_FORBIDDEN" });
});

it("requires the shared policy for team and workspace archive and supersession", async () => {
  const shared = input({ scope: "TEAM", ownerId: "team-alpha", kind: "PREFERENCE" });
  const service = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" });
  const row = await service.proposeMemory(shared, actor);
  await expect(service.archiveMemory(row.id, lead)).rejects.toMatchObject({ code: "MEMORY_SCOPE_FORBIDDEN" });
  const allowed = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT", canApproveSharedScope: () => true });
  const old = await allowed.proposeMemory(shared, actor);
  const next = await allowed.proposeMemory({ ...shared, content: "next" }, actor);
  await allowed.approveMemory(old.id, lead, "old");
  await allowed.approveMemory(next.id, lead, "next");
  await expect(allowed.supersedeMemory(old.id, next.id, lead)).resolves.toMatchObject({ state: "SUPERSEDED" });
});

it("rejects invalid supersession state, self-links, and incompatible successors", async () => {
  const service = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" });
  const old = await service.proposeMemory(input(), actor);
  await expect(service.supersedeMemory(old.id, old.id, actor)).rejects.toMatchObject({ code: "INVALID_SUPERSESSION" });
  const proposed = await service.proposeMemory(input({ kind: "FACT", content: "proposed" }), actor);
  await expect(service.supersedeMemory(old.id, proposed.id, actor)).rejects.toMatchObject({ code: "INVALID_SUPERSESSION" });
  const otherScope = await service.proposeMemory(input({ scope: "DEPARTMENT", departmentId: "d1", kind: "PREFERENCE" }), actor);
  await expect(service.supersedeMemory(old.id, otherScope.id, actor)).rejects.toMatchObject({ code: "INVALID_SUPERSESSION" });
});

it("rejects a successor that is already superseded", async () => {
  const db = adapter();
  const service = createMemoryService(db, { sourceVerifier: async () => "CURRENT" });
  const old = await service.proposeMemory(input({ content: "old" }), actor);
  const next = await service.proposeMemory(input({ content: "next" }), actor);
  db.rows.find((row) => row.id === next.id)!.supersededById = "later";
  await expect(service.supersedeMemory(old.id, next.id, actor)).rejects.toMatchObject({ code: "INVALID_SUPERSESSION" });
  expect((await service.getMemory(old.id))?.state).toBe("APPROVED");
});

it("uses the expected proposed state fence so only one concurrent decision succeeds", async () => {
  const db = adapter();
  const service = createMemoryService(db, { sourceVerifier: async () => "CURRENT" });
  const proposed = await service.proposeMemory(input({ scope: "DEPARTMENT", departmentId: "d1", kind: "FACT" }), actor);
  const originalUpdate = db.update;
  let writes = 0;
  db.update = async (id, patch) => { writes += 1; if (writes > 1) throw Object.assign(new Error("stale"), { code: "MEMORY_CONFLICT" }); return originalUpdate(id, patch); };
  const results = await Promise.allSettled([service.approveMemory(proposed.id, lead, "approve"), service.rejectMemory(proposed.id, lead, "reject")]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
});

it("requires an expiry in the future and links supersession atomically", async () => {
  const service = createMemoryService(adapter(), { sourceVerifier: async () => "CURRENT" });
  await expect(service.proposeMemory(input({ expiresAt: new Date("2020-01-01") }), actor)).rejects.toMatchObject({ code: "INVALID_EXPIRY" });
  const old = await service.proposeMemory(input(), actor);
  const next = await service.proposeMemory(input({ content: "Prefer detailed updates" }), actor);
  const replaced = await service.supersedeMemory(old.id, next.id, actor);
  expect(replaced.state).toBe("SUPERSEDED");
  expect((await service.getMemory(next.id))?.supersededById).toBeNull();
});

it("uses an optional two-row CAS seam and leaves the old row approved when the successor fence loses", async () => {
  const db = adapter();
  const old = await createMemoryService(db, { sourceVerifier: async () => "CURRENT" }).proposeMemory(input({ content: "old" }), actor);
  const next = await createMemoryService(db, { sourceVerifier: async () => "CURRENT" }).proposeMemory(input({ content: "next" }), actor);
  let called = false;
  db.supersede = async () => { called = true; throw Object.assign(new Error("replacement changed"), { code: "MEMORY_CONFLICT" }); };
  const service = createMemoryService(db, { sourceVerifier: async () => "CURRENT" });
  await expect(service.supersedeMemory(old.id, next.id, actor)).rejects.toMatchObject({ code: "MEMORY_CONFLICT" });
  expect(called).toBe(true);
  expect((await service.getMemory(old.id))?.state).toBe("APPROVED");
});
