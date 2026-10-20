import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { callGLMText } from "@/lib/glm";
import { resolveOperationalAiTarget } from "@/lib/ai/provider-resolution";
import { getSabahFlags } from "@/lib/sabah/flags";
import {
  buildBootstrapMemoPrompt,
  REPORT_HISTORY_EXAMPLE_KEY,
  STYLE_MEMO_KEY,
  validateMemo,
  validateMemoCandidate,
  type ReportStyleExample,
} from "@/lib/report-lessons";

export const REPORT_HISTORY_MAX_ENTRIES = 5;
export const REPORT_HISTORY_MAX_CONTENT_CHARS = 2000;

export const reportHistoryEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "History date must be YYYY-MM-DD"),
  // Do not trim this field: the submitted source text is preserved byte-for-byte
  // as represented by the request body.
  content: z.string().min(1).max(REPORT_HISTORY_MAX_CONTENT_CHARS).refine((value) => value.trim().length > 0, "History text must not be blank"),
}).strict();

export const reportHistoryBootstrapSchema = z.object({
  approved: z.literal(true),
  entries: z.array(reportHistoryEntrySchema).min(1).max(REPORT_HISTORY_MAX_ENTRIES),
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
}).strict();

export type ReportHistoryBootstrapInput = z.infer<typeof reportHistoryBootstrapSchema>;
export type ReportHistoryEntryInput = z.infer<typeof reportHistoryEntrySchema>;
export type ReportHistoryEntry = ReportHistoryEntryInput & { sourceId: string; checksum: string; sourceUpdatedAt: string };

type HistoryMemorySource = {
  sourceId: string;
  date: string;
  checksum: string;
  sourceUpdatedAt: string;
  label: string;
  href: string;
  locatorExtra?: Record<string, string>;
};

type ReportStyleMemoryAudit = {
  entityType: string;
  entityId: string;
  action: string;
  outcome?: "ACCEPTED" | "EDITED";
  draftHash?: string;
  finalHash?: string;
  learnRequested?: boolean;
  source?: string;
};

export type PersistReportStyleMemoInput = {
  ownerId: string;
  state: "PROPOSED";
  provenance?: "GENERATED" | "USER_PROVIDED" | "IMPORTED" | "SYSTEM";
  memo: string;
  sources: HistoryMemorySource[];
  audit: ReportStyleMemoryAudit;
  /** Content-batch key used by history imports for locked idempotency. */
  batchKey?: string;
};

export type ApproveReportStyleMemoInput = {
  memoryId: string;
  ownerId: string;
  reason: string;
};

export type PersistReportStyleMemoResult = {
  learned: boolean;
  memoryId: string | null;
  auditId: string | null;
  supersededCount: number;
  disabled: false;
};

export type ReportMemoryDisabledResult = {
  learned: false;
  memoryId: null;
  auditId: null;
  supersededCount: 0;
  disabled: true;
};

export type ReportStyleProposal = {
  id: string;
  content: string;
  provenance: "GENERATED" | "USER_PROVIDED" | "IMPORTED" | "SYSTEM";
  state: "PROPOSED";
  createdAt?: string;
  updatedAt?: string;
};

type BootstrapExampleResult = { date: string; sourceId: string; checksum: string; imported: boolean };

export type BootstrapReportHistoryResult = {
  success: true;
  importedCount: number;
  replayedCount: number;
  learned: boolean;
  memoryId: string | null;
  examples: BootstrapExampleResult[];
  disabled?: false;
} | DisabledBootstrapReportHistoryResult;

export type DisabledBootstrapReportHistoryResult = {
  success: true;
  importedCount: 0;
  replayedCount: 0;
  learned: false;
  memoryId: null;
  examples: [];
  disabled: true;
};

const checksum = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");
const historySourceId = (date: string): string => `report-history-${date}`;
const validChecksum = /^[a-f0-9]{64}$/i;
const validDate = /^\d{4}-\d{2}-\d{2}$/;

export function isReportMemoryEnabled(): boolean {
  return getSabahFlags().memory;
}

const disabledMemoryResult = (): ReportMemoryDisabledResult => ({
  learned: false,
  memoryId: null,
  auditId: null,
  supersededCount: 0,
  disabled: true,
});

function invalid(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, status: 400 });
}

function forbidden(code: string, message: string): never {
  throw Object.assign(new Error(message), { code, status: 403 });
}

function assertDate(date: string): void {
  if (!validDate.test(date)) invalid("INVALID_HISTORY_DATE", "History date must be YYYY-MM-DD");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) invalid("INVALID_HISTORY_DATE", "History date is not a real calendar date");
}

export function parseReportHistoryEntries(raw: ReportHistoryBootstrapInput): ReportHistoryEntry[] {
  if (!raw || raw.approved !== true) invalid("HISTORY_APPROVAL_REQUIRED", "Explicit approval is required to import report history");
  const parsed = reportHistoryBootstrapSchema.safeParse(raw);
  if (!parsed.success) invalid("INVALID_HISTORY_INPUT", parsed.error.issues[0]?.message ?? "Invalid report history input");
  const seen = new Set<string>();
  return parsed.data.entries.map((entry) => {
    assertDate(entry.date);
    if (seen.has(entry.date)) invalid("DUPLICATE_HISTORY_DATE", "History dates must be unique");
    seen.add(entry.date);
    const contentChecksum = checksum(entry.content);
    return {
      date: entry.date,
      content: entry.content,
      sourceId: historySourceId(entry.date),
      checksum: contentChecksum,
      sourceUpdatedAt: `${entry.date}T00:00:00.000Z`,
    };
  });
}

function batchHash(entries: ReportHistoryEntry[]): string {
  return checksum(entries.slice().sort((a, b) => a.date.localeCompare(b.date)).map((entry) => `${entry.date}\u0000${entry.content}`).join("\u0001"));
}

function historySource(entry: ReportHistoryEntry, locatorExtra?: Record<string, string>): HistoryMemorySource {
  return {
    sourceId: entry.sourceId,
    date: entry.date,
    checksum: entry.checksum,
    sourceUpdatedAt: entry.sourceUpdatedAt,
    label: `Historical weekly report — ${entry.date}`,
    href: `/reports?historyDate=${entry.date}`,
    locatorExtra,
  };
}

function sourceLocator(source: HistoryMemorySource, memoKey: string): string {
  return JSON.stringify({
    memoKey,
    date: source.date,
    label: source.label,
    href: source.href,
    sourceUpdatedAt: source.sourceUpdatedAt,
    checksum: source.checksum,
    ...(source.locatorExtra ?? {}),
  });
}

const styleMemoWhere = (ownerId: string) => ({
  ownerId,
  scope: "USER" as const,
  kind: "PREFERENCE" as const,
  state: "APPROVED" as const,
  supersededById: null,
  sources: { some: { sourceType: "REPORT", locatorJson: { contains: STYLE_MEMO_KEY } } },
});

const styleMemoBatchWhere = (ownerId: string, batchKey: string) => ({
  ownerId,
  scope: "USER" as const,
  kind: "PREFERENCE" as const,
  state: { in: ["PROPOSED", "APPROVED"] as ("PROPOSED" | "APPROVED")[] },
  supersededById: null,
  sources: { some: { sourceType: "REPORT", locatorJson: { contains: batchKey } } },
});

const historyExampleWhere = (ownerId: string) => ({
  ownerId,
  scope: "USER" as const,
  kind: "LESSON" as const,
  state: "APPROVED" as const,
  supersededById: null,
  sources: { some: { sourceType: "REPORT", locatorJson: { contains: REPORT_HISTORY_EXAMPLE_KEY } } },
});

function parseHistorySource(source: { sourceType: string; sourceId: string; locatorJson: string | null }): { date: string; sourceId: string; checksum: string; sourceUpdatedAt: string; label: string; href: string } | null {
  if (source.sourceType !== "REPORT" || !source.locatorJson || !source.sourceId.startsWith("report-history-")) return null;
  try {
    const locator = JSON.parse(source.locatorJson) as Record<string, unknown>;
    if (locator.memoKey !== REPORT_HISTORY_EXAMPLE_KEY || typeof locator.date !== "string" || !validDate.test(locator.date) || typeof locator.checksum !== "string" || !validChecksum.test(locator.checksum) || typeof locator.sourceUpdatedAt !== "string" || Number.isNaN(Date.parse(locator.sourceUpdatedAt)) || locator.sourceUpdatedAt.slice(0, 10) !== locator.date || typeof locator.label !== "string" || typeof locator.href !== "string") return null;
    assertDate(locator.date);
    if (source.sourceId !== historySourceId(locator.date)) return null;
    return { date: locator.date, sourceId: source.sourceId, checksum: locator.checksum.toLowerCase(), sourceUpdatedAt: locator.sourceUpdatedAt, label: locator.label, href: locator.href };
  } catch {
    return null;
  }
}

export async function getReportStyleMemoForActor(ownerId: string): Promise<string | null> {
  if (!isReportMemoryEnabled() || !ownerId) return null;
  const row = await prisma.aiMemory.findFirst({ where: styleMemoWhere(ownerId), orderBy: { updatedAt: "desc" }, select: { content: true } });
  if (typeof row?.content !== "string") return null;
  // The stored content may carry pre-normalization whitespace while still
  // passing validation; validateMemo already returns the normalized form, so
  // require a valid memo (not byte-identity with the raw row) before use.
  return validateMemo(row.content);
}

export async function getReportHistoryForActor(ownerId: string): Promise<Array<ReportStyleExample & { id: string }>> {
  if (!isReportMemoryEnabled() || !ownerId) return [];
  const rows = await prisma.aiMemory.findMany({
    where: historyExampleWhere(ownerId),
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, ownerId: true, content: true, provenance: true, sources: { select: { sourceType: true, sourceId: true, locatorJson: true } } },
  });
  return rows
    .filter((row) => row.ownerId === ownerId)
    .flatMap((row) => {
      const source = row.sources.map(parseHistorySource).find((value): value is NonNullable<typeof value> => value !== null);
      if (!source || typeof row.content !== "string" || checksum(row.content) !== source.checksum || !["USER_PROVIDED", "IMPORTED", "GENERATED", "SYSTEM"].includes(row.provenance)) return [];
      return [{ id: row.id, content: row.content, date: source.date, sourceId: source.sourceId, checksum: source.checksum, sourceUpdatedAt: source.sourceUpdatedAt, provenance: row.provenance as ReportStyleExample["provenance"] }];
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export async function getReportPromptExtrasForActor(ownerId: string) {
  if (!isReportMemoryEnabled() || !ownerId) return { styleMemo: null, styleExamples: [] } as const;
  const styleMemo = await getReportStyleMemoForActor(ownerId);
  const styleExamples = await getReportHistoryForActor(ownerId);
  return { styleMemo, styleExamples: styleExamples.slice(0, 5) } as const;
}

export async function getReportStyleProposalsForActor(ownerId: string): Promise<ReportStyleProposal[]> {
  if (!isReportMemoryEnabled() || !ownerId) return [];
  const rows = await prisma.aiMemory.findMany({
    where: {
      ownerId,
      scope: "USER",
      kind: "PREFERENCE",
      state: "PROPOSED",
      supersededById: null,
      sources: { some: { sourceType: "REPORT", locatorJson: { contains: STYLE_MEMO_KEY } } },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: { id: true, content: true, provenance: true, state: true, createdAt: true, updatedAt: true },
  });
  return rows
    .filter((row: any) => row.ownerId === undefined || row.ownerId === ownerId)
    .filter((row: any) => typeof row.content === "string" && row.content.trim() && ["GENERATED", "USER_PROVIDED", "IMPORTED", "SYSTEM"].includes(row.provenance) && row.state === "PROPOSED")
    .map((row: any) => ({
      id: row.id,
      content: row.content,
      provenance: row.provenance,
      state: "PROPOSED" as const,
      ...(row.createdAt ? { createdAt: new Date(row.createdAt).toISOString() } : {}),
      ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt).toISOString() } : {}),
    }));
}

async function acquireActorLock(tx: any, ownerId: string): Promise<void> {
  // PostgreSQL is the production datasource. The optional check keeps unit
  // adapters usable while serializable isolation remains the fallback fence.
  if (typeof tx?.$executeRaw === "function") {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`);
  }
}

async function serializable<T>(ownerId: string, work: (tx: any) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        await acquireActorLock(tx, ownerId);
        return work(tx);
      }, { isolationLevel: "ReadCommitted" });
    } catch (error: any) {
      if (error?.code !== "P2034" || attempt === 1) throw error;
    }
  }
  throw new Error("Serializable transaction failed");
}

function validMemoryReadback(row: any, memoryId: string, ownerId: string, memo: string, state: "PROPOSED" | "APPROVED"): boolean {
  return Boolean(row && row.id === memoryId && row.ownerId === ownerId && row.scope === "USER" && row.kind === "PREFERENCE" && row.state === state && row.supersededById == null && row.content === memo && Array.isArray(row.sources) && row.sources.length > 0);
}

export async function persistReportStyleMemo(input: PersistReportStyleMemoInput): Promise<PersistReportStyleMemoResult | ReportMemoryDisabledResult> {
  if (!isReportMemoryEnabled()) return disabledMemoryResult();
  if (!input.ownerId) return { learned: false, memoryId: null, auditId: null, supersededCount: 0, disabled: false };
  const memo = validateMemoCandidate(input.memo);
  if (!memo || input.sources.length === 0) return { learned: false, memoryId: null, auditId: null, supersededCount: 0, disabled: false };
  const memoHash = checksum(`memo:${memo}`);
  return serializable(input.ownerId, async (tx) => {
    if (input.batchKey) {
      const existing = await tx.aiMemory.findFirst({ where: styleMemoBatchWhere(input.ownerId, input.batchKey), select: { id: true, state: true } });
      if (existing) return { learned: (existing.state as string) === "APPROVED", memoryId: existing.id, auditId: null, supersededCount: 0, disabled: false };
    }
    const created = await tx.aiMemory.create({
      data: {
        scope: "USER",
        kind: "PREFERENCE",
        state: input.state,
        content: memo,
        provenance: input.provenance ?? "GENERATED",
        confidence: 0.6,
        freshness: "FRESH",
        ownerId: input.ownerId,
        sources: { create: input.sources.map((source) => ({ sourceType: "REPORT", sourceId: source.sourceId, locatorJson: sourceLocator(source, STYLE_MEMO_KEY) })) },
      },
      select: { id: true },
    });
    const memoryApproved = (input.state as string) === "APPROVED";
    const audit = await tx.auditLog.create({
      data: {
        entityType: input.audit.entityType,
        entityId: input.audit.entityId,
        action: input.audit.action,
        actorId: input.ownerId,
        metaJson: JSON.stringify({
          source: input.audit.source ?? "report-style-learning",
          action: input.audit.action,
          approval: memoryApproved,
          memoryApproved,
          learningRequestApproved: input.audit.learnRequested === true,
          scope: "PERSONAL",
          ownerId: input.ownerId,
          reportId: input.audit.entityType === "weekly_report" ? input.audit.entityId : undefined,
          outcome: input.audit.outcome,
          draftHash: input.audit.draftHash,
          finalHash: input.audit.finalHash,
          learnRequested: input.audit.learnRequested,
          memoKey: STYLE_MEMO_KEY,
          memoHash,
          memoryState: input.state,
          memoryPersisted: true,
          memoryId: created.id,
        }),
      },
      select: { id: true },
    });
    const [memoryReadBack, auditReadBack] = await Promise.all([
      tx.aiMemory.findUnique({ where: { id: created.id }, select: { id: true, ownerId: true, scope: true, kind: true, state: true, content: true, supersededById: true, sources: { select: { sourceType: true, sourceId: true, locatorJson: true } } } }),
      tx.auditLog.findUnique({ where: { id: audit.id }, select: { id: true, actorId: true, entityType: true, entityId: true, action: true } }),
    ]);
    if (!validMemoryReadback(memoryReadBack, created.id, input.ownerId, memo, input.state) || !auditReadBack || auditReadBack.id !== audit.id || auditReadBack.actorId !== input.ownerId || auditReadBack.entityType !== input.audit.entityType || auditReadBack.entityId !== input.audit.entityId || auditReadBack.action !== input.audit.action) throw new Error("Governed report style memory read-back failed");
    return { learned: false, memoryId: created.id, auditId: audit.id, supersededCount: 0, disabled: false };
  });
}

export async function approveReportStyleMemo(input: ApproveReportStyleMemoInput): Promise<PersistReportStyleMemoResult | ReportMemoryDisabledResult> {
  if (!isReportMemoryEnabled()) return disabledMemoryResult();
  if (!input.ownerId || !input.memoryId) forbidden("MEMORY_APPROVAL_FORBIDDEN", "An authenticated owner is required");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) invalid("INVALID_APPROVAL_REASON", "Approval reason is required");
  return serializable(input.ownerId, async (tx) => {
    const proposed = await tx.aiMemory.findUnique({
      where: { id: input.memoryId },
      select: { id: true, ownerId: true, scope: true, kind: true, state: true, content: true, supersededById: true, sources: { select: { sourceType: true, sourceId: true, locatorJson: true } } },
    });
    if (!proposed || proposed.ownerId !== input.ownerId || proposed.scope !== "USER" || proposed.kind !== "PREFERENCE" || proposed.state !== "PROPOSED" || proposed.supersededById != null || !proposed.sources?.some((source: any) => source.sourceType === "REPORT" && source.locatorJson?.includes(STYLE_MEMO_KEY))) forbidden("MEMORY_APPROVAL_FORBIDDEN", "The style proposal is not owned by this actor");
    const validatedMemo = typeof proposed.content === "string" ? validateMemo(proposed.content) : null;
    if (!validatedMemo || validatedMemo !== proposed.content) invalid("INVALID_MEMORY_CONTENT", "The style proposal does not meet the approved memo contract");
    const current = await tx.aiMemory.findMany({ where: styleMemoWhere(input.ownerId), select: { id: true, state: true, supersededById: true } });
    const updated = await tx.aiMemory.updateMany({
      where: { id: input.memoryId, ownerId: input.ownerId, scope: "USER", kind: "PREFERENCE", state: "PROPOSED", supersededById: null },
      data: { state: "APPROVED" },
    });
    if (updated.count !== 1) invalid("MEMORY_APPROVAL_RACE", "The style proposal changed before approval");
    const audit = await tx.auditLog.create({
      data: {
        entityType: "ai_memory",
        entityId: input.memoryId,
        action: "capability:reports.lessons.accept",
        actorId: input.ownerId,
        metaJson: JSON.stringify({ source: "report-style-learning", action: "APPROVE", approval: true, scope: "PERSONAL", ownerId: input.ownerId, memoryId: input.memoryId, memoKey: STYLE_MEMO_KEY, reasonHash: checksum(`reason:${reason}`), previousState: "PROPOSED", state: "APPROVED" }),
      },
      select: { id: true },
    });
    let supersededCount = 0;
    const currentIds = current.map((row: { id: string }) => row.id).filter((id: string) => id !== input.memoryId);
    if (currentIds.length > 0) {
      const superseded = await tx.aiMemory.updateMany({
        where: { id: { in: currentIds }, ownerId: input.ownerId, scope: "USER", kind: "PREFERENCE", state: "APPROVED", supersededById: null },
        data: { state: "SUPERSEDED", supersededById: input.memoryId },
      });
      supersededCount = superseded.count;
    }
    const [memoryReadBack, auditReadBack] = await Promise.all([
      tx.aiMemory.findUnique({ where: { id: input.memoryId }, select: { id: true, ownerId: true, scope: true, kind: true, state: true, content: true, supersededById: true, sources: { select: { sourceType: true, sourceId: true, locatorJson: true } } } }),
      tx.auditLog.findUnique({ where: { id: audit.id }, select: { id: true, actorId: true, entityType: true, entityId: true, action: true } }),
    ]);
    if (!validMemoryReadback(memoryReadBack, input.memoryId, input.ownerId, proposed.content, "APPROVED") || !auditReadBack || auditReadBack.id !== audit.id || auditReadBack.actorId !== input.ownerId || auditReadBack.entityType !== "ai_memory" || auditReadBack.entityId !== input.memoryId || auditReadBack.action !== "capability:reports.lessons.accept") throw new Error("Approved report style memory read-back failed");
    return { learned: true, memoryId: input.memoryId, auditId: audit.id, supersededCount, disabled: false };
  });
}

export async function rejectReportStyleMemo(input: ApproveReportStyleMemoInput): Promise<PersistReportStyleMemoResult | ReportMemoryDisabledResult> {
  if (!isReportMemoryEnabled()) return disabledMemoryResult();
  if (!input.ownerId || !input.memoryId) forbidden("MEMORY_DECISION_FORBIDDEN", "An authenticated owner is required");
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) invalid("INVALID_DECISION_REASON", "Decision reason is required");
  return serializable(input.ownerId, async (tx) => {
    const proposed = await tx.aiMemory.findUnique({
      where: { id: input.memoryId },
      select: { id: true, ownerId: true, scope: true, kind: true, state: true, content: true, supersededById: true, sources: { select: { sourceType: true, sourceId: true, locatorJson: true } } },
    });
    if (!proposed || proposed.ownerId !== input.ownerId || proposed.scope !== "USER" || proposed.kind !== "PREFERENCE" || proposed.state !== "PROPOSED" || proposed.supersededById != null || !proposed.sources?.some((source: any) => source.sourceType === "REPORT" && source.locatorJson?.includes(STYLE_MEMO_KEY))) forbidden("MEMORY_DECISION_FORBIDDEN", "The style proposal is not owned by this actor");
    const updated = await tx.aiMemory.updateMany({
      where: { id: input.memoryId, ownerId: input.ownerId, scope: "USER", kind: "PREFERENCE", state: "PROPOSED", supersededById: null },
      data: { state: "REJECTED" },
    });
    if (updated.count !== 1) invalid("MEMORY_DECISION_RACE", "The style proposal changed before rejection");
    const audit = await tx.auditLog.create({
      data: {
        entityType: "ai_memory",
        entityId: input.memoryId,
        action: "capability:reports.lessons.reject",
        actorId: input.ownerId,
        metaJson: JSON.stringify({ source: "report-style-learning", action: "REJECT", approval: false, memoryApproved: false, scope: "PERSONAL", ownerId: input.ownerId, memoryId: input.memoryId, memoKey: STYLE_MEMO_KEY, reasonHash: checksum(`reason:${reason}`), previousState: "PROPOSED", state: "REJECTED" }),
      },
      select: { id: true },
    });
    const readBack = await tx.aiMemory.findUnique({ where: { id: input.memoryId }, select: { id: true, ownerId: true, scope: true, kind: true, state: true, supersededById: true } });
    const auditReadBack = await tx.auditLog.findUnique({ where: { id: audit.id }, select: { id: true, actorId: true, entityType: true, entityId: true, action: true } });
    if (!readBack || readBack.id !== input.memoryId || readBack.ownerId !== input.ownerId || readBack.scope !== "USER" || readBack.kind !== "PREFERENCE" || readBack.state !== "REJECTED" || readBack.supersededById != null || !auditReadBack || auditReadBack.id !== audit.id || auditReadBack.actorId !== input.ownerId || auditReadBack.entityType !== "ai_memory" || auditReadBack.entityId !== input.memoryId || auditReadBack.action !== "capability:reports.lessons.reject") throw new Error("Rejected report style memory read-back failed");
    return { learned: false, memoryId: input.memoryId, auditId: audit.id, supersededCount: 0, disabled: false };
  });
}

async function importExamples(ownerId: string, entries: ReportHistoryEntry[], batchKey: string): Promise<{ importedCount: number; replayedCount: number; examples: BootstrapExampleResult[] }> {
  return serializable(ownerId, async (tx) => {
    const sourceIds = entries.map((entry) => entry.sourceId);
    const existing = await tx.aiMemory.findMany({
      where: { ownerId, scope: "USER", kind: "LESSON", sources: { some: { sourceType: "REPORT", sourceId: { in: sourceIds } } } },
      select: { id: true, ownerId: true, state: true, provenance: true, content: true, sources: { select: { sourceType: true, sourceId: true, locatorJson: true } } },
    });
    const bySource = new Map<string, any>();
    for (const row of existing) for (const source of row.sources) if (source.sourceType === "REPORT" && sourceIds.includes(source.sourceId)) bySource.set(source.sourceId, { ...row, source });
    for (const entry of entries) {
      const prior = bySource.get(entry.sourceId);
      const priorSource = prior ? parseHistorySource(prior.source) : null;
      if (prior && (prior.ownerId !== ownerId || prior.state !== "APPROVED" || prior.provenance !== "USER_PROVIDED" || prior.content !== entry.content || !priorSource || priorSource.checksum !== entry.checksum)) invalid("HISTORY_SOURCE_CONFLICT", `History source ${entry.date} already exists with different text`);
    }
    const results: BootstrapExampleResult[] = [];
    for (const entry of entries) {
      const prior = bySource.get(entry.sourceId);
      if (prior) {
        results.push({ date: entry.date, sourceId: entry.sourceId, checksum: entry.checksum, imported: false });
        continue;
      }
      const created = await tx.aiMemory.create({
        data: {
          scope: "USER",
          kind: "LESSON",
          state: "APPROVED",
          content: entry.content,
          provenance: "USER_PROVIDED",
          confidence: 1,
          freshness: "FRESH",
          ownerId,
          sources: { create: [{ sourceType: "REPORT", sourceId: entry.sourceId, locatorJson: sourceLocator(historySource(entry), REPORT_HISTORY_EXAMPLE_KEY) }] },
        },
        select: { id: true },
      });
      const readBack = await tx.aiMemory.findUnique({ where: { id: created.id }, select: { id: true, ownerId: true, scope: true, kind: true, state: true, content: true, provenance: true, sources: { select: { sourceType: true, sourceId: true, locatorJson: true } } } });
      const readBackSource = readBack?.sources?.map(parseHistorySource).find((source: any) => source?.sourceId === entry.sourceId);
      if (!readBack || readBack.id !== created.id || readBack.ownerId !== ownerId || readBack.scope !== "USER" || readBack.kind !== "LESSON" || readBack.state !== "APPROVED" || readBack.provenance !== "USER_PROVIDED" || readBack.content !== entry.content || !readBackSource || readBackSource.checksum !== entry.checksum) throw new Error("Report history example read-back failed");
      results.push({ date: entry.date, sourceId: entry.sourceId, checksum: entry.checksum, imported: true });
    }
    const audit = await tx.auditLog.create({
      data: {
        entityType: "report_learning_history",
        entityId: `report-history-${batchKey.slice(0, 32)}`,
        action: "capability:reports.lessons.bootstrap",
        actorId: ownerId,
        metaJson: JSON.stringify({ source: "user-supplied-report-history", approval: true, scope: "PERSONAL", ownerId, batchKey, dates: entries.map((entry) => entry.date), entries: results.map((entry) => ({ date: entry.date, sourceId: entry.sourceId, checksum: entry.checksum, imported: entry.imported })), memoryPersisted: true }),
      },
      select: { id: true },
    });
    const auditReadBack = await tx.auditLog.findUnique({ where: { id: audit.id }, select: { id: true, actorId: true, entityType: true, action: true } });
    if (!auditReadBack || auditReadBack.id !== audit.id || auditReadBack.actorId !== ownerId || auditReadBack.entityType !== "report_learning_history" || auditReadBack.action !== "capability:reports.lessons.bootstrap") throw new Error("Report history audit read-back failed");
    return { importedCount: results.filter((entry) => entry.imported).length, replayedCount: results.filter((entry) => !entry.imported).length, examples: results };
  });
}

export async function bootstrapReportHistory(input: ReportHistoryBootstrapInput, ownerId: string): Promise<BootstrapReportHistoryResult> {
  if (!ownerId) invalid("AUTHENTICATION_REQUIRED", "Authenticated actor is required");
  if (!isReportMemoryEnabled()) return { success: true, importedCount: 0, replayedCount: 0, learned: false, memoryId: null, examples: [], disabled: true };
  const entries = parseReportHistoryEntries(input).sort((a, b) => b.date.localeCompare(a.date));
  const contentBatchHash = batchHash(entries);
  const batchKey = input.idempotencyKey?.trim() || `report-history-${contentBatchHash}`;
  const auditEntityId = `report-history-${checksum(`${ownerId}:${batchKey}`).slice(0, 32)}`;
  const imported = await importExamples(ownerId, entries, batchKey);
  let learned = false;
  let memoryId: string | null = null;
  try {
    const currentMemo = await getReportStyleMemoForActor(ownerId);
    const target = await resolveOperationalAiTarget();
    const raw = await callGLMText(buildBootstrapMemoPrompt(entries, currentMemo), { provider: target.provider, model: target.model, fallbacks: target.fallbacks, credentials: target.credentials, temperature: 0.2, max_tokens: 900, thinking: "disabled" });
    const memo = validateMemo(raw);
    if (memo) {
      const persisted = await persistReportStyleMemo({
        ownerId,
        state: "PROPOSED",
        provenance: "GENERATED",
        memo,
        sources: entries.map((entry) => historySource(entry, { batchKey, contentBatchHash })),
        batchKey: contentBatchHash,
        audit: { entityType: "report_learning_history", entityId: auditEntityId, action: "capability:reports.lessons.bootstrap", learnRequested: true, source: "user-supplied-report-history" },
      });
      learned = persisted.learned;
      memoryId = persisted.memoryId;
    }
  } catch {
    // The exact user-owned examples remain durable even when memo generation is unavailable.
  }
  return { success: true, ...imported, learned, memoryId };
}
