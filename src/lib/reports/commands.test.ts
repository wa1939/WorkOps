import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
const updateMany = vi.fn();
const upsert = vi.fn();
const callGLMText = vi.fn();
const auditCreate = vi.fn();
const auditFindUnique = vi.fn();
const memoryFindFirst = vi.fn();
const memoryFindMany = vi.fn();
const memoryFindUnique = vi.fn();
const memoryCreate = vi.fn();
const memoryUpdateMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    weeklyReport: { findUnique: (...args: unknown[]) => findUnique(...args), findMany: (...args: unknown[]) => findMany(...args), update: (...args: unknown[]) => update(...args), updateMany: (...args: unknown[]) => updateMany(...args) },
    task: { findMany: (...args: unknown[]) => findMany({ model: "task", ...(args[0] as Record<string, unknown>) }) },
    kPI: { findMany: (...args: unknown[]) => findMany({ model: "kpi", ...(args[0] as Record<string, unknown>) }) },
    project: { findMany: (...args: unknown[]) => findMany({ model: "project", ...(args[0] as Record<string, unknown>) }) },
    appConfig: { findUnique: (...args: unknown[]) => findUnique({ model: "appConfig", ...(args[0] as Record<string, unknown>) }), upsert: (...args: unknown[]) => upsert(...args) },
    aiMemory: {
      findFirst: (...args: unknown[]) => memoryFindFirst(...args),
      findMany: (...args: unknown[]) => memoryFindMany(...args),
      findUnique: (...args: unknown[]) => memoryFindUnique(...args),
      create: (...args: unknown[]) => memoryCreate(...args),
      updateMany: (...args: unknown[]) => memoryUpdateMany(...args),
    },
    auditLog: { create: (...args: unknown[]) => auditCreate(...args), findUnique: (...args: unknown[]) => auditFindUnique(...args) },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));
vi.mock("@/lib/glm", () => ({ DEFAULT_GLM_MODEL: "glm-5.3-flash", callGLMText: (...args: unknown[]) => callGLMText(...args) }));

const resolveOperationalAiTarget = vi.fn(async () => ({
  provider: "zai" as const,
  model: "glm-5.3-flash" as const,
  fallbacks: [{ providerKey: "zai" as const, modelName: "glm-4.5-flash" }, { providerKey: "nuha" as const, modelName: "Nuha-2.1" }],
  credentials: {} as Record<string, string>,
}));
vi.mock("@/lib/ai/provider-resolution", () => ({ resolveOperationalAiTarget: () => resolveOperationalAiTarget() }));

import { compareReportPeriods, enhanceReport, finalizeReport, generateDraftForPeriod, getWeeklyReportForActor, reportCapabilityNames, reportSources, resolveReportEditorBody, saveFinalBody, saveReportDraft, type ReportActor } from "./commands";

const actor: ReportActor = { id: "u1", role: "MANAGER", departmentIds: ["d1"] };
const start = new Date("2026-08-01T00:00:00Z");
const end = new Date("2026-08-07T23:59:59Z");
const report = { id: "r1", weekStart: start, weekEnd: end, title: "Week", body: "old", aiSummary: "draft", finalBody: null, submittedAt: null };
const validApprovedMemo = [
  "صياغة: يبدأ السطر بفعل تنفيذي.",
  "صياغة: يدمج الأعمال المترابطة.",
  "صياغة: يحافظ على نبرة رسمية.",
  "صياغة: يذكر الأثر باختصار.",
  "انتقاء: يركز على الأثر باختصار.",
  "انتقاء: يجمع التفاصيل المتقاربة.",
  "انتقاء: يستبعد التفاصيل الداخلية الصغيرة.",
  "انتقاء: لا يعيد إنجازات الأسابيع السابقة.",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SABAH_MEMORY_ENABLED", "true");
  findMany.mockImplementation((arg: any) => arg?.model === "task" ? [{ id: "t1", title: "Task", status: "TODO" }] : arg?.model === "kpi" ? [{ id: "k1", name: "KPI", status: "ON_TRACK" }] : arg?.model === "project" ? [{ id: "p1", name: "Project", status: "Active" }] : []);
  findUnique.mockImplementation((arg: any) => arg?.model === "appConfig" ? null : report);
  update.mockResolvedValue({ ...report, body: "new" });
  updateMany.mockResolvedValue({ count: 1 });
  upsert.mockResolvedValue({ key: "EXEC_STYLE_MEMO", value: "صياغة: موجز" });
  auditCreate.mockResolvedValue({ id: "audit-1" });
  auditFindUnique.mockResolvedValue({ id: "audit-1", entityType: "weekly_report", entityId: "r1", action: "capability:reports.finalize", actorId: "a1" });
  memoryFindFirst.mockResolvedValue(null);
  memoryFindMany.mockResolvedValue([]);
  memoryCreate.mockResolvedValue({ id: "memo-new" });
  memoryUpdateMany.mockResolvedValue({ count: 0 });
  memoryFindUnique.mockResolvedValue(null);
  transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work({
    aiMemory: { findMany: memoryFindMany, findFirst: memoryFindFirst, findUnique: memoryFindUnique, create: memoryCreate, updateMany: memoryUpdateMany },
    auditLog: { create: auditCreate, findUnique: auditFindUnique },
  }));
  callGLMText.mockResolvedValue("generated");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("report command contract", () => {
  it("exposes exactly six safe names and honest source metadata", () => {
    expect(reportCapabilityNames).toEqual(["reports.search", "reports.get", "reports.generateDraft", "reports.enhance", "reports.compare", "reports.finalize"]);
    expect(reportSources).toEqual(["task", "kpi", "project", "report"]);
    expect(reportCapabilityNames.join(" ")).not.toMatch(/delete|send|publish/i);
  });

  it("delegates generation through the exported command", async () => {
    const result = await generateDraftForPeriod({ weekStart: start, weekEnd: end }, actor);
    expect(callGLMText).toHaveBeenCalledOnce();
    expect(callGLMText.mock.calls[0][1]).toMatchObject({ model: "glm-5.3-flash", thinking: "disabled" });
    expect(result.body).toBe("generated");
  });

  it("uses the current shared default when enhancing a report draft", async () => {
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, body: "generated", aiSummary: "generated" });

    await expect(enhanceReport({ reportId: "r1" }, { ...actor, role: "ADMIN" })).resolves.toMatchObject({ body: "generated" });

    expect(callGLMText.mock.calls[0][1]).toMatchObject({ model: "glm-5.3-flash", thinking: "disabled" });
  });

  it("routes draft generation through the resolved operational target for stored-credential deployments", async () => {
    resolveOperationalAiTarget.mockResolvedValueOnce({ provider: "openai", model: "gpt-4o-mini", fallbacks: [], credentials: { openai: "stored-key" } } as never);

    await generateDraftForPeriod({ weekStart: start, weekEnd: end }, actor);

    expect(callGLMText.mock.calls[0][1]).toMatchObject({ provider: "openai", model: "gpt-4o-mini", fallbacks: [], credentials: { openai: "stored-key" }, thinking: "disabled" });
  });

  it("keeps finalization durable when the operational target cannot be resolved", async () => {
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, finalBody: "final", submittedAt: new Date() });
    resolveOperationalAiTarget.mockRejectedValueOnce(new Error("Configured CHAT provider or model is unsupported: openai/gpt-4o-mini"));

    const result = await finalizeReport({ reportId: "r1", finalBody: "final", approved: true }, { ...actor, role: "ADMIN" });

    expect(result).toMatchObject({ verified: true, learned: false });
  });

  it("feeds the actor's current approved personal report memo into the next draft", async () => {
    memoryFindFirst.mockResolvedValue({ content: validApprovedMemo });
    await generateDraftForPeriod({ weekStart: start, weekEnd: end }, actor);
    expect(callGLMText.mock.calls[0][0]).toContain("انتقاء: يركز على الأثر");
    expect(memoryFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: "u1", scope: "USER", kind: "PREFERENCE", state: "APPROVED", supersededById: null }),
    }));
  });
});

describe("grounding and citation behavior", () => {
  it("projects finalized body content for non-admin report rendering without draft leakage", async () => {
    findUnique.mockResolvedValue({ ...report, submittedAt: new Date(), finalBody: "published final" });
    const result = await getWeeklyReportForActor("r1", actor);
    expect(result.body).toBe("published final");
    expect(result.aiSummary).toBeNull();
  });

  it("uses a saved editable draft before stale AI summary and final body after submission", () => {
    expect(resolveReportEditorBody({ body: "saved edit", aiSummary: "old AI", finalBody: null, submittedAt: null })).toBe("saved edit");
    expect(resolveReportEditorBody({ body: "saved edit", aiSummary: "old AI", finalBody: "saved final", submittedAt: null })).toBe("saved final");
    expect(resolveReportEditorBody({ body: "saved edit", aiSummary: "old AI", finalBody: "published", submittedAt: new Date() })).toBe("published");
  });

  it("fails closed for incomplete rows and denies non-admin draft mutation", async () => {
    const incomplete = { ...report, submittedAt: undefined, finalBody: undefined };
    findUnique.mockResolvedValue(incomplete);
    const commands = await import("./commands");
    await expect(commands.getWeeklyReportForActor("r1", actor)).rejects.toMatchObject({ status: 404 });
    await expect(saveReportDraft({ reportId: "r1", body: "new" }, actor)).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();
  });

  it("allows admins to mutate an unfinalized draft", async () => {
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, body: "new" });
    await expect(saveReportDraft({ reportId: "r1", body: "new" }, { ...actor, role: "ADMIN" })).resolves.toMatchObject({ reportId: "r1" });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "r1", submittedAt: null }, data: { body: "new" } });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a draft save that loses a race with finalization", async () => {
    findUnique.mockResolvedValue(report);
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(saveReportDraft({ reportId: "r1", body: "late draft" }, { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an enhanced draft that loses a race with finalization", async () => {
    findUnique.mockResolvedValue(report);
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(enhanceReport({ reportId: "r1" }, { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps the AI draft editable when a finalBody exists but the report is unsubmitted", async () => {
    findUnique.mockResolvedValueOnce({ ...report, finalBody: "saved final" }).mockResolvedValueOnce({ ...report, finalBody: "saved final", body: "new" });
    await expect(saveReportDraft({ reportId: "r1", body: "new" }, { ...actor, role: "ADMIN" })).resolves.toMatchObject({ reportId: "r1" });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "r1", submittedAt: null }, data: { body: "new" } });
  });

  it("rejects draft saves after submission", async () => {
    findUnique.mockResolvedValue({ ...report, finalBody: "final", submittedAt: new Date() });
    await expect(saveReportDraft({ reportId: "r1", body: "new" }, { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("scopes task, KPI, and project queries to the requested period and department", async () => {
    await generateDraftForPeriod({ weekStart: start, weekEnd: end }, actor);
    const taskQuery = findMany.mock.calls.find(([arg]) => arg.model === "task")?.[0];
    const kpiQuery = findMany.mock.calls.find(([arg]) => arg.model === "kpi")?.[0];
    const projectQuery = findMany.mock.calls.find(([arg]) => arg.model === "project")?.[0];
    expect(taskQuery.where.updatedAt).toEqual({ gte: start, lte: end });
    expect(taskQuery.where.OR).toEqual(expect.arrayContaining([{ isPrivate: false }, { assignments: { some: { userId: "u1" } } }, { createdById: "u1" }]));
    expect(kpiQuery.where.updatedAt).toEqual({ gte: start, lte: end });
    expect(projectQuery.where.AND).toEqual(expect.arrayContaining([{ responsibleDepartmentId: { in: ["d1"] } }]));
  });

  it("rejects caller source IDs not visible in the report period and returns truthful citations", async () => {
    findUnique.mockResolvedValueOnce(report);
    await expect(saveReportDraft({ reportId: "r1", body: "new", sourceIds: ["not-visible"] }, { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 403 });
    expect(update).not.toHaveBeenCalled();

    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, body: "new" });
    const result = await saveReportDraft({ reportId: "r1", body: "new", sourceIds: ["t1"] }, { ...actor, role: "ADMIN" });
    expect(result.sourceIds).toEqual(["t1"]);
    expect(result.citations).toEqual([{ sourceType: "task", sourceId: "t1", label: "Task" }]);
  });

  it("types report comparisons as report citations, never projects", async () => {
    findMany.mockResolvedValue([{ id: "r1", title: "Week", submittedAt: new Date(), finalBody: "final" }]);
    const result = await compareReportPeriods({ start, end }, actor);
    expect(result.reportIds).toEqual(["r1"]);
    expect(result.citations[0].sourceType).toBe("report");
  });
});

describe("saving the operator's final body", () => {
  it("writes finalBody, never body, and returns the updated report", async () => {
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, finalBody: "operator final" });
    const result = await saveFinalBody("r1", "operator final", { ...actor, role: "ADMIN" });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: "r1", submittedAt: null }, data: { finalBody: "operator final" } });
    expect(update).not.toHaveBeenCalled();
    expect(result.finalBody).toBe("operator final");
    expect(result.body).toBe("old");
  });

  it("keeps a saved-but-unsubmitted finalBody editable", async () => {
    findUnique.mockResolvedValueOnce({ ...report, finalBody: "earlier final" }).mockResolvedValueOnce({ ...report, finalBody: "revised final" });
    await expect(saveFinalBody("r1", "revised final", { ...actor, role: "ADMIN" })).resolves.toMatchObject({ finalBody: "revised final" });
  });

  it("rejects a final-body save that loses a race with finalization", async () => {
    findUnique.mockResolvedValue(report);
    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(saveFinalBody("r1", "late final", { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects non-admin actors, submitted reports, and empty bodies", async () => {
    findUnique.mockResolvedValue(report);
    await expect(saveFinalBody("r1", "x", actor)).rejects.toMatchObject({ status: 403 });
    await expect(saveFinalBody("r1", "   ", { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
    findUnique.mockResolvedValue({ ...report, finalBody: "final", submittedAt: new Date() });
    await expect(saveFinalBody("r1", "x", { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("finalization and lessons behavior", () => {
  it("uses an atomic null-guard and refuses a concurrent second finalizer", async () => {
    findUnique.mockResolvedValue(report);
    updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, finalBody: "final", submittedAt: new Date() });
    await expect(finalizeReport({ reportId: "r1", finalBody: "final", approved: true }, { ...actor, role: "ADMIN" })).resolves.toMatchObject({ verified: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", submittedAt: null } }));
    await expect(finalizeReport({ reportId: "r1", finalBody: "other", approved: true }, { ...actor, role: "ADMIN" })).rejects.toMatchObject({ status: 400 });
  });

  it("finalizes a row whose finalBody was saved earlier but never submitted", async () => {
    findUnique.mockResolvedValueOnce({ ...report, finalBody: "saved final" }).mockResolvedValueOnce({ ...report, finalBody: "saved final", submittedAt: new Date() });
    await expect(finalizeReport({ reportId: "r1", finalBody: "saved final", approved: true }, { ...actor, role: "ADMIN" })).resolves.toMatchObject({ verified: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r1", submittedAt: null } }));
  });

  it("uses EDITED feedback when the operator's final differs from the AI draft body", async () => {
    const recorder = vi.fn(async () => undefined);
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, finalBody: "changed", submittedAt: new Date() });
    const result = await finalizeReport({ reportId: "r1", finalBody: "changed", approved: true }, { ...actor, role: "ADMIN" }, recorder);
    expect(result.feedbackCaptured).toBe(true);
    expect(recorder).toHaveBeenCalledWith(expect.objectContaining({ outcome: "EDITED" }), expect.anything());
  });

  it("preserves authoritative finalization when the learning provider fails", async () => {
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, finalBody: "final", submittedAt: new Date() });
    callGLMText.mockRejectedValueOnce(new Error("provider down"));
    const learned = await finalizeReport({ reportId: "r1", finalBody: "final", approved: true }, { ...actor, role: "ADMIN" });
    expect(learned.learned).toBe(false);
    expect(callGLMText).toHaveBeenCalledOnce();
    expect(upsert).not.toHaveBeenCalled();
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, finalBody: "final", submittedAt: new Date() });
    const failed = await finalizeReport({ reportId: "r1", finalBody: "final", approved: true }, { ...actor, role: "ADMIN" });
    expect(failed.learned).toBe(false);
    expect(failed.verified).toBe(true);
    expect(failed.learned).toBe(false);
  });

  it("stores generated style lessons as proposed without superseding approved memory", async () => {
    const finalBody = "النسخة النهائية المعتمدة";
    const memo = "صياغة: يبدأ السطر بفعل تنفيذي\nانتقاء: يحذف التفاصيل الصغيرة";
    const finalized = { ...report, aiSummary: "مسودة الذكاء الاصطناعي", finalBody, submittedAt: new Date() };
    const reportRows = [report, finalized];
    findUnique.mockImplementation(() => reportRows.shift() ?? finalized);
    memoryFindFirst.mockResolvedValue({ content: "ذاكرة سابقة" });
    memoryFindMany.mockResolvedValue([{ id: "memo-old" }]);
    memoryCreate.mockResolvedValue({ id: "memo-new" });
    memoryUpdateMany.mockResolvedValue({ count: 1 });
    memoryFindUnique.mockResolvedValue({ id: "memo-new", content: memo, ownerId: "a1", scope: "USER", kind: "PREFERENCE", state: "PROPOSED", supersededById: null, sources: [{ sourceType: "REPORT", sourceId: "r1" }] });
    auditFindUnique.mockResolvedValue({ id: "audit-1", entityType: "weekly_report", entityId: "r1", action: "capability:reports.finalize", actorId: "a1" });
    callGLMText.mockResolvedValueOnce(memo);

    const result = await finalizeReport({ reportId: "r1", finalBody, approved: true }, { ...actor, id: "a1", role: "ADMIN" });

    expect(result.learned).toBe(false);
    expect(result.learningProposalId).toBe("memo-new");
    expect(upsert).not.toHaveBeenCalled();
    expect(memoryCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      scope: "USER", kind: "PREFERENCE", state: "PROPOSED", provenance: "GENERATED", confidence: 0.6, ownerId: "a1", content: memo,
      sources: { create: [expect.objectContaining({ sourceType: "REPORT", sourceId: "r1" })] },
    }) }));
    expect(memoryUpdateMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "ReadCommitted" }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: "weekly_report", entityId: "r1", actorId: "a1", action: "capability:reports.finalize" }),
    }));
    const metadata = JSON.parse(auditCreate.mock.calls[0][0].data.metaJson);
    expect(metadata).toMatchObject({ approval: false, memoryApproved: false, learningRequestApproved: true, scope: "PERSONAL", ownerId: "a1", memoryPersisted: true });
    expect(metadata.learned).toBeUndefined();
    expect(callGLMText.mock.calls[0][0]).toContain("مسودة الذكاء الاصطناعي");
    expect(callGLMText.mock.calls[0][0]).toContain(finalBody);
    expect(callGLMText.mock.calls[0][1]).toMatchObject({ model: "glm-5.3-flash", thinking: "disabled" });
  });

  it("does not read, generate, or persist final-edit learning when memory is disabled", async () => {
    vi.stubEnv("SABAH_MEMORY_ENABLED", "false");
    findUnique.mockResolvedValueOnce(report).mockResolvedValueOnce({ ...report, finalBody: "final", submittedAt: new Date() });

    const result = await finalizeReport({ reportId: "r1", finalBody: "final", approved: true }, { ...actor, role: "ADMIN" });

    expect(result.learned).toBe(false);
    expect(result.learningProposalId).toBeNull();
    expect(callGLMText).not.toHaveBeenCalled();
    expect(memoryFindFirst).not.toHaveBeenCalled();
    expect(memoryCreate).not.toHaveBeenCalled();
  });

  it("compares the submitted final with the AI summary, not the report container body", async () => {
    const recorder = vi.fn(async () => undefined);
    findUnique.mockResolvedValueOnce({ ...report, body: "old", aiSummary: "draft" }).mockResolvedValueOnce({ ...report, body: "old", aiSummary: "draft", finalBody: "old", submittedAt: new Date() });
    const result = await finalizeReport({ reportId: "r1", finalBody: "old", approved: true }, { ...actor, role: "ADMIN" }, recorder);
    expect(result.feedbackCaptured).toBe(true);
    expect(recorder).toHaveBeenCalledWith(expect.objectContaining({ outcome: "EDITED" }), expect.anything());
  });

  it("uses ACCEPTED producer feedback when finalizing an unchanged draft", async () => {
    const recorder = vi.fn(async () => undefined);
    findUnique.mockResolvedValueOnce({ ...report, aiSummary: "old" }).mockResolvedValueOnce({ ...report, aiSummary: "old", finalBody: "old", submittedAt: new Date() });
    const result = await finalizeReport({ reportId: "r1", finalBody: "old", approved: true }, { ...actor, role: "ADMIN" }, recorder);
    expect(result.feedbackCaptured).toBe(true);
    expect(recorder).toHaveBeenCalledWith(expect.objectContaining({ outcome: "ACCEPTED", proposedDiffHash: undefined, finalDiffHash: undefined }), expect.anything());
  });
});
