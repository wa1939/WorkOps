import { z } from "zod";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { MemoryAdapter, MemoryInput, MemoryRecord, SourceRef, SourceVerifier, SharedScopePolicy, SourceVerification, SourceChecksumVerifier } from "./contracts";
import { canApproveMemory, canAccessMemory, validateScopeOwnership, MemoryAuthorizationError } from "./authorization";
import type { LifecycleEventBus } from "../events/bus";

export class MemoryServiceError extends Error { constructor(message: string, readonly code: string) { super(message); this.name = "MemoryServiceError"; } }
const inputSchema = z.object({
  scope: z.enum(["USER", "TEAM", "DEPARTMENT", "WORKSPACE"]),
  kind: z.enum(["PREFERENCE", "FACT", "DECISION", "TERMINOLOGY", "RELATIONSHIP", "LESSON"]),
  content: z.string().trim().min(1).max(2000),
  provenance: z.enum(["GENERATED", "USER_PROVIDED", "IMPORTED", "SYSTEM"]),
  confidence: z.number().min(0).max(1),
  expiresAt: z.date().nullable().optional(),
  ownerId: z.string().trim().min(1).nullable().optional(),
  departmentId: z.string().trim().min(1).nullable().optional(),
  terminologyTerms: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  triggerTerms: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  sources: z.array(z.object({ entityType: z.enum(["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"]), entityId: z.string().min(1).max(200), label: z.string().min(1).max(200), href: z.string().max(500), sourceUpdatedAt: z.string().min(1), checksum: z.string().min(1).max(200) })).min(1).max(5),
}).strict();
const secretPatterns = [/password\s*[:=]/i, /(?:api[_ -]?key|access[_ -]?token|secret)\s*[:=]/i, /-----BEGIN [^-]+ PRIVATE KEY-----/i, /bearer\s+[a-z0-9._-]{12,}/i, /\b\d{3}-\d{2}-\d{4}\b/, /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, /\b(?:\+?\d[\d ()-]{8,}\d)\b/];
const normalizeSource = (source: SourceRef): SourceRef => ({ ...source, checksum: source.checksum.trim().toLowerCase() });
const checksumPattern = /^[a-z0-9][a-z0-9._:-]{2,199}$/;
const reject = (message: string, code: string): never => { throw new MemoryServiceError(message, code); };

export function validateMemoryInput(raw: MemoryInput, actor: SabahActor): MemoryInput {
  if (raw && Array.isArray(raw.sources) && raw.sources.length === 0) reject("At least one source is required", "SOURCE_REQUIRED");
  const parsed = inputSchema.safeParse(raw);
  const input = parsed.success ? parsed.data : reject("Invalid memory input", "INVALID_INPUT");
  if (secretPatterns.some((pattern) => pattern.test(input.content))) reject("Memory content rejected by safety classifier", "CONTENT_REJECTED");
  const ownerId = input.scope === "USER" ? (input.ownerId ?? actor.id) : (input.ownerId ?? null);
  const normalized: MemoryInput = { ...input, ownerId, sources: input.sources.map(normalizeSource) };
  if (normalized.sources.some((source) => !checksumPattern.test(source.checksum))) reject("Source checksum is invalid", "INVALID_SOURCE_CHECKSUM");
  validateScopeOwnership(actor, normalized);
  if (normalized.expiresAt && normalized.expiresAt <= new Date()) reject("Memory expiry must be in the future", "INVALID_EXPIRY");
  return normalized;
}

export type MemoryServiceOptions = { sourceVerifier?: SourceVerifier; sourceChecksumVerifier?: SourceChecksumVerifier; now?: () => Date; canAccessSharedScope?: SharedScopePolicy; canApproveSharedScope?: SharedScopePolicy; eventBus?: LifecycleEventBus };
export class MemoryService {
  private readonly now: () => Date;
  constructor(private readonly adapter: MemoryAdapter, private readonly options: MemoryServiceOptions = {}) { this.now = options.now ?? (() => new Date()); }

  async proposeMemory(raw: MemoryInput, actor: SabahActor): Promise<MemoryRecord> {
    if (raw && Array.isArray(raw.sources) && raw.sources.length === 0) reject("At least one source is required", "SOURCE_REQUIRED");
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) reject("Invalid memory input", "INVALID_INPUT");
    const input = parsed.data as MemoryInput;
    if (secretPatterns.some((pattern) => pattern.test(input.content))) reject("Memory content rejected by safety classifier", "CONTENT_REJECTED");
    const ownerId = input.scope === "USER" ? (input.ownerId ?? actor.id) : (input.ownerId ?? null);
    const normalized: MemoryInput = { ...input, ownerId, sources: input.sources.map(normalizeSource) };
    if (normalized.sources.some((source) => !checksumPattern.test(source.checksum))) reject("Source checksum is invalid", "INVALID_SOURCE_CHECKSUM");
    validateScopeOwnership(actor, normalized);
    if (normalized.expiresAt && normalized.expiresAt <= this.now()) reject("Memory expiry must be in the future", "INVALID_EXPIRY");
    if ((normalized.scope === "TEAM" || normalized.scope === "WORKSPACE") && this.options.canAccessSharedScope && !(await canAccessMemory(actor, { id: "proposal", scope: normalized.scope, ownerId: normalized.ownerId ?? null, departmentId: normalized.departmentId ?? null }, this.options.canAccessSharedScope))) reject("Actor cannot access shared memory", "SCOPE_FORBIDDEN");
    for (const source of normalized.sources) {
      if (this.options.sourceChecksumVerifier && !await this.options.sourceChecksumVerifier(actor, source)) reject("Source checksum does not match", "INVALID_SOURCE_CHECKSUM");
      if (!await this.verifySource(actor, source)) reject("Memory source is not visible", "SOURCE_NOT_VISIBLE");
    }
    const autoApprove = normalized.scope === "USER" && normalized.kind === "PREFERENCE" && normalized.provenance === "USER_PROVIDED";
    const record = await this.adapter.create({ ...normalized, state: autoApprove ? "APPROVED" : "PROPOSED", freshness: "FRESH", supersededById: null, approval: autoApprove ? { actorId: actor.id, at: this.now(), reason: "non-sensitive user presentation preference" } : undefined });
    if (this.options.eventBus) await this.options.eventBus.publish({ name: "memory.proposed", correlationId: record.id, actorId: actor.id, entityRefs: record.sources, payload: { memoryId: record.id, state: record.state } }).catch(() => undefined);
    return record;
  }
  async getMemory(id: string): Promise<MemoryRecord | null> { return this.adapter.get(id); }
  private async mutate(id: string, actor: SabahActor, patch: Partial<MemoryRecord>): Promise<MemoryRecord> { const row = await this.adapter.get(id); if (!row) throw new MemoryServiceError("Memory not found", "MEMORY_NOT_FOUND"); validateScopeOwnership(actor, row); if ((row.scope === "TEAM" || row.scope === "WORKSPACE") && !(await canApproveMemory(actor, row, this.options.canApproveSharedScope))) throw new MemoryAuthorizationError("Actor cannot mutate shared memory", "MEMORY_SCOPE_FORBIDDEN"); return this.adapter.update(id, patch, { state: row.state, supersededById: row.supersededById ?? null }); }
  private async verifySource(actor: SabahActor, source: SourceRef): Promise<boolean> { const status: SourceVerification | boolean = this.options.sourceVerifier ? await this.options.sourceVerifier(actor, source) : false; return status === true || status === "CURRENT"; }
  private async decision(id: string, actor: SabahActor, reason: string, state: "APPROVED" | "REJECTED"): Promise<MemoryRecord> { const row = await this.adapter.get(id); if (!row) throw new MemoryServiceError("Memory not found", "MEMORY_NOT_FOUND"); if (row.state !== "PROPOSED") reject("Only proposed memories can be decided", "INVALID_STATE"); if (row.expiresAt && row.expiresAt <= this.now()) reject("Expired memories cannot be decided", "INVALID_STATE"); if (!await canApproveMemory(actor, row, this.options.canApproveSharedScope)) throw new MemoryAuthorizationError("Actor cannot decide this memory", "APPROVAL_FORBIDDEN"); if (!reason.trim() || reason.length > 500) reject("Approval reason is invalid", "INVALID_REASON"); for (const source of row.sources) { if (this.options.sourceChecksumVerifier && !await this.options.sourceChecksumVerifier(actor, source)) reject("Source checksum does not match", "INVALID_SOURCE_CHECKSUM"); if (!await this.verifySource(actor, source)) reject("Memory source is not visible", "SOURCE_NOT_VISIBLE"); } return this.adapter.update(id, { state, approval: { actorId: actor.id, at: this.now(), reason: reason.trim() } }, { state: "PROPOSED", supersededById: row.supersededById ?? null }); }
  async approveMemory(id: string, actor: SabahActor, reason: string): Promise<MemoryRecord> { return this.decision(id, actor, reason, "APPROVED"); }
  async rejectMemory(id: string, actor: SabahActor, reason = "rejected"): Promise<MemoryRecord> { return this.decision(id, actor, reason, "REJECTED"); }
  async archiveMemory(id: string, actor: SabahActor): Promise<MemoryRecord> { return this.mutate(id, actor, { state: "ARCHIVED" }); }
  async supersedeMemory(oldId: string, newId: string, actor: SabahActor): Promise<MemoryRecord> { return this.adapter.transaction(async () => { if (oldId === newId) reject("A memory cannot supersede itself", "INVALID_SUPERSESSION"); const old = await this.adapter.get(oldId); const next = await this.adapter.get(newId); if (!old || !next) throw new MemoryServiceError("Memory not found", "MEMORY_NOT_FOUND"); validateScopeOwnership(actor, old); validateScopeOwnership(actor, next); if (old.scope !== next.scope || old.kind !== next.kind || old.state !== "APPROVED" || next.state !== "APPROVED" || old.supersededById || next.supersededById || old.expiresAt && old.expiresAt <= this.now() || next.expiresAt && next.expiresAt <= this.now()) reject("Supersession requires compatible active approved memories", "INVALID_SUPERSESSION"); if ((old.scope === "TEAM" || old.scope === "WORKSPACE") && (!(await canApproveMemory(actor, old, this.options.canApproveSharedScope)) || !(await canApproveMemory(actor, next, this.options.canApproveSharedScope)))) throw new MemoryAuthorizationError("Actor cannot mutate shared memory", "MEMORY_SCOPE_FORBIDDEN"); if (this.adapter.supersede) return this.adapter.supersede(oldId, newId, { state: "APPROVED", supersededById: null }, { state: "APPROVED", supersededById: null }); return this.adapter.update(oldId, { state: "SUPERSEDED", supersededById: newId }, { state: "APPROVED", supersededById: null }); }); }
}
export const createMemoryService = (adapter: MemoryAdapter, options?: MemoryServiceOptions): MemoryService => new MemoryService(adapter, options);
