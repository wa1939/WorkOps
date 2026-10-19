import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { SourceRef } from "./contracts";
import { loadWorkspaceGraph, sanitizeSourceRef, type GraphDb, type GraphLimits, type GraphRelation } from "./graph";
import { normalizeWorkspaceText } from "./normalize";
export type ContextPackKind = "TASK_CREATION" | "PROJECT_PORTFOLIO" | "TEAM_CAPACITY" | "KPI_RECOVERY" | "PMO_FOLLOW_UP" | "FORM";
export interface ContextPackRequest extends GraphLimits { seedRefs?: SourceRef[]; query?: string; maxItems?: number; maxCharacters?: number }
export interface CapacityEvidence { userId: string; displayName: string; capacityHours: number; loadHours: number; leaveDays: number }
export interface ContextItem { ref?: SourceRef; title: string; summary?: string; evidence?: Record<string, string | number | string[]> }
export interface ContextSection { type: string; items: ContextItem[] }
export interface ContextPack { kind: ContextPackKind; query?: string; sections: ContextSection[]; sources: SourceRef[]; normalizedCharacterCount: number; truncated: boolean }
export interface ContextPackDb extends GraphDb { capacity?: (actor: SabahActor) => Promise<CapacityEvidence[]>; authorizeCandidates?: (actor: SabahActor, ids: string[]) => Promise<string[]> }
const sectionType: Record<ContextPackKind, string> = { TASK_CREATION: "task-capacity", PROJECT_PORTFOLIO: "portfolio", TEAM_CAPACITY: "capacity", KPI_RECOVERY: "kpi-recovery", PMO_FOLLOW_UP: "pmo-follow-up", FORM: "form" };
const finiteNonnegative = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
const validCapacity = (row: CapacityEvidence): boolean => typeof row.userId === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(row.userId) && typeof row.displayName === "string" && row.displayName.trim().length > 0 && row.displayName.length <= 500 && finiteNonnegative(row.capacityHours) && row.capacityHours <= 10_000 && finiteNonnegative(row.loadHours) && row.loadHours <= 100_000 && finiteNonnegative(row.leaveDays) && row.leaveDays <= 5;
/** Counts every returned textual/numeric content value; only JSON punctuation is excluded. */
const contentLength = (value: unknown): number => { const text: string[] = []; const walk = (item: unknown): void => { if (typeof item === "string") text.push(normalizeWorkspaceText(item) ?? ""); else if (typeof item === "number" && Number.isFinite(item)) text.push(String(item)); else if (Array.isArray(item)) item.forEach(walk); else if (item && typeof item === "object") Object.values(item).forEach(walk); }; walk(value); return text.join("\u0000").length; };
const bounded = (value: number | undefined, fallback: number, upper: number) => typeof value !== "number" || !Number.isFinite(value) || value < 0 ? fallback : Math.min(Math.trunc(value), upper);
const relationItems = (nodes: Awaited<ReturnType<typeof loadWorkspaceGraph>>["nodes"], allowed: string[], kind: ContextPackKind): ContextItem[] => nodes.filter((node) => node.ref.entityType !== "NOTE").flatMap((node) => (node.relations ?? []).filter((r) => allowed.includes(r.kind)).map((r: GraphRelation) => ({ ...(r.ref ? { ref: r.ref } : {}), title: r.title, summary: r.detail, evidence: { relationKind: r.kind, sourceEntity: node.ref.entityType, sourceId: node.ref.entityId, contextKind: kind } })));
export async function buildContextPack(kind: ContextPackKind, request: ContextPackRequest, actor: SabahActor, db: ContextPackDb): Promise<ContextPack> {
  const normalizedRequest: Partial<ContextPackRequest> = request !== null && typeof request === "object" && !Array.isArray(request) ? request : {};
  const maxItems = bounded(normalizedRequest.maxItems, 20, 100);
  const requested = normalizedRequest.maxNormalizedCharacters ?? normalizedRequest.maxCharacters;
  const budget = bounded(requested, 20_000, 20_000);
  const rawSeedRefs: unknown = normalizedRequest.seedRefs;
  const seedRefs = Array.isArray(rawSeedRefs) ? rawSeedRefs.map(sanitizeSourceRef).filter((source): source is SourceRef => source !== null) : [];
  const maxSources = bounded(normalizedRequest.maxSources, 20, 20);
  const graph = await loadWorkspaceGraph(seedRefs, actor, { ...normalizedRequest, maxNodes: maxItems, maxSources, maxNormalizedCharacters: budget }, db);
  let items: ContextItem[]; let section: ContextSection;
  switch (kind) {
    case "TASK_CREATION": items = relationItems(graph.nodes, ["TASK_PROJECT", "TASK_STAGE", "TASK_DEPENDENCY", "TASK_BLOCKER", "TASK_ASSIGNMENT", "TASK_EXTERNAL_ACTION"], kind); section = { type: sectionType[kind], items }; break;
    case "PROJECT_PORTFOLIO": items = relationItems(graph.nodes, ["PROJECT_OBJECTIVE", "PROJECT_OUTPUT", "PROJECT_RISK", "PROJECT_STAGE", "PROJECT_TASK", "PROJECT_MEMBER", "OBJECTIVE_KPI"], kind); section = { type: sectionType[kind], items }; break;
    case "TEAM_CAPACITY": { items = relationItems(graph.nodes, ["TASK_ASSIGNMENT", "TASK_LEAVE"], kind); if (db.capacity && db.authorizeCandidates) { const rows = (await db.capacity(actor)).filter(validCapacity); const requestedIds = Array.from(new Set(rows.map((row) => row.userId))).sort(); const authorization = requestedIds.length ? await db.authorizeCandidates(actor, requestedIds) : []; const authorized = Array.isArray(authorization) && authorization.every((id) => typeof id === "string" && requestedIds.includes(id)) ? new Set(authorization) : new Set<string>(); for (const row of rows) if (authorized.has(row.userId)) items.push({ title: normalizeWorkspaceText(row.displayName)?.slice(0, 120) ?? "", evidence: { evidenceType: "capacity", userId: row.userId, capacityHours: row.capacityHours, loadHours: row.loadHours, leaveDays: row.leaveDays } }); } section = { type: sectionType[kind], items }; break; }
    case "KPI_RECOVERY": items = relationItems(graph.nodes, ["KPI_UPDATE", "OBJECTIVE_KPI", "TASK_KPI"], kind); section = { type: sectionType[kind], items }; break;
    case "PMO_FOLLOW_UP": items = relationItems(graph.nodes, ["PMO_TASK", "PMO_OWNER", "PMO_CONTACT", "PMO_FOLLOW_UP", "PMO_EVIDENCE", "TASK_EXTERNAL_ACTION"], kind); section = { type: sectionType[kind], items }; break;
    case "FORM": items = graph.nodes.map((node) => ({ ref: node.ref, title: node.title, summary: node.summary, evidence: { sourceType: node.ref.entityType, sourceId: node.ref.entityId, field: "title", availableFields: ["title", "summary", "status"] } })); section = { type: sectionType[kind], items }; break;
  }
  const rawItems = items.slice(0, maxItems); let boundedItems: ContextItem[] = []; let sources = graph.sources.length ? [...graph.sources] : graph.nodes.map((node) => node.ref);
  if (!sources.length && maxSources > 0 && seedRefs.length) sources = (await db.authorize(seedRefs.slice(0, maxSources), actor)).map(sanitizeSourceRef).filter((source): source is SourceRef => source !== null).filter((source) => seedRefs.some((seed) => seed.entityType === source.entityType && seed.entityId === source.entityId));
  let query = typeof normalizedRequest.query === "string" ? normalizeWorkspaceText(normalizedRequest.query)?.slice(0, 300) : undefined; let queryTruncated = false;
  const outputLength = (queryValue: string | undefined, itemValue: ContextItem[], sourceValue: SourceRef[]) => contentLength({ kind, query: queryValue, sections: [{ type: section.type, items: itemValue }], sources: sourceValue });
  if (budget === 0 || maxItems === 0 || outputLength(undefined, [], []) > budget) return { kind, sections: [{ type: sectionType[kind], items: [] }], sources: [], normalizedCharacterCount: 0, truncated: true };
  for (const item of rawItems) { if (outputLength(query, [...boundedItems, item], sources) <= budget) boundedItems.push(item); else break; }
  while (sources.length && outputLength(query, boundedItems, sources) > budget) sources.pop();
  while (query && outputLength(query, boundedItems, sources) > budget) { query = undefined; queryTruncated = true; }
  const output = { kind, ...(query ? { query } : {}), sections: [{ ...section, items: boundedItems }], sources };
  const used = outputLength(query, boundedItems, sources);
  return { ...output, normalizedCharacterCount: used, truncated: graph.truncated || boundedItems.length < rawItems.length || sources.length < graph.sources.length || queryTruncated };
}
