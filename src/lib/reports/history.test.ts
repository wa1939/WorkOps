import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows: any[] = [];
const audits: any[] = [];
const reportRows: any[] = [];
let memorySequence = 0;
let auditSequence = 0;
let transactionTail: Promise<void> = Promise.resolve();

const matchesWhere = (row: any, where: any = {}) => {
  if (where.ownerId !== undefined && row.ownerId !== where.ownerId) return false;
  if (where.scope !== undefined && row.scope !== where.scope) return false;
  if (where.kind !== undefined && row.kind !== where.kind) return false;
  if (where.state !== undefined) {
    if (typeof where.state === "object" && Array.isArray(where.state.in) && !where.state.in.includes(row.state)) return false;
    if (typeof where.state === "string" && row.state !== where.state) return false;
  }
  if (where.supersededById !== undefined && row.supersededById !== where.supersededById) return false;
  const sourceFilter = where.sources?.some;
  if (sourceFilter && !row.sources.some((source: any) => {
    if (sourceFilter.sourceType !== undefined && source.sourceType !== sourceFilter.sourceType) return false;
    const sourceId = sourceFilter.sourceId;
    if (typeof sourceId === "string" && source.sourceId !== sourceId) return false;
    if (sourceId?.in && !sourceId.in.includes(source.sourceId)) return false;
    const contains = sourceFilter.locatorJson?.contains;
    if (contains && !source.locatorJson.includes(contains)) return false;
    return true;
  })) return false;
  return true;
};

const memoryFindMany = vi.fn(async ({ where }: any = {}) => rows.filter((row) => matchesWhere(row, where)));
const memoryFindFirst = vi.fn(async ({ where }: any = {}) => rows.find((row) => matchesWhere(row, where)) ?? null);
const memoryFindUnique = vi.fn(async ({ where }: any = {}) => rows.find((row) => row.id === where.id) ?? null);
const memoryCreate = vi.fn(async ({ data }: any) => {
  const row = {
    id: `memory-${++memorySequence}`,
    ...data,
    supersededById: data.supersededById ?? null,
    sources: (data.sources?.create ?? []).map((source: any) => ({ id: `source-${memorySequence}`, ...source })),
  };
  rows.push(row);
  return { id: row.id };
});
const memoryUpdateMany = vi.fn(async ({ where, data }: any) => {
  const selected = rows.filter((row) => matchesWhere(row, where));
  selected.forEach((row) => Object.assign(row, data));
  return { count: selected.length };
});
const auditCreate = vi.fn(async ({ data }: any) => {
  const row = { id: `audit-${++auditSequence}`, ...data };
  audits.push(row);
  return { id: row.id };
});
const auditFindUnique = vi.fn(async ({ where }: any) => audits.find((row) => row.id === where.id) ?? null);
const reportFindUnique = vi.fn(async ({ where }: any) => {
  const row = reportRows.find((candidate) => candidate.id === where.id);
  return row ? { ...row } : null;
});
const reportUpdateMany = vi.fn(async ({ where, data }: any) => {
  const selected = reportRows.filter((row) => row.id === where.id && (where.submittedAt === undefined || (where.submittedAt === null ? row.submittedAt === null : row.submittedAt === where.submittedAt)));
  selected.forEach((row) => Object.assign(row, data));
  return { count: selected.length };
});
const taskFindMany = vi.fn(async (_args?: any) => []);
const kpiFindMany = vi.fn(async (_args?: any) => []);
const projectFindMany = vi.fn(async (_args?: any) => []);
const transaction = vi.fn(async (work: (tx: any) => Promise<unknown>) => {
  const previous = transactionTail;
  let release!: () => void;
  transactionTail = new Promise<void>((resolve) => { release = resolve; });
  try {
    return await work({
      aiMemory: { findMany: memoryFindMany, findFirst: memoryFindFirst, findUnique: memoryFindUnique, create: memoryCreate, updateMany: memoryUpdateMany },
      auditLog: { create: auditCreate, findUnique: auditFindUnique },
      $executeRaw: async () => { await previous; return 0; },
    });
  } finally {
    release();
  }
});
const callGLMText = vi.fn(async (...args: any[]) => {
  const prompt = String(args[0] ?? "");
  if (prompt.includes("اكتب الذاكرة المحدثة الآن")) return [
    "صياغة: يبدأ السطر بفعل تنفيذي.",
    "صياغة: يدمج الأعمال المترابطة.",
    "صياغة: يحافظ على نبرة رسمية.",
    "صياغة: يذكر الأثر باختصار.",
    "انتقاء: يركز على الأعمال الجوهرية.",
    "انتقاء: يجمع التفاصيل المتقاربة.",
    "انتقاء: يستبعد التفاصيل الداخلية الصغيرة.",
    "انتقاء: لا يعيد إنجازات الأسابيع السابقة.",
  ].join("\n");
  return prompt.includes("STYLE_SENTINEL") || prompt.includes("صياغة: يبدأ السطر بفعل تنفيذي.") ? "draft-with-style" : "draft-without-style";
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiMemory: { findMany: (...args: any[]) => memoryFindMany(args[0]), findFirst: (...args: any[]) => memoryFindFirst(args[0]), findUnique: (...args: any[]) => memoryFindUnique(args[0]), create: (...args: any[]) => memoryCreate(args[0]), updateMany: (...args: any[]) => memoryUpdateMany(args[0]) },
    auditLog: { create: (...args: any[]) => auditCreate(args[0]), findUnique: (...args: any[]) => auditFindUnique(args[0]) },
    weeklyReport: { findUnique: (...args: any[]) => reportFindUnique(args[0]), updateMany: (...args: any[]) => reportUpdateMany(args[0]) },
    task: { findMany: (...args: any[]) => taskFindMany(args[0]) },
    kPI: { findMany: (...args: any[]) => kpiFindMany(args[0]) },
    project: { findMany: (...args: any[]) => projectFindMany(args[0]) },
    $transaction: (...args: any[]) => transaction(args[0]),
  },
}));
vi.mock("@/lib/glm", () => ({ DEFAULT_GLM_MODEL: "glm-5.3-flash", callGLMText: (...args: any[]) => callGLMText(...args) }));

import {
  approveReportStyleMemo,
  bootstrapReportHistory,
  getReportHistoryForActor,
  getReportPromptExtrasForActor,
  getReportStyleMemoForActor,
  parseReportHistoryEntries,
  persistReportStyleMemo,
  rejectReportStyleMemo,
} from "./history";
import { finalizeReport, generateDraftForPeriod, saveFinalBody, type ReportActor } from "./commands";

const actor: ReportActor = { id: "actor-1", role: "ADMIN", departmentIds: [] };
const validMemo = [
  "صياغة: يبدأ السطر بفعل تنفيذي.",
  "صياغة: يدمج الأعمال المترابطة.",
  "صياغة: يحافظ على نبرة رسمية.",
  "صياغة: يذكر الأثر باختصار.",
  "انتقاء: يركز على الأعمال الجوهرية.",
  "انتقاء: يجمع التفاصيل المتقاربة.",
  "انتقاء: يستبعد التفاصيل الداخلية الصغيرة.",
  "انتقاء: لا يعيد إنجازات الأسابيع السابقة.",
].join("\n");

function resetSyntheticReport() {
  reportRows.splice(0, reportRows.length, { id: "synthetic-report-1", weekStart: new Date("2026-08-01T00:00:00.000Z"), weekEnd: new Date("2026-08-07T23:59:59.000Z"), title: "Synthetic report", body: "synthetic AI draft", aiSummary: "synthetic AI draft", finalBody: null, submittedAt: null });
}

beforeEach(() => {
  rows.splice(0, rows.length);
  audits.splice(0, audits.length);
  resetSyntheticReport();
  memorySequence = 0;
  auditSequence = 0;
  transactionTail = Promise.resolve();
  vi.clearAllMocks();
  vi.stubEnv("SABAH_MEMORY_ENABLED", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("report history import contract", () => {
  it("uses the current shared default for history style extraction", async () => {
    await bootstrapReportHistory({ approved: true, entries: [{ date: "2026-08-16", content: "Synthetic style history." }] }, actor.id);

    expect(callGLMText.mock.calls[0][1]).toMatchObject({ model: "glm-5.3-flash", thinking: "disabled" });
  });

  it("requires explicit approval, validates real dates, and preserves exact text", () => {
    const content = "  STYLE_SENTINEL\nسطر تجريبي  ";
    const parsed = parseReportHistoryEntries({ approved: true, entries: [{ date: "2026-08-16", content }] });
    expect(parsed[0]).toMatchObject({ date: "2026-08-16", content, sourceId: "report-history-2026-08-16" });
    expect(parsed[0].checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(() => parseReportHistoryEntries({ approved: false, entries: [{ date: "2026-08-16", content }] } as any)).toThrow(/approval/i);
    expect(() => parseReportHistoryEntries({ approved: true, entries: [{ date: "2026-02-30", content }] })).toThrow(/calendar|date/i);
  });

  it("imports actor-scoped examples once without activating a proposal or injecting historical facts", async () => {
    const entries = [
      { date: "2026-08-16", content: "STYLE_SENTINEL\nتحديث أسلوب تجريبي." },
      { date: "2026-08-09", content: "مثال أسلوب تجريبي آخر." },
    ];
    const before = await generateDraftForPeriod({ weekStart: new Date("2026-08-01"), weekEnd: new Date("2026-08-07") }, actor);
    const first = await bootstrapReportHistory({ approved: true, entries }, actor.id);
    const second = await bootstrapReportHistory({ approved: true, entries }, actor.id);
    const history = await getReportHistoryForActor(actor.id);
    const extras = await getReportPromptExtrasForActor(actor.id);
    const after = await generateDraftForPeriod({ weekStart: new Date("2026-08-01"), weekEnd: new Date("2026-08-07") }, actor);

    expect(first).toMatchObject({ success: true, importedCount: 2, replayedCount: 0, learned: false });
    expect(second).toMatchObject({ success: true, importedCount: 0, replayedCount: 2, learned: false });
    expect(rows.filter((row) => row.kind === "LESSON")).toHaveLength(2);
    expect(rows.filter((row) => row.kind === "LESSON").every((row) => row.ownerId === actor.id && row.state === "APPROVED" && row.provenance === "USER_PROVIDED")).toBe(true);
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ date: "2026-08-16", content: entries[0].content, provenance: "USER_PROVIDED" })]));
    expect(extras.styleMemo).toBeNull();
    // Style anchors: imported examples ARE quoted as style references in the
    // generation prompt (the operator's voice), while the evidence fence below
    // keeps their historical facts out of current achievements.
    const reportGenerationPrompt = String(callGLMText.mock.calls.at(-1)?.[0] ?? "");
    expect(reportGenerationPrompt).toContain(entries[0].content);
    expect(reportGenerationPrompt).toContain("Current authorized sources are the only evidence for current achievements");
    expect(before.body).toBe("draft-without-style");
    // With imported examples as style anchors, the draft carries the
    // operator's style even before a style memo exists.
    expect(after.body).toBe("draft-with-style");
    expect(await getReportStyleMemoForActor(actor.id)).toBeNull();
  });

  it("returns a typed disabled result without persisting history or generating a proposal", async () => {
    vi.stubEnv("SABAH_MEMORY_ENABLED", "false");
    const result = await bootstrapReportHistory({ approved: true, entries: [{ date: "2026-09-06", content: "Synthetic disabled history." }] }, actor.id);

    expect(result).toEqual({ success: true, importedCount: 0, replayedCount: 0, learned: false, memoryId: null, examples: [], disabled: true });
    expect(rows).toHaveLength(0);
    expect(audits).toHaveLength(0);
    expect(callGLMText).not.toHaveBeenCalled();
  });

  it("serializes concurrent identical imports to one example batch and one proposal", async () => {
    const entries = [
      { date: "2026-08-23", content: "مثال متزامن أول." },
      { date: "2026-08-30", content: "مثال متزامن ثان." },
    ];
    const [first, second] = await Promise.all([
      bootstrapReportHistory({ approved: true, entries, idempotencyKey: "concurrent-import" }, actor.id),
      bootstrapReportHistory({ approved: true, entries, idempotencyKey: "concurrent-import" }, actor.id),
    ]);

    expect([first.importedCount, second.importedCount].sort()).toEqual([0, 2]);
    expect([first.replayedCount, second.replayedCount].sort()).toEqual([0, 2]);
    expect(rows.filter((row) => row.kind === "LESSON")).toHaveLength(2);
    const proposals = rows.filter((row) => row.kind === "PREFERENCE" && row.state === "PROPOSED");
    expect(proposals).toHaveLength(1);
    expect(first.memoryId).toBe(proposals[0].id);
    expect(second.memoryId).toBe(proposals[0].id);
  });
});

describe("report style proposal approval", () => {
  it("rejects a dated named achievement before approval and never consumes it", async () => {
    const historicalMemo = [
      "صياغة: يبدأ السطر بفعل تنفيذي.",
      "صياغة: يدمج الأعمال المترابطة.",
      "صياغة: يحافظ على نبرة رسمية.",
      "صياغة: يذكر إنجاز سارة في مشروع أطلس بتاريخ 2026-08-16.",
      "انتقاء: يركز على الأعمال الجوهرية.",
      "انتقاء: يجمع التفاصيل المتقاربة.",
      "انتقاء: يستبعد التفاصيل الداخلية الصغيرة.",
      "انتقاء: لا يعيد إنجازات الأسابيع السابقة.",
    ].join("\n");
    const proposed = await persistReportStyleMemo({
      ownerId: actor.id,
      state: "PROPOSED",
      memo: historicalMemo,
      sources: [{ sourceId: "synthetic-report-1", date: "2026-08-16", checksum: "c".repeat(64), sourceUpdatedAt: "2026-08-16T00:00:00.000Z", label: "Synthetic historical source", href: "/reports/synthetic-report-1" }],
      audit: { entityType: "weekly_report", entityId: "synthetic-report-1", action: "capability:reports.finalize", outcome: "EDITED", learnRequested: true },
    });

    expect(proposed.memoryId).toBeTruthy();
    await expect(approveReportStyleMemo({ memoryId: proposed.memoryId!, ownerId: actor.id, reason: "Reject source-derived history" })).rejects.toMatchObject({ code: "INVALID_MEMORY_CONTENT", status: 400 });
    expect(rows.find((row) => row.id === proposed.memoryId)).toMatchObject({ state: "PROPOSED" });
    expect(await getReportStyleMemoForActor(actor.id)).toBeNull();

    const draft = await generateDraftForPeriod({ weekStart: new Date("2026-08-01"), weekEnd: new Date("2026-08-07") }, actor);
    expect(draft.body).toBe("draft-without-style");
    expect(String(callGLMText.mock.calls.at(-1)?.[0] ?? "")).not.toContain("سارة");
  });

  it("fails closed for a legacy approved memo that contains source-derived history", async () => {
    const historicalMemo = validMemo.replace("صياغة: يذكر الأثر باختصار.", "صياغة: يذكر إنجاز سارة في مشروع أطلس بتاريخ 2026-08-16.");
    rows.push({
      id: "legacy-invalid-memo",
      ownerId: actor.id,
      scope: "USER",
      kind: "PREFERENCE",
      state: "APPROVED",
      supersededById: null,
      content: historicalMemo,
      sources: [{ sourceType: "REPORT", sourceId: "synthetic-report-1", locatorJson: JSON.stringify({ memoKey: "EXEC_STYLE_MEMO" }) }],
    });

    expect(await getReportStyleMemoForActor(actor.id)).toBeNull();
    const draft = await generateDraftForPeriod({ weekStart: new Date("2026-08-01"), weekEnd: new Date("2026-08-07") }, actor);
    expect(draft.body).toBe("draft-without-style");
    expect(String(callGLMText.mock.calls.at(-1)?.[0] ?? "")).not.toContain("سارة");
  });

  it("does not read an approved style memo owned by another actor", async () => {
    rows.push({
      id: "other-owner-memo",
      ownerId: "other-actor",
      scope: "USER",
      kind: "PREFERENCE",
      state: "APPROVED",
      supersededById: null,
      content: validMemo,
      sources: [{ sourceType: "REPORT", sourceId: "other-report", locatorJson: JSON.stringify({ memoKey: "EXEC_STYLE_MEMO" }) }],
    });

    expect(await getReportStyleMemoForActor(actor.id)).toBeNull();
    expect((await getReportPromptExtrasForActor(actor.id)).styleMemo).toBeNull();
  });

  it("keeps generated correction PROPOSED until the owning actor approves it, then retrieves it", async () => {
    const proposed = await persistReportStyleMemo({
      ownerId: actor.id,
      state: "PROPOSED",
      memo: validMemo,
      sources: [{ sourceId: "synthetic-report-1", date: "2026-08-16", checksum: "a".repeat(64), sourceUpdatedAt: "2026-08-16T00:00:00.000Z", label: "Synthetic saved correction", href: "/reports/synthetic-report-1" }],
      audit: { entityType: "weekly_report", entityId: "synthetic-report-1", action: "capability:reports.finalize", outcome: "EDITED", learnRequested: true },
    });

    expect(proposed.learned).toBe(false);
    expect(await getReportStyleMemoForActor(actor.id)).toBeNull();
    await expect(approveReportStyleMemo({ memoryId: proposed.memoryId!, ownerId: "another-actor", reason: "not authorized" })).rejects.toMatchObject({ status: 403 });
    const accepted = await approveReportStyleMemo({ memoryId: proposed.memoryId!, ownerId: actor.id, reason: "Actor reviewed the saved correction" });

    expect(accepted).toMatchObject({ learned: true, memoryId: proposed.memoryId });
    expect(await getReportStyleMemoForActor(actor.id)).toBe(validMemo);
  });

  it("reports rejection truthfully and leaves the proposed memo inactive", async () => {
    const proposed = await persistReportStyleMemo({
      ownerId: actor.id,
      state: "PROPOSED",
      memo: validMemo,
      sources: [{ sourceId: "synthetic-report-1", date: "2026-08-16", checksum: "b".repeat(64), sourceUpdatedAt: "2026-08-16T00:00:00.000Z", label: "Synthetic saved correction", href: "/reports/synthetic-report-1" }],
      audit: { entityType: "weekly_report", entityId: "synthetic-report-1", action: "capability:reports.finalize", outcome: "EDITED", learnRequested: true },
    });

    const rejected = await rejectReportStyleMemo({ memoryId: proposed.memoryId!, ownerId: actor.id, reason: "Reject the synthetic correction" });

    expect(rejected).toMatchObject({ learned: false, memoryId: proposed.memoryId, disabled: false });
    expect(rows.find((row) => row.id === proposed.memoryId)).toMatchObject({ state: "REJECTED", ownerId: actor.id });
    expect(await getReportStyleMemoForActor(actor.id)).toBeNull();
    expect(JSON.parse(audits.find((audit) => audit.action === "capability:reports.lessons.reject")?.metaJson ?? "{}")).toMatchObject({ approval: false, memoryApproved: false, previousState: "PROPOSED", state: "REJECTED" });
  });

  it("proves saved correction to authorized acceptance to retrieval to a changed draft", async () => {
    const saved = await saveFinalBody("synthetic-report-1", "synthetic saved correction", actor);
    expect(saved.finalBody).toBe("synthetic saved correction");
    expect(saved.body).toBe("synthetic AI draft");

    const finalized = await finalizeReport({ reportId: "synthetic-report-1", finalBody: "synthetic saved correction", approved: true, learn: true }, actor);
    expect(finalized.verified).toBe(true);
    expect(finalized.learned).toBe(false);
    const proposal = rows.find((row) => row.kind === "PREFERENCE" && row.state === "PROPOSED");
    expect(proposal).toBeTruthy();

    const beforeAcceptance = await generateDraftForPeriod({ weekStart: new Date("2026-08-01"), weekEnd: new Date("2026-08-07") }, actor);
    await expect(approveReportStyleMemo({ memoryId: proposal.id, ownerId: actor.id, reason: "Approve the synthetic correction" })).resolves.toMatchObject({ learned: true, memoryId: proposal.id });
    const afterAcceptance = await generateDraftForPeriod({ weekStart: new Date("2026-08-01"), weekEnd: new Date("2026-08-07") }, actor);

    expect(beforeAcceptance.body).toBe("draft-without-style");
    expect(afterAcceptance.body).toBe("draft-with-style");
    expect(await getReportStyleMemoForActor(actor.id)).toBe(validMemo);
    const acceptedPrompt = String(callGLMText.mock.calls.at(-1)?.[0] ?? "");
    expect(acceptedPrompt).toContain(validMemo);
    expect(acceptedPrompt).not.toContain("synthetic saved correction");
  });
});
