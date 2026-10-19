import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { defineCapability, type CapabilityContext, type SabahCapability } from "../contracts";
import type { CapabilityRegistry } from "../registry";
import { workspaceSearch, type WorkspaceSearchDb, type IndexedRow } from "@/lib/sabah/intelligence/search";
import { buildContextPack, type ContextPackDb } from "@/lib/sabah/intelligence/context-packs";
import { findDuplicateCandidates, createPrismaDuplicateDb, type DuplicateDb, type DuplicateRecord } from "@/lib/sabah/intelligence/duplicates";
import type { AuthorizedScopeDb, ScopeRow } from "@/lib/sabah/intelligence/authorized-scope";
import { recommendAssignments } from "@/lib/sabah/intelligence/recommendations";
import { createPrismaGraphDb } from "@/lib/sabah/intelligence/graph";
import { createEntityFingerprint } from "@/lib/sabah/intelligence/fingerprint";
import type { PrismaClient } from "@prisma/client";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { WorkspaceEntityType, SourceRef } from "@/lib/sabah/intelligence/contracts";
import { estimateEffortWithSource, effectiveCapacity, nextWeekWindows, workdaysOnLeave } from "@/lib/team-load";
import type { CapacityEvidence } from "@/lib/sabah/intelligence/context-packs";

const entityTypes = ["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"] as const;
const sourceSchema = z.object({ entityType: z.enum(entityTypes), entityId: z.string().min(1).max(128), label: z.string().min(1).max(160), href: z.string().regex(/^\/(?!\/)[^\\\u0000-\u001f]{1,255}$/), sourceUpdatedAt: z.string().datetime(), checksum: z.string().min(1).max(256) }).strict();
const searchInput = z.object({ query: z.string().min(1).max(512), entityTypes: z.array(z.enum(entityTypes)).min(1).max(4), filters: z.object({ status: z.string().max(40).optional() }).strict().optional(), limit: z.number().int().min(1).max(20).optional(), cursor: z.string().max(512).optional() }).strict();
const searchOutput = z.object({ items: z.array(z.object({ source: sourceSchema, snippet: z.string().max(500), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]), status: z.string().max(40).optional() }).strict()).max(20), hasMore: z.boolean(), nextCursor: z.string().max(512).optional() }).strict();
const contextInput = z.object({ kind: z.enum(["TASK_CREATION", "PROJECT_PORTFOLIO", "TEAM_CAPACITY", "KPI_RECOVERY", "PMO_FOLLOW_UP", "FORM"]), seedRefs: z.array(sourceSchema).max(10).optional(), query: z.string().max(300).optional() }).strict();
const relatedInput = z.object({ entityType: z.enum(["PROJECT", "TASK"]), title: z.string().max(300).optional(), name: z.string().max(300).optional(), description: z.string().max(2000).optional(), projectId: z.string().max(128).optional(), dueAt: z.string().datetime().optional() }).strict();
const assignmentInput = z.object({ taskRef: sourceSchema, candidateUserIds: z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/)).max(20), effortHours: z.number().min(0).max(1000) }).strict();
const safe = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => item instanceof Date ? item.toISOString() : item));
const confidence = (score: number): "HIGH" | "MEDIUM" | "LOW" => score >= .8 ? "HIGH" : score >= .55 ? "MEDIUM" : "LOW";
export type WorkspaceCapabilityDeps = { search?: typeof workspaceSearch; searchDb?: WorkspaceSearchDb; contextDb?: ContextPackDb; duplicateDb?: DuplicateDb };
export type WorkspacePrismaDb = Omit<WorkspaceSearchDb, "getCurrentSource"> & Omit<ContextPackDb, "getCurrentSource"> & DuplicateDb & { getCurrentSource: (source: Pick<SourceRef, "entityType" | "entityId">, actor: SabahActor) => Promise<SourceRef | null> };

/** Typed production adapter: every authorized entity delegate is required; unavailable models fail closed. */
export function createPrismaWorkspaceDb(client: PrismaClient = prisma): WorkspacePrismaDb {
  const required = <T extends object>(name: string, model: T): T => {
    if (!model || typeof (model as { findMany?: unknown }).findMany !== "function") throw new Error(`Workspace model unavailable: ${name}`);
    return model;
  };
  const adaptScopeModel = (model: object): NonNullable<AuthorizedScopeDb["project"]> => model as unknown as NonNullable<AuthorizedScopeDb["project"]>;
  const scopeDb: AuthorizedScopeDb = {
    project: adaptScopeModel(required("project", client.project)), task: adaptScopeModel(required("task", client.task)), kPI: adaptScopeModel(required("kPI", client.kPI)),
    externalAction: adaptScopeModel(required("externalAction", client.externalAction)), notePage: adaptScopeModel(required("notePage", client.notePage)),
    leaveRequest: adaptScopeModel(required("leaveRequest", client.leaveRequest)), caseStudy: adaptScopeModel(required("caseStudy", client.caseStudy)),
    weeklyReport: adaptScopeModel(required("weeklyReport", client.weeklyReport)), supportRequest: adaptScopeModel(required("supportRequest", client.supportRequest)),
  };
  const adaptIndexedModel = (model: object): WorkspaceSearchDb["aiKnowledgeChunk"] => model as unknown as WorkspaceSearchDb["aiKnowledgeChunk"];
  const aiKnowledgeChunk = adaptIndexedModel(required("aiKnowledgeChunk", client.aiKnowledgeChunk));
  const aiEntityFingerprint = adaptIndexedModel(required("aiEntityFingerprint", client.aiEntityFingerprint));
  const user = required("user", client.user);
  const graph = createPrismaGraphDb(client, scopeDb);
  const loadCandidates = async (type: "PROJECT" | "TASK", ids: string[]): Promise<DuplicateRecord[]> => {
    if (type === "PROJECT") {
      const rows = await client.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, description: true, objective: true, scope: true, successCriteria: true, ownerId: true, managerId: true, responsibleDepartmentId: true, startAt: true, dueAt: true, dueAtEnd: true, updatedAt: true, createdAt: true }, orderBy: { id: "asc" }, take: 100 });
      return rows.map((row) => ({ ...row }));
    }
    const rows = await client.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, description: true, projectId: true, stageId: true, caseStudyId: true, kpiId: true, startAt: true, dueAt: true, dueAtEnd: true, updatedAt: true, createdAt: true, isPrivate: true, signatureHash: true, dependencies: { select: { dependsOnId: true }, orderBy: { dependsOnId: "asc" }, take: 100 } }, orderBy: { id: "asc" }, take: 100 });
    return rows.map((row) => ({ ...row, dependencyIds: row.dependencies.map((dependency) => dependency.dependsOnId) }));
  };
  return {
    ...scopeDb,
    authorize: graph.authorize, load: graph.load,
    getCurrentSource: async (source, actor) => {
      const href = source.entityType === "PROJECT" ? `/projects/${encodeURIComponent(source.entityId)}` : source.entityType === "TASK" ? `/tasks/${encodeURIComponent(source.entityId)}` : source.entityType === "KPI" ? `/kpis/${encodeURIComponent(source.entityId)}` : source.entityType === "PMO_ACTION" ? `/pmo/actions/${encodeURIComponent(source.entityId)}` : `/internal/${source.entityType.toLowerCase()}/${encodeURIComponent(source.entityId)}`;
      const current = await graph.getCurrentSource({ ...source, label: "current", href, sourceUpdatedAt: new Date(0).toISOString(), checksum: "lookup" }, actor);
      return current ? { ...current, checksum: createEntityFingerprint({ entityType: current.entityType, entityId: current.entityId, label: current.label, href: current.href }) } : null;
    },
    aiKnowledgeChunk, aiEntityFingerprint, scopeDb,
    loadCandidates,
    findExistingIdempotentWorkflow: async (key, actorId) => client.aiWorkflow.findFirst({ where: { idempotencyKey: key, actorId }, select: { id: true, updatedAt: true } }),
    capacity: async (actor: SabahActor): Promise<CapacityEvidence[]> => {
      const users = await user.findMany({ where: { isActive: true, ...(actor.role === "ADMIN" || !actor.departmentIds.length ? {} : { departments: { some: { departmentId: { in: actor.departmentIds } } } }) }, select: { id: true, name: true, capacityPerWeekHours: true }, orderBy: { id: "asc" }, take: 100 });
      const windows = nextWeekWindows(1); const window = windows[0];
      const tasks = await client.task.findMany({ where: { status: { notIn: ["DONE", "CANCELED"] }, assignments: { some: { userId: { in: users.map((user) => user.id) } } } }, select: { effortHours: true, aiEffortHours: true, assignments: { select: { userId: true }, orderBy: { userId: "asc" }, take: 100 } }, orderBy: { id: "asc" }, take: 500 });
      const leaves = await client.leaveRequest.findMany({ where: { userId: { in: users.map((user) => user.id) }, status: "Approved", startAt: { lt: window.weekEnd }, endAt: { gte: window.weekStart } }, select: { userId: true, startAt: true, endAt: true }, orderBy: { id: "asc" }, take: 500 });
      return users.map((user) => { const userTasks = tasks.filter((task) => task.assignments.some((assignment) => assignment.userId === user.id)); const loadHours = userTasks.reduce((sum, task) => sum + estimateEffortWithSource(task).hours, 0); const leaveDays = workdaysOnLeave(window, leaves.filter((leave) => leave.userId === user.id)); const capacityHours = user.capacityPerWeekHours ?? 35; return { userId: user.id, displayName: user.name?.trim() || "(unnamed)", capacityHours: effectiveCapacity(capacityHours, leaveDays), loadHours, leaveDays }; });
    },
    authorizeCandidates: async (actor, ids) => (await user.findMany({ where: { id: { in: ids }, isActive: true, ...(actor.role === "ADMIN" || !actor.departmentIds.length ? {} : { departments: { some: { departmentId: { in: actor.departmentIds } } } }) }, select: { id: true }, orderBy: { id: "asc" }, take: 100 })).map((row) => row.id),
  };
}

function makeCapabilities(deps: WorkspaceCapabilityDeps = {}) {
  function base<I, O>(name: string, description: string, inputSchema: z.ZodType<I>, outputSchema: z.ZodType<O>, execute: (input: I, context: CapabilityContext) => Promise<O>): SabahCapability<I, O> {
    return defineCapability({ name, version: 1, module: "workspace", description, risk: "READ", inputSchema, outputSchema, available: async () => true, authorize: async () => undefined, preview: async () => ({ title: description, fields: [] }), execute, verify: async (output) => output, summarize: () => description });
  }
  const search = base("workspace.search", "Search authorized workspace records with source evidence.", searchInput, searchOutput, async (input, context) => { const result = await (deps.search ?? workspaceSearch)({ ...input, limit: Math.min(input.limit ?? 20, 20) }, context.actor, deps.searchDb ?? createPrismaWorkspaceDb(), {}); return searchOutput.parse({ ...safe(result), items: result.items.slice(0, 20).map((item: { source: unknown; snippet?: unknown; score?: unknown; status?: unknown }) => ({ source: item.source, snippet: String(item.snippet ?? "").slice(0, 500), confidence: confidence(Number(item.score ?? 0)), ...(item.status ? { status: String(item.status).slice(0, 40) } : {}) })) }); });
  const contextPack = base("workspace.contextPack", "Build a bounded, source-attributed context pack.", contextInput, z.object({ kind: z.string(), sections: z.array(z.object({ type: z.string(), items: z.array(z.unknown()).max(100) })).max(10), sources: z.array(sourceSchema).max(20), truncated: z.boolean() }).passthrough(), async (input, context) => safe(await buildContextPack(input.kind, { seedRefs: input.seedRefs, query: input.query, maxItems: 20, maxSources: 20, maxNormalizedCharacters: 20000 }, context.actor, deps.contextDb ?? createPrismaWorkspaceDb())));
  const related = base("workspace.relatedWork", "Find bounded duplicate and overlap candidates for a draft.", relatedInput, z.object({ candidates: z.array(z.object({ source: sourceSchema, overlap: z.enum(["EXACT", "LIKELY_DUPLICATE", "RELATED", "RECURRING"]), reasons: z.array(z.string().max(200)).max(6), confidence: z.enum(["HIGH", "MEDIUM", "LOW"]) }).strict()).max(25) }).strict(), async (input, context) => ({ candidates: (await findDuplicateCandidates(input, context.actor, deps.duplicateDb ?? createPrismaWorkspaceDb())).slice(0, 25).map((candidate) => ({ source: candidate.source, overlap: candidate.overlap, reasons: candidate.reasons.slice(0, 6).map((reason) => reason.slice(0, 200)), confidence: confidence(candidate.score) })) }));
  const assignment = base("workspace.assignmentCandidates", "Recommend capacity-aware assignment candidates with leave evidence.", assignmentInput, z.object({ recommendations: z.array(z.object({ userId: z.string(), evidence: z.object({ displayName: z.string().max(120), capacityHours: z.number(), loadHours: z.number(), leaveDays: z.number() }), reasons: z.array(z.string().max(240)).max(4) }).strict()).max(20), sources: z.array(sourceSchema).max(5), truncated: z.boolean() }).strict(), async (input, context) => safe(await recommendAssignments(input, context.actor, deps.contextDb ?? createPrismaWorkspaceDb())));
  return [search, contextPack, related, assignment] as const;
}

export const workspaceCapabilities = makeCapabilities();
function registerCapability<I, O>(registry: CapabilityRegistry, capability: SabahCapability<I, O>): void { registry.register(capability); }
export function registerWorkspaceCapabilities(registry: CapabilityRegistry, deps: WorkspaceCapabilityDeps = {}): void {
  const [search, contextPack, related, assignment] = makeCapabilities(deps);
  for (const capability of [search]) { try { registerCapability(registry, capability); } catch (error) { if (!(error instanceof Error && /already registered/.test(error.message))) throw error; } }
  for (const capability of [contextPack]) { try { registerCapability(registry, capability); } catch (error) { if (!(error instanceof Error && /already registered/.test(error.message))) throw error; } }
  for (const capability of [related]) { try { registerCapability(registry, capability); } catch (error) { if (!(error instanceof Error && /already registered/.test(error.message))) throw error; } }
  for (const capability of [assignment]) { try { registerCapability(registry, capability); } catch (error) { if (!(error instanceof Error && /already registered/.test(error.message))) throw error; } }
}
