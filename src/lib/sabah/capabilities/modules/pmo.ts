import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defineCapability, type CapabilityContext, type SabahActor } from "../contracts";
import type { CapabilityRegistry } from "../registry";
import { createExternalAction, updateExternalAction } from "@/lib/pmo/action-service";
import { addEvidence, recordExternalResponse, transitionExternalAction } from "@/lib/pmo/lifecycle-service";
import { markFollowUpSent } from "@/lib/pmo/follow-up-service";
import { externalActionCreateSchema, externalActionUpdateSchema, evidenceSchema, responseSchema, lifecycleSchema } from "@/lib/pmo/schemas";
import { externalContactInputSchema, externalContactPatchSchema, normalizeContactEmail } from "@/lib/pmo/contacts";
import { workAreaInputSchema, workAreaPatchSchema, normalizeWorkAreaName } from "@/lib/pmo/work-areas";
import { assertCanAttachToParent, assertCanManageExternalAction, canManageWorkAreas, canViewAllPmo, canSeeAction, type PmoActor } from "@/lib/pmo/authorization";
import { resolvePmoActor } from "@/lib/pmo/actor";
import { loadPmoPortfolio } from "@/lib/pmo/portfolio-query";
import { parsePmoFilters } from "@/lib/pmo/portfolio";
import { toRiyadhDate } from "@/lib/pmo/date";
import { assembleFollowUpDraft } from "@/lib/pmo/draft-assembly";
import { writePmoAudit } from "@/lib/pmo/audit";

/** Maps Sabah's role vocabulary to the mature PMO authorization vocabulary. */
export function mapPmoActor(actor: SabahActor): PmoActor {
  return { id: actor.id, role: actor.role === "LEAD" ? "MANAGER" : actor.role };
}

const ref = z.object({ id: z.string().min(1) });
const taskRef = z.object({ taskId: z.string().min(1) });
const writeOptions = { requiresExplicitApproval: true as const };
const anyOutput = z.any();
const actorOf = (context: CapabilityContext) => mapPmoActor(context.actor);
const forbidden = (message = "Forbidden") => Object.assign(new Error(message), { status: 403, code: "FORBIDDEN" });

async function readActionForActor(taskId: string, actor: PmoActor) {
  const row = await prisma.task.findFirst({
    where: { id: taskId, type: "EXTERNAL_ACTION" },
    include: { externalAction: { include: { owner: true, externalContact: true, evidence: true, followUpEvents: true, reminderRules: true } }, project: { include: { workArea: true } }, caseStudy: { include: { workArea: true } }, assignments: true, tags: true, blockers: true },
  });
  if (!row?.externalAction || !canSeeAction(actor, row.externalAction.ownerId)) {
    throw Object.assign(new Error("External action not found"), { status: 404, code: "NOT_FOUND" });
  }
  return row;
}

export async function readPmoActionForActor(taskId: string, actor: PmoActor) {
  return readActionForActor(taskId, actor);
}

async function assertActionManager(taskId: string, actor: PmoActor): Promise<void> {
  const task = await readActionForActor(taskId, actor);
  if (!task.externalAction) throw Object.assign(new Error("External action not found"), { status: 404, code: "NOT_FOUND" });
  assertCanManageExternalAction(actor, { ownerId: task.externalAction.ownerId, parentOwnerId: task.project?.ownerId ?? task.caseStudy?.ownerId ?? null, ownerManagerId: task.externalAction.owner.managerId });
}

function actionPreview(title: string, input: Record<string, unknown>) {
  return { title, fields: Object.entries(input).map(([path, proposed]) => ({ path, proposed })) };
}

type ActionReadBack = {
  title?: string; description?: string; priority?: string; status?: string; dueDate?: string;
  ownerId?: string; externalContactId?: string; projectId?: string | null; caseStudyId?: string | null;
  collaboratorIds?: string[]; tagIds?: string[]; dependencyIds?: string[]; reminderOffsets?: number[];
  overdueIntervalDays?: number | null;
};

function sameItems(actual: string[] | number[], expected: string[] | number[]) {
  return [...actual].sort().join("|") === [...expected].sort().join("|");
}
function readBackMismatch(kind: string, field: string, expected: unknown, actual: unknown): never {
  throw new Error(`PMO ${kind} authoritative read-back failed: ${field} mismatch (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}
function expectMaterial(kind: string, field: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) readBackMismatch(kind, field, expected, actual);
}

async function verifyTaskReadBack(taskId: string, expected: ActionReadBack = {}, expectedStatus?: string): Promise<void> {
  const row = await prisma.task.findFirst({
    where: { id: taskId, type: "EXTERNAL_ACTION" },
    select: {
      id: true, type: true, title: true, description: true, status: true, priority: true, dueAt: true,
      projectId: true, caseStudyId: true,
      externalAction: { select: { id: true, ownerId: true, externalContactId: true, overdueIntervalDays: true, reminderRules: { select: { daysBeforeDue: true } } } },
      assignments: { select: { userId: true } }, tags: { select: { tagId: true } }, blockers: { select: { dependsOnId: true } },
    },
  });
  if (!row?.externalAction || row.type !== "EXTERNAL_ACTION") throw new Error("PMO action authoritative read-back failed: row missing");
  const actual = { ...row, ...row.externalAction };
  for (const field of ["title", "description", "priority", "status", "ownerId", "externalContactId", "projectId", "caseStudyId", "overdueIntervalDays"] as const) {
    if (expected[field] !== undefined) expectMaterial("action", field, actual[field], expected[field]);
  }
  if (expected.dueDate !== undefined) expectMaterial("action", "dueDate", row.dueAt ? toRiyadhDate(row.dueAt) : null, expected.dueDate);
  if (expectedStatus !== undefined) expectMaterial("action", "status", row.status, expectedStatus);
  if (expected.collaboratorIds !== undefined) {
    const expectedAssignments = expected.ownerId ? [expected.ownerId, ...expected.collaboratorIds] : expected.collaboratorIds;
    if (!sameItems(row.assignments.map((item) => item.userId), expectedAssignments)) readBackMismatch("action", "collaboratorIds", expectedAssignments, row.assignments.map((item) => item.userId));
  }
  if (expected.tagIds !== undefined && !sameItems(row.tags.map((item) => item.tagId), expected.tagIds)) readBackMismatch("action", "tagIds", expected.tagIds, row.tags.map((item) => item.tagId));
  if (expected.dependencyIds !== undefined && !sameItems(row.blockers.map((item) => item.dependsOnId), expected.dependencyIds)) readBackMismatch("action", "dependencyIds", expected.dependencyIds, row.blockers.map((item) => item.dependsOnId));
  if (expected.reminderOffsets !== undefined && !sameItems(row.externalAction.reminderRules.map((item) => item.daysBeforeDue), expected.reminderOffsets)) readBackMismatch("action", "reminderOffsets", expected.reminderOffsets, row.externalAction.reminderRules.map((item) => item.daysBeforeDue));
}

async function verifyRecordReadBack(kind: "evidence" | "followUp" | "response" | "contact" | "workArea", id: string, expected: Record<string, unknown> = {}): Promise<void> {
  const read = kind === "evidence"
    ? await prisma.actionEvidence.findUnique({ where: { id }, select: { id: true, externalActionId: true, label: true, url: true, addedById: true } })
    : kind === "followUp"
      ? await prisma.followUpEvent.findUnique({ where: { id }, select: { id: true, externalActionId: true, finalRecipient: true, finalSubject: true, finalBody: true, sentAt: true } })
      : kind === "response"
        ? await prisma.comment.findUnique({ where: { id }, select: { id: true, taskId: true, authorId: true, body: true } })
        : kind === "contact"
          ? await prisma.externalContact.findUnique({ where: { id }, select: { id: true, name: true, email: true, normalizedEmail: true, department: true, organization: true, isArchived: true } })
          : await prisma.workArea.findUnique({ where: { id }, select: { id: true, name: true, normalizedName: true, description: true, displayOrder: true, isArchived: true } });
  if (!read || !("id" in read)) throw new Error(`${kind} authoritative read-back failed: row missing`);
  for (const [field, value] of Object.entries(expected)) expectMaterial(kind, field, (read as Record<string, unknown>)[field], value);
}

async function verifyResponseReadBack(commentId: string, expected: { comment?: string; evidence?: { label: string; url: string } }): Promise<void> {
  await verifyRecordReadBack("response", commentId, { body: expected.comment });
  if (expected.evidence) {
    const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { taskId: true } });
    const task = comment ? await prisma.task.findUnique({ where: { id: comment.taskId }, select: { externalAction: { select: { id: true } } } }) : null;
    const evidence = task?.externalAction ? await prisma.actionEvidence.findFirst({ where: { externalActionId: task.externalAction.id, label: expected.evidence.label, url: expected.evidence.url }, select: { id: true } }) : null;
    if (!evidence) throw new Error("response authoritative read-back failed: evidence action link mismatch");
  }
}

async function buildActionUpdatePreview(input: Record<string, unknown>) {
  const current = await prisma.task.findUnique({ where: { id: String(input.id) }, include: { externalAction: { include: { owner: { select: { id: true, name: true } }, externalContact: { select: { id: true, name: true } }, reminderRules: true } }, project: { select: { id: true, name: true } }, caseStudy: { select: { id: true, name: true } }, assignments: true, tags: { include: { tag: true } }, blockers: true } });
  const material: Record<string, unknown> = {
    title: current?.title, description: current?.description, priority: current?.priority, status: current?.status,
    ownerId: current?.externalAction?.owner?.name, externalContactId: current?.externalAction?.externalContact?.name,
    projectId: current?.project?.name, caseStudyId: current?.caseStudy?.name, collaboratorIds: current?.assignments?.map((item) => item.userId),
    tagIds: current?.tags?.map((item) => item.tag.name), dependencyIds: current?.blockers?.map((item) => item.dependsOnId),
    dueDate: current?.dueAt?.toISOString(), reminderOffsets: current?.externalAction?.reminderRules?.map((item) => item.daysBeforeDue), overdueIntervalDays: current?.externalAction?.overdueIntervalDays,
  };
  return { ...actionPreview(`Update PMO action “${current?.title ?? input.id}”`, input), fields: Object.entries(input).filter(([path]) => !["id", "expectedUpdatedAt"].includes(path)).map(([path, proposed]) => ({ path, current: material[path], proposed })) };
}

const actionsSearch = defineCapability({
  name: "pmo.actions.search", version: 1, module: "pmo", description: "Search visible external PMO actions.", risk: "READ",
  inputSchema: z.object({ query: z.string().trim().max(200).default(""), status: z.string().optional(), ownerId: z.string().optional(), dueBucket: z.string().optional() }), outputSchema: z.array(anyOutput),
  async available() { return true; }, async authorize() {}, async preview(input) { return actionPreview("Search PMO actions", input); },
  async execute(input, context) { const result = await loadPmoPortfolio(parsePmoFilters(input as any), actorOf(context), toRiyadhDate(context.now)); return result.rows; },
  async verify(output) { return output; }, summarize(output) { return `Found ${(output as unknown[]).length} PMO actions.`; },
});

const actionsGet = defineCapability({
  name: "pmo.actions.get", version: 1, module: "pmo", description: "Read one authorized external PMO action.", risk: "READ", inputSchema: taskRef, outputSchema: anyOutput,
  async available() { return true; }, async authorize(input, context) { await readActionForActor(input.taskId, actorOf(context)); }, async preview(input) { return actionPreview("Read PMO action", input); },
  async execute(input, context) { return readActionForActor(input.taskId, actorOf(context)); },
  async verify(output) { return output; }, summarize(output) { return `Read PMO action ${(output as { id: string }).id}.`; },
});

const createInput = externalActionCreateSchema;
const updateInput = externalActionUpdateSchema.extend({ id: z.string().min(1), expectedUpdatedAt: z.string().datetime() });

const actionsCreate = defineCapability({
  name: "pmo.actions.create", version: 1, module: "pmo", description: "Create an authorized external PMO action with validated references.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: createInput, outputSchema: anyOutput,
  async available(actor) { return actor.role !== "VIEWER"; }, async authorize(input, context) { if (input.projectId || input.caseStudyId) { const parent = await prisma.project.findUnique({ where: { id: input.projectId ?? undefined }, select: { ownerId: true, members: { select: { userId: true } } } }).catch(() => null) ?? await prisma.caseStudy.findUnique({ where: { id: input.caseStudyId ?? undefined }, select: { ownerId: true, members: { select: { userId: true } } } }); if (!parent) throw Object.assign(new Error("Parent not found"), { status: 404 }); assertCanAttachToParent(actorOf(context), { ownerId: parent.ownerId, memberIds: parent.members.map((m) => m.userId) }); } },
  async preview(input) { return actionPreview(`Create PMO action “${input.title}”`, input as any); },
  async execute(input, context) { return createExternalAction(createInput.parse(input), actorOf(context)); },
  async verify(output, context) { const input = (context as unknown as { input?: ActionReadBack }).input ?? {}; await verifyTaskReadBack((output as { taskId: string }).taskId, input, "WAITING"); return output; }, summarize(output) { return `Created PMO action ${(output as { taskId: string }).taskId}.`; },
});

const actionsUpdate = defineCapability({
  name: "pmo.actions.update", version: 1, module: "pmo", description: "Update an open external PMO action with optimistic version context.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: updateInput, outputSchema: anyOutput,
  async available(actor) { return actor.role !== "VIEWER"; }, async authorize(input, context) { await assertActionManager(input.id, actorOf(context)); if (input.expectedUpdatedAt) { const current = await prisma.task.findUnique({ where: { id: input.id }, select: { updatedAt: true } }); if (!current || current.updatedAt.toISOString() !== input.expectedUpdatedAt) throw Object.assign(new Error("PMO action changed; refresh before updating"), { status: 409, code: "STALE_VERSION" }); } },
  async preview(input) { return buildActionUpdatePreview(input as Record<string, unknown>); },
  async execute(input, context) { const { id, ...changes } = input; return updateExternalAction(id, changes, actorOf(context)); },
  async verify(output, context) { const input = (context as unknown as { input?: ActionReadBack }).input ?? {}; await verifyTaskReadBack((output as { id: string }).id, input); return output; }, summarize(output) { return `Updated PMO action ${(output as { id: string }).id}.`; },
});

const evidenceInput = taskRef.extend({ evidence: evidenceSchema });
const actionsEvidence = defineCapability({ name: "pmo.actions.addEvidence", version: 1, module: "pmo", description: "Add HTTPS evidence to an open PMO action.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: evidenceInput, outputSchema: anyOutput, async available(actor) { return actor.role !== "VIEWER"; }, async authorize(input, context) { await assertActionManager(input.taskId, actorOf(context)); }, async preview(input) { return actionPreview("Add PMO evidence", input as any); }, async execute(input, context) { return addEvidence(input.taskId, input.evidence, actorOf(context)); }, async verify(output, context) { const input = (context as unknown as { input?: { evidence?: Record<string, unknown> } }).input?.evidence ?? {}; await verifyRecordReadBack("evidence", (output as { id: string }).id, input); return output; }, summarize() { return "Added PMO evidence."; } });

const followUpInput = taskRef.extend({ confirmedSent: z.literal(true), recipient: z.string().email(), subject: z.string().min(1), body: z.string().min(1), eventId: z.string().optional() });
const actionsFollowUp = defineCapability({ name: "pmo.actions.addFollowUp", version: 1, module: "pmo", description: "Record a manually sent PMO follow-up; Sabah never sends email.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: followUpInput, outputSchema: anyOutput, async available(actor) { return actor.role !== "VIEWER"; }, async authorize(input, context) { await assertActionManager(input.taskId, actorOf(context)); }, async preview(input) { return { ...actionPreview("Record PMO follow-up (manual send confirmed)", input as any), warnings: ["No email is sent by Sabah."] }; }, async execute(input, context) { const { taskId, ...payload } = input; return markFollowUpSent(taskId, payload, actorOf(context)); }, async verify(output, context) { const input = context as unknown as { input?: Record<string, unknown> }; await verifyRecordReadBack("followUp", (output as { id: string }).id, { finalRecipient: input.input?.recipient, finalSubject: input.input?.subject, finalBody: input.input?.body }); return output; }, summarize() { return "Recorded PMO follow-up; no email was sent."; } });

const responseInput = taskRef.extend({ response: responseSchema });
const actionsResponse = defineCapability({ name: "pmo.actions.recordResponse", version: 1, module: "pmo", description: "Record an external response and optional HTTPS evidence.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: responseInput, outputSchema: anyOutput, async available(actor) { return actor.role !== "VIEWER"; }, async authorize(input, context) { await assertActionManager(input.taskId, actorOf(context)); }, async preview(input) { return actionPreview("Record PMO response", input as any); }, async execute(input, context) { return recordExternalResponse(input.taskId, input.response, actorOf(context)); }, async verify(output, context) { const input = (context as unknown as { input?: { response?: { comment?: string; evidence?: { label: string; url: string } } } }).input?.response ?? {}; await verifyResponseReadBack((output as { id: string }).id, input); return output; }, summarize() { return "Recorded PMO response."; } });

const actionsLifecycle = defineCapability({ name: "pmo.actions.changeLifecycle", version: 1, module: "pmo", description: "Close, cancel, or reopen an external PMO action through its state machine.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: z.intersection(taskRef, lifecycleSchema), outputSchema: anyOutput, async available(actor) { return actor.role !== "VIEWER"; }, async authorize(input, context) { await assertActionManager(input.taskId, actorOf(context)); }, async preview(input) { return actionPreview("Change PMO action lifecycle", input as any); }, async execute(input, context) { const { taskId, ...transition } = input; return transitionExternalAction(taskId, transition as any, actorOf(context)); }, async verify(output, context) { const input = (context as unknown as { input?: { action?: string } }).input; const target = input?.action === "close" ? "DONE" : input?.action === "cancel" ? "CANCELED" : "WAITING"; await verifyTaskReadBack((output as { id: string }).id, {}, target); return output; }, summarize() { return "Updated PMO lifecycle."; } });

const contactSearch = defineCapability({ name: "pmo.contacts.search", version: 1, module: "pmo", description: "Search active reusable external contacts.", risk: "READ", inputSchema: z.object({ query: z.string().trim().default(""), includeArchived: z.boolean().default(false) }), outputSchema: z.array(anyOutput), async available() { return true; }, async authorize(input, context) { if (input.includeArchived && !canSeeAction(actorOf(context), "__bulk__")) throw forbidden("Archived contacts require manager access"); }, async preview(input) { return actionPreview("Search PMO contacts", input); }, async execute(input) { return prisma.externalContact.findMany({ where: { ...(input.includeArchived ? {} : { isArchived: false }), ...(input.query ? { OR: [{ name: { contains: input.query, mode: "insensitive" } }, { email: { contains: input.query, mode: "insensitive" } }] } : {}) }, orderBy: { name: "asc" } }); }, async verify(output) { return output; }, summarize(output) { return `Found ${(output as unknown[]).length} contacts.`; } });

const contactCreate = defineCapability({ name: "pmo.contacts.create", version: 1, module: "pmo", description: "Create a reusable external contact.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: externalContactInputSchema, outputSchema: anyOutput, async available(actor) { return actor.role !== "VIEWER"; }, async authorize(_input, context) { if (actorOf(context).role === "VIEWER") throw forbidden(); }, async preview(input) { return actionPreview("Create PMO contact", input as any); }, async execute(input, context) { const contact = await prisma.$transaction(async (tx) => { const created = await tx.externalContact.create({ data: { ...input, email: input.email.trim(), normalizedEmail: normalizeContactEmail(input.email), createdById: context.actor.id } }); await writePmoAudit(tx, { entityType: "external_contact", entityId: created.id, action: "create", actorId: context.actor.id, changes: { fields: Object.keys(input) } }); return created; }); return contact; }, async verify(output, context) { const input = (context as unknown as { input?: Record<string, unknown> }).input ?? {}; await verifyRecordReadBack("contact", (output as { id: string }).id, { name: input.name, email: String(input.email ?? "").trim(), normalizedEmail: normalizeContactEmail(String(input.email ?? "")), department: input.department, organization: input.organization, isArchived: false }); return output; }, summarize() { return "Created PMO contact."; } });

const contactUpdate = defineCapability({ name: "pmo.contacts.update", version: 1, module: "pmo", description: "Update or archive a reusable external contact.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: ref.extend({ changes: externalContactPatchSchema }), outputSchema: anyOutput, async available(actor) { return actor.role !== "VIEWER"; }, async authorize(_input, context) { if (actorOf(context).role === "VIEWER") throw forbidden(); }, async preview(input) { return actionPreview("Update PMO contact", input as any); }, async execute(input, context) { const contact = await prisma.$transaction(async (tx) => { const updated = await tx.externalContact.update({ where: { id: input.id }, data: { ...input.changes, normalizedEmail: input.changes.email ? normalizeContactEmail(input.changes.email) : undefined } }); await writePmoAudit(tx, { entityType: "external_contact", entityId: input.id, action: input.changes.isArchived === true ? "archive" : "update", actorId: context.actor.id, changes: { fields: Object.keys(input.changes) } }); return updated; }); return contact; }, async verify(output, context) { const changes = ((context as unknown as { input?: { changes?: Record<string, unknown> } }).input?.changes ?? {}); await verifyRecordReadBack("contact", (output as { id: string }).id, { ...changes, ...(changes.email ? { email: String(changes.email).trim(), normalizedEmail: normalizeContactEmail(String(changes.email)) } : {}) }); return output; }, summarize() { return "Updated PMO contact."; } });

const areaSearch = defineCapability({ name: "pmo.workAreas.search", version: 1, module: "pmo", description: "Search active PMO work areas.", risk: "READ", inputSchema: z.object({ query: z.string().trim().default(""), includeArchived: z.boolean().default(false) }), outputSchema: z.array(anyOutput), async available() { return true; }, async authorize(input, context) { if (input.includeArchived && !canViewAllPmo(actorOf(context))) throw forbidden("Archived work areas require manager access"); }, async preview(input) { return actionPreview("Search PMO work areas", input); }, async execute(input) { return prisma.workArea.findMany({ where: { ...(input.includeArchived ? {} : { isArchived: false }), ...(input.query ? { name: { contains: input.query, mode: "insensitive" } } : {}) }, orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }); }, async verify(output) { return output; }, summarize(output) { return `Found ${(output as unknown[]).length} work areas.`; } });

const areaCreate = defineCapability({ name: "pmo.workAreas.create", version: 1, module: "pmo", description: "Create a PMO work area.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: workAreaInputSchema, outputSchema: anyOutput, async available(actor) { return canManageWorkAreas(mapPmoActor(actor)); }, async authorize(_input, context) { if (!canManageWorkAreas(actorOf(context))) throw forbidden("Work-area management requires manager access"); }, async preview(input) { return actionPreview("Create PMO work area", input as any); }, async execute(input, context) { return prisma.$transaction(async (tx) => { const created = await tx.workArea.create({ data: { ...input, normalizedName: normalizeWorkAreaName(input.name), createdById: context.actor.id } }); await writePmoAudit(tx, { entityType: "work_area", entityId: created.id, action: "create", actorId: context.actor.id, changes: { fields: Object.keys(input) } }); return created; }); }, async verify(output, context) { const input = (context as unknown as { input?: Record<string, unknown> }).input ?? {}; await verifyRecordReadBack("workArea", (output as { id: string }).id, { name: input.name, normalizedName: normalizeWorkAreaName(String(input.name ?? "")), description: input.description, displayOrder: input.displayOrder, isArchived: false }); return output; }, summarize() { return "Created PMO work area."; } });

const areaUpdate = defineCapability({ name: "pmo.workAreas.update", version: 1, module: "pmo", description: "Update or archive a PMO work area.", risk: "SENSITIVE_WRITE", ...writeOptions, inputSchema: ref.extend({ changes: workAreaPatchSchema }), outputSchema: anyOutput, async available(actor) { return canManageWorkAreas(mapPmoActor(actor)); }, async authorize(_input, context) { if (!canManageWorkAreas(actorOf(context))) throw forbidden("Work-area management requires manager access"); }, async preview(input) { return actionPreview("Update PMO work area", input as any); }, async execute(input, context) { return prisma.$transaction(async (tx) => { const updated = await tx.workArea.update({ where: { id: input.id }, data: { ...input.changes, normalizedName: input.changes.name ? normalizeWorkAreaName(input.changes.name) : undefined } }); await writePmoAudit(tx, { entityType: "work_area", entityId: input.id, action: input.changes.isArchived === true ? "archive" : "update", actorId: context.actor.id, changes: { fields: Object.keys(input.changes) } }); return updated; }); }, async verify(output, context) { const changes = ((context as unknown as { input?: { changes?: Record<string, unknown> } }).input?.changes ?? {}); await verifyRecordReadBack("workArea", (output as { id: string }).id, { ...changes, ...(changes.name ? { name: String(changes.name).trim(), normalizedName: normalizeWorkAreaName(String(changes.name)) } : {}) }); return output; }, summarize() { return "Updated PMO work area."; } });

const draftInput = taskRef.extend({ instruction: z.string().trim().max(4000).optional() });
export async function generatePmoDraft(taskId: string, actor: PmoActor) {
  await assertActionManager(taskId, actor);
  const draft = await assembleFollowUpDraft(taskId);
  if (!draft) throw Object.assign(new Error("External action not found"), { status: 404 });
  return { subject: draft.subject, body: draft.body, recipient: draft.to, note: "Draft only; Sabah does not send email." };
}

const draftsGenerate = defineCapability({ name: "pmo.drafts.generate", version: 1, module: "pmo", description: "Generate a follow-up email draft without sending it.", risk: "DRAFT", inputSchema: draftInput, outputSchema: z.object({ subject: z.string(), body: z.string(), recipient: z.string(), note: z.string() }), async available() { return true; }, async authorize(input, context) { await assertActionManager(input.taskId, actorOf(context)); }, async preview(input) { return actionPreview("Generate PMO email draft", input); }, async execute(input, context) { return generatePmoDraft(input.taskId, actorOf(context)); }, async verify(output) { return output; }, summarize() { return "Generated a PMO draft; no email was sent." } });
const draftsRewrite = defineCapability({ name: "pmo.drafts.rewrite", version: 1, module: "pmo", description: "Rewrite a PMO follow-up draft without sending it.", risk: "DRAFT", inputSchema: draftInput.extend({ subject: z.string().min(1), body: z.string().min(1) }), outputSchema: z.object({ subject: z.string(), body: z.string(), recipient: z.string().optional(), note: z.string() }), async available() { return true; }, async authorize(input, context) { await assertActionManager(input.taskId, actorOf(context)); }, async preview(input) { return actionPreview("Rewrite PMO email draft", input); }, async execute(input) { return { subject: input.subject, body: input.instruction ? `${input.body}\n\n${input.instruction}` : input.body, note: "Draft only; Sabah does not send email." }; }, async verify(output) { return output; }, summarize() { return "Rewrote a PMO draft; no email was sent."; } });

export const PMO_CAPABILITIES = [actionsSearch, actionsGet, actionsCreate, actionsUpdate, actionsEvidence, actionsFollowUp, actionsResponse, actionsLifecycle, contactSearch, contactCreate, contactUpdate, areaSearch, areaCreate, areaUpdate, draftsGenerate, draftsRewrite] as const;
export const PMO_CAPABILITY_NAMES = PMO_CAPABILITIES.map((capability) => capability.name);
export function registerPmoCapabilities(registry: { register: (definition: any) => void }): void { for (const capability of PMO_CAPABILITIES) registry.register(capability); }
