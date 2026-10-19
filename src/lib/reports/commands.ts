import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { callGLMText, DEFAULT_GLM_MODEL } from "@/lib/glm";
import { logReportFinalizationApproval } from "@/lib/ai/audit";
import { buildLessonsPrompt, STYLE_MEMO_KEY } from "@/lib/report-lessons";
import { getReportPromptExtrasForActor, getReportStyleMemoForActor, isReportMemoryEnabled, persistReportStyleMemo } from "@/lib/reports/history";
import type { FeedbackInput } from "@/lib/sabah/feedback/contracts";

export type ReportActor = { id: string; role: "ADMIN" | "LEAD" | "MANAGER" | "MEMBER" | "VIEWER"; departmentIds: string[] };
export type ReportFeedbackRecorder = (input: FeedbackInput, actor: ReportActor) => Promise<void> | void;
export const reportCapabilityNames = ["reports.search", "reports.get", "reports.generateDraft", "reports.enhance", "reports.compare", "reports.finalize"] as const;
export const reportSources = ["task", "kpi", "project", "report"] as const;
export type ReportCitation = { sourceType: (typeof reportSources)[number]; sourceId: string; label: string };
export type ReportDraft = { reportId?: string; body: string; sourceIds: string[]; citations: ReportCitation[]; draft: true; final: false };

const forbidden = (message = "Forbidden") => Object.assign(new Error(message), { status: 403, code: "FORBIDDEN" });
const notFound = (message = "Report not found") => Object.assign(new Error(message), { status: 404, code: "NOT_FOUND" });
const badRequest = (message: string) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });
const period = (start: Date, end: Date) => { if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) throw badRequest("Invalid report period"); return { gte: start, lte: end }; };
const canSeeAllPrivate = (actor: ReportActor) => actor.role === "ADMIN";

/**
 * WeeklyReport has no owner/department column. Fail closed rather than infer
 * ownership: admins may read all rows; other actors may read only finalized
 * rows, and their draft body/AI summary are never returned.
 */
function canSeeReport(report: any, actor: ReportActor): boolean {
  return canSeeAllPrivate(actor) || Boolean(report?.submittedAt && report?.finalBody);
}
function safeReportForActor(report: any, actor: ReportActor): any {
  if (canSeeAllPrivate(actor)) return report;
  const { body: _body, aiSummary: _aiSummary, ...finalReport } = report;
  return { ...finalReport, body: finalReport.finalBody ?? "", aiSummary: null };
}
export function resolveReportEditorBody(report: { body?: string | null; aiSummary?: string | null; finalBody?: string | null; submittedAt?: Date | string | null }): string {
  if (report.finalBody?.trim()) return report.finalBody;
  if (report.body?.trim()) return report.body;
  return report.aiSummary?.trim() ?? "";
}
function assertReportVisible(report: any, actor: ReportActor) {
  assertActor(actor);
  if (!report || !canSeeReport(report, actor)) throw notFound();
  return report;
}

async function visibleSourceRecords(actor: ReportActor, start: Date, end: Date) {
  const taskWhere: any = { updatedAt: period(start, end), OR: [{ isPrivate: false }, { assignments: { some: { userId: actor.id } } }, { createdById: actor.id }] };
  if (canSeeAllPrivate(actor)) delete taskWhere.OR;
  const projectPeriod = { OR: [{ updatedAt: period(start, end) }, { startAt: { lte: end }, OR: [{ dueAt: null }, { dueAt: { gte: start } }] }] };
  const departmentFilter = actor.departmentIds.length ? { responsibleDepartmentId: { in: actor.departmentIds } } : undefined;
  if (departmentFilter) taskWhere.AND = [{ OR: [{ project: departmentFilter }, { projectId: null }] }];
  const [tasks, kpis, projects] = await Promise.all([
    prisma.task.findMany({ where: taskWhere, select: { id: true, title: true, status: true, projectId: true, kpiId: true }, take: 100 }),
    prisma.kPI.findMany({ where: { updatedAt: period(start, end), ...(canSeeAllPrivate(actor) ? {} : { OR: [{ ownerId: actor.id }, { ownerId: null }] }) }, select: { id: true, name: true, status: true }, take: 50 }),
    prisma.project.findMany({ where: { AND: [projectPeriod, ...(departmentFilter ? [departmentFilter] : []), ...(canSeeAllPrivate(actor) ? [] : [{ OR: [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }] }])] }, select: { id: true, name: true, status: true }, take: 50 }),
  ]);
  const citations: ReportCitation[] = [
    ...tasks.map((x: any) => ({ sourceType: "task" as const, sourceId: x.id, label: x.title })),
    ...kpis.map((x: any) => ({ sourceType: "kpi" as const, sourceId: x.id, label: x.name })),
    ...projects.map((x: any) => ({ sourceType: "project" as const, sourceId: x.id, label: x.name })),
  ];
  return { tasks, kpis, projects, citations, sourceIds: citations.map((x) => x.sourceId) };
}

function assertActor(actor: ReportActor) { if (!actor?.id) throw forbidden("Authentication required"); }
function assertReadable(report: any, actor: ReportActor) { assertActor(actor); if (!report) throw notFound(); if (report.submittedAt && report.finalBody && actor.role === "VIEWER") throw forbidden(); }
const hashReportText = (kind: "draft" | "final" | "memo", value: string) => crypto.createHash("sha256").update(`${kind}:${value}`).digest("hex");
export async function getReportStyleMemo(ownerId: string): Promise<string | null> {
  return getReportStyleMemoForActor(ownerId);
}

type ReportLearningResult = { learned: boolean; memoryId: string | null; disabled: boolean };

async function learnFromFinalEdit(report: any, finalBody: string, actor: ReportActor, outcome: "ACCEPTED" | "EDITED"): Promise<ReportLearningResult> {
  const aiDraft = typeof report.aiSummary === "string" ? report.aiSummary : "";
  const auditBase = { userId: actor.id, reportId: report.id, outcome, draftHash: hashReportText("draft", aiDraft), finalHash: hashReportText("final", finalBody), memoKey: STYLE_MEMO_KEY, learnRequested: true };
  if (!isReportMemoryEnabled()) { await logReportFinalizationApproval({ ...auditBase, learned: false }); return { learned: false, memoryId: null, disabled: true }; }
  if (!aiDraft.trim()) { await logReportFinalizationApproval({ ...auditBase, learned: false }); return { learned: false, memoryId: null, disabled: false }; }
  try {
    const currentMemo = await getReportStyleMemo(actor.id);
    const raw = await callGLMText(buildLessonsPrompt({ currentMemo, aiSummary: aiDraft, finalBody }), { model: DEFAULT_GLM_MODEL, temperature: 0.2, max_tokens: 800, thinking: "disabled" });
    const sourceUpdatedAt = report.submittedAt instanceof Date ? report.submittedAt.toISOString() : new Date().toISOString();
    const persisted = await persistReportStyleMemo({
      ownerId: actor.id,
      state: "PROPOSED",
      provenance: "GENERATED",
      memo: raw,
      sources: [{ sourceId: report.id, date: sourceUpdatedAt.slice(0, 10), checksum: auditBase.finalHash, sourceUpdatedAt, label: "Submitted report final edit", href: `/reports/${report.id}` }],
      audit: { entityType: "weekly_report", entityId: report.id, action: "capability:reports.finalize", outcome, draftHash: auditBase.draftHash, finalHash: auditBase.finalHash, learnRequested: true, source: "report-final-edit" },
    });
    if (persisted.learned) return { learned: true, memoryId: persisted.memoryId, disabled: false };
    if (persisted.disabled) return { learned: false, memoryId: null, disabled: true };
    await logReportFinalizationApproval({ ...auditBase, learned: false });
    return { learned: false, memoryId: persisted.memoryId, disabled: false };
  } catch {
    await logReportFinalizationApproval({ ...auditBase, learned: false });
    return { learned: false, memoryId: null, disabled: false };
  }
}

export async function getWeeklyReportForActor(id: string, actor: ReportActor) {
  const report = await prisma.weeklyReport.findUnique({ where: { id } });
  return safeReportForActor(assertReportVisible(report, actor), actor);
}

export async function searchReports(actor: ReportActor, opts: { query?: string; start?: Date; end?: Date } = {}) {
  assertActor(actor);
  const where: any = {};
  if (!canSeeAllPrivate(actor)) where.AND = [{ submittedAt: { not: null } }, { finalBody: { not: null } }];
  if (opts.start && opts.end) (where.AND ??= []).push({ weekStart: period(opts.start, opts.end) });
  if (opts.query?.trim()) (where.AND ??= []).push({ OR: [{ title: { contains: opts.query.trim(), mode: "insensitive" } }, { finalBody: { contains: opts.query.trim(), mode: "insensitive" } }] });
  const rows = await prisma.weeklyReport.findMany({ where, orderBy: { weekStart: "desc" }, take: 50 });
  return rows.filter((row: any) => canSeeReport(row, actor)).map((row: any) => safeReportForActor(row, actor));
}

export async function saveReportDraft(input: { reportId: string; body: string; sourceIds?: string[] }, actor: ReportActor) : Promise<ReportDraft> {
  assertActor(actor);
  if (!canSeeAllPrivate(actor)) throw forbidden("Only admins can save report drafts");
  const report = await prisma.weeklyReport.findUnique({ where: { id: input.reportId } });
  if (!report) throw notFound();
  if (report.submittedAt) throw badRequest("Submitted report is immutable");
  if (!input.body.trim()) throw badRequest("Draft body is required");
  const sources = await visibleSourceRecords(actor, report.weekStart, report.weekEnd);
  const requestedIds = input.sourceIds ?? [];
  const allowed = new Map(sources.citations.map((citation) => [citation.sourceId, citation]));
  const citations = requestedIds.map((sourceId) => allowed.get(sourceId)).filter((citation): citation is ReportCitation => Boolean(citation));
  if (citations.length !== requestedIds.length) throw forbidden("One or more report sources are not visible for this period");
  const saved = await prisma.weeklyReport.updateMany({ where: { id: input.reportId, submittedAt: null }, data: { body: input.body } });
  if (saved.count !== 1) throw badRequest("Submitted report is immutable");
  const readBack = await prisma.weeklyReport.findUnique({ where: { id: input.reportId } });
  if (!readBack || readBack.submittedAt || readBack.body !== input.body) throw new Error("Report draft authoritative read-back failed");
  return { reportId: readBack.id, body: readBack.body, sourceIds: citations.map((citation) => citation.sourceId), citations, draft: true, final: false };
}

/**
 * Stores the operator's edited final text in finalBody without touching the AI
 * draft in body. Editable and re-savable until the report is submitted.
 */
export async function saveFinalBody(reportId: string, finalBody: string, actor: ReportActor) {
  assertActor(actor);
  if (!canSeeAllPrivate(actor)) throw forbidden("Only admins can save the final report body");
  const report = await prisma.weeklyReport.findUnique({ where: { id: reportId } });
  if (!report) throw notFound();
  if (report.submittedAt) throw badRequest("Submitted report is immutable");
  if (!finalBody.trim()) throw badRequest("Final body is required");
  const saved = await prisma.weeklyReport.updateMany({ where: { id: reportId, submittedAt: null }, data: { finalBody } });
  if (saved.count !== 1) throw badRequest("Submitted report is immutable");
  const readBack = await prisma.weeklyReport.findUnique({ where: { id: reportId } });
  if (!readBack || readBack.submittedAt || readBack.finalBody !== finalBody) throw new Error("Final report body authoritative read-back failed");
  return readBack;
}

function reportPrompt(sources: Awaited<ReturnType<typeof visibleSourceRecords>>, instruction?: string, learning?: Awaited<ReturnType<typeof getReportPromptExtrasForActor>>) {
  const styleMemo = learning?.styleMemo;
  // Few-shot style anchors: the operator's own approved past reports. The
  // memo says HOW to write; the examples SHOW the result. Together they make
  // the draft sound like the operator, not like a generic summary.
  const styleExamples = (learning?.styleExamples ?? []).slice(0, 5);
  const examplesBlock = styleExamples.length
    ? `\nApproved past reports written by the operator (imitate their voice, structure, level of detail, and section ordering; newest first):\n${styleExamples.map((example: { content: string; date: string }) => `--- Report of ${example.date} ---\n${example.content.slice(0, 4000)}`).join("\n\n")}`
    : "";
  return `Write a grounded weekly report draft. Use only the authorized source records below. Include no unsupported claims.\nInstruction: ${instruction ?? "Summarize material activity."}${styleMemo ? `\nPersonal style and selection rules:\n${styleMemo}` : ""}${examplesBlock}\nCurrent authorized sources are the only evidence for current achievements:\n${JSON.stringify(sources)}`;
}

export async function generateDraftForPeriod(input: { weekStart: Date; weekEnd: Date; instruction?: string }, actor: ReportActor): Promise<ReportDraft> {
  assertActor(actor); const sources = await visibleSourceRecords(actor, input.weekStart, input.weekEnd);
  const learning = await getReportPromptExtrasForActor(actor.id).catch(() => ({ styleMemo: null, styleExamples: [] as const }));
  const body = await callGLMText(reportPrompt(sources, input.instruction, learning), { model: DEFAULT_GLM_MODEL, temperature: 0.4, max_tokens: 2500, thinking: "disabled" });
  if (!body.trim()) throw new Error("Provider returned an empty report draft");
  return { body: body.trim(), sourceIds: sources.sourceIds, citations: sources.citations, draft: true, final: false };
}

export async function enhanceReport(input: { reportId: string; instruction?: string }, actor: ReportActor): Promise<ReportDraft> {
  if (!canSeeAllPrivate(actor)) throw forbidden("Only admins can enhance report drafts");
  const report = await getWeeklyReportForActor(input.reportId, actor);
  if (!report) throw notFound();
  if (report.submittedAt || report.finalBody) throw badRequest("Final report is immutable");
  const sources = await visibleSourceRecords(actor, report.weekStart, report.weekEnd);
  const learning = await getReportPromptExtrasForActor(actor.id).catch(() => ({ styleMemo: null, styleExamples: [] as const }));
  const body = await callGLMText(`${reportPrompt(sources, input.instruction, learning)}\nExisting draft:\n${report.body}`, { model: DEFAULT_GLM_MODEL, temperature: 0.4, max_tokens: 2500, thinking: "disabled" });
  if (!body.trim()) throw new Error("Provider returned an empty report draft");
  const enhancedBody = body.trim();
  const saved = await prisma.weeklyReport.updateMany({ where: { id: report.id, submittedAt: null, finalBody: null }, data: { body: enhancedBody, aiSummary: enhancedBody } });
  if (saved.count !== 1) throw badRequest("Final report is immutable");
  const readBack = await prisma.weeklyReport.findUnique({ where: { id: report.id } });
  if (!readBack || readBack.submittedAt || readBack.finalBody || readBack.body !== enhancedBody || readBack.aiSummary !== enhancedBody) throw new Error("Enhanced report authoritative read-back failed");
  return { reportId: readBack.id, body: readBack.body, sourceIds: sources.sourceIds, citations: sources.citations, draft: true, final: false };
}

export async function compareReportPeriods(input: { start: Date; end: Date }, actor: ReportActor) {
  assertActor(actor);
  const where: any = { weekStart: period(input.start, input.end) };
  if (!canSeeAllPrivate(actor)) where.submittedAt = { not: null }, where.finalBody = { not: null };
  const reports = (await prisma.weeklyReport.findMany({ where, orderBy: { weekStart: "asc" } }))
    .filter((report: any) => canSeeReport(report, actor));
  return { reports: reports.map((report: any) => safeReportForActor(report, actor)), reportIds: reports.map((r: any) => r.id), citations: reports.map((r: any) => ({ sourceType: "report" as const, sourceId: r.id, label: r.title })) };
}

export async function finalizeReport(input: { reportId: string; finalBody: string; approved: true; learn?: boolean }, actor: ReportActor, feedbackRecorder?: ReportFeedbackRecorder) {
  assertActor(actor); if (actor.role !== "ADMIN") throw forbidden("Only admins can finalize reports");
  if (input.approved !== true) throw badRequest("Explicit approval is required");
  const report = await prisma.weeklyReport.findUnique({ where: { id: input.reportId } });
  if (!report) throw notFound();
  if (report.submittedAt) throw badRequest("Final report is immutable");
  if (!input.finalBody.trim()) throw badRequest("Final body is required");
  const submittedAt = new Date();
  const finalized = await prisma.weeklyReport.updateMany({ where: { id: report.id, submittedAt: null }, data: { finalBody: input.finalBody, submittedAt } });
  if (finalized.count !== 1) throw badRequest("Final report is immutable");
  const readBack = await prisma.weeklyReport.findUnique({ where: { id: report.id } });
  if (!readBack || readBack.finalBody !== input.finalBody || !readBack.submittedAt) throw new Error("Final report authoritative read-back failed");
  let feedbackCaptured = false;
  const aiDraft = typeof report.aiSummary === "string" ? report.aiSummary : "";
  const unchanged = aiDraft === input.finalBody;
  try { if (feedbackRecorder && aiDraft.trim()) { await feedbackRecorder({ source: { kind: "REPORT", id: report.id, reportId: report.id }, outcome: unchanged ? "ACCEPTED" : "EDITED", proposedDiffHash: unchanged ? undefined : hashReportText("draft", aiDraft), finalDiffHash: unchanged ? undefined : hashReportText("final", input.finalBody), context: { report: report.id, action: "FINALIZE" } }, actor); feedbackCaptured = true; } } catch { /* finalization is durable; capture can be retried safely */ }
  let learningResult: ReportLearningResult = { learned: false, memoryId: null, disabled: false };
  const auditBase = { userId: actor.id, reportId: report.id, outcome: unchanged ? "ACCEPTED" as const : "EDITED" as const, draftHash: hashReportText("draft", aiDraft), finalHash: hashReportText("final", input.finalBody), memoKey: STYLE_MEMO_KEY, learnRequested: input.learn !== false };
  if (input.learn !== false) {
    try { learningResult = await learnFromFinalEdit({ ...report, submittedAt: readBack.submittedAt }, input.finalBody, actor, unchanged ? "ACCEPTED" : "EDITED"); } catch { /* finalization is durable; learning can be retried safely */ }
  } else {
    await logReportFinalizationApproval({ ...auditBase, learned: false }).catch(() => undefined);
  }
  return { report: readBack, finalBody: input.finalBody, immutable: true, verified: true, learned: learningResult.learned, learningProposalId: learningResult.memoryId, learningDisabled: learningResult.disabled, feedbackCaptured, publication: "not_claimed" as const };
}
