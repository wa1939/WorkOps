import type { SabahActor } from "@/lib/sabah/auth/actor";
import { assertSourceVisible, getAuthorizedEntityIds, type AuthorizedScopeDb, type ScopeFilters } from "./authorized-scope";
import type { SearchCandidate, SourceRef, WorkspaceEntityType } from "./contracts";
import { normalizeWorkspaceText } from "./normalize";
import { rankAuthorizedCandidates, type EntityKey, type RankCandidate, type RankedResult } from "./rank";

export type WorkspaceSearchInput = { query: string; entityTypes: WorkspaceEntityType[]; filters?: ScopeFilters & Record<string, unknown>; limit?: number; cursor?: string };
export type IndexedRow = { id: string; entityType: WorkspaceEntityType; entityId: string; chunkKind?: string; kind?: string; text?: string | null; normalizedText?: string | null; fingerprint?: string | null; checksum?: string | null; sourceUpdatedAt?: Date | string | null; staleAt?: Date | string | null; deletedAt?: Date | string | null };
export type IndexedWhere = Record<string, unknown>;
export type IndexedSelect = Record<string, boolean>;
export type IndexedFindManyArgs = { where: IndexedWhere; select: IndexedSelect; orderBy: Array<Record<string, "asc" | "desc">>; take: number };
type IndexedModel = { findMany: (args: IndexedFindManyArgs) => Promise<IndexedRow[]> };
export type CurrentSourceProjection = { sourceUpdatedAt: Date | string; checksum: string; status?: string | null };
export type WorkspaceSearchDb = AuthorizedScopeDb & { aiKnowledgeChunk: IndexedModel; aiEntityFingerprint: IndexedModel; getCurrentSource: (source: Pick<SourceRef, "entityType" | "entityId">, actor: SabahActor) => Promise<CurrentSourceProjection | null> };
export type SemanticSearch = (query: string, candidates: Array<{ entityType: WorkspaceEntityType; entityId: string }>) => Promise<Array<{ entityType: WorkspaceEntityType; entityId: string; score: number }>>;
export type WorkspaceSearchOptions = { semanticSearch?: SemanticSearch; now?: Date };
const TYPES: WorkspaceEntityType[] = ["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"];
const fail = (message: string, status: number, code: string) => Object.assign(new Error(message), { status, code });
const keyOf = (type: WorkspaceEntityType, id: string): EntityKey => `${type}:${id}` as EntityKey;
const dateIso = (value: unknown) => { const date = value instanceof Date ? value : new Date(String(value)); return Number.isFinite(date.getTime()) ? date.toISOString() : null; };
const SAFE_FIELD = /^[^\u0000-\u001f\u007f]*$/;
const validHref = (value: unknown): value is string => typeof value === "string" && value.length >= 2 && value.length <= 256 && value.startsWith("/") && !value.includes("//") && !value.includes("\\") && SAFE_FIELD.test(value);
const parseSourceRef = (row: IndexedRow): SourceRef | null => {
  if (row.chunkKind !== "identity" || typeof row.text !== "string") return null;
  try {
    const value = JSON.parse(row.text.replace(/^identity:\s*/, "")) as Partial<SourceRef>;
    const updated = dateIso(row.sourceUpdatedAt);
    const label = value.label;
    const href = value.href;
    const checksum = row.checksum;
    if (!updated || value.entityType !== row.entityType || value.entityId !== row.entityId || !TYPES.includes(row.entityType) || typeof value.entityId !== "string" || value.entityId.length < 1 || value.entityId.length > 256 || !SAFE_FIELD.test(value.entityId) || typeof label !== "string" || label.length < 1 || label.length > 256 || !label.trim() || !SAFE_FIELD.test(label) || !validHref(href) || typeof checksum !== "string" || checksum.length < 1 || checksum.length > 256 || !SAFE_FIELD.test(checksum)) return null;
    return { entityType: row.entityType, entityId: row.entityId, label: label.slice(0, 500), href, sourceUpdatedAt: updated, checksum };
  } catch { return null; }
};
const decodeCursor = (value: string | undefined): { scope?: Partial<Record<WorkspaceEntityType, string>>; rank?: string } => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { v?: number; scope?: Partial<Record<WorkspaceEntityType, string>>; rank?: string };
    if (parsed.v !== 1 || (parsed.scope && Object.keys(parsed.scope).some((type) => !TYPES.includes(type as WorkspaceEntityType) || typeof parsed.scope?.[type as WorkspaceEntityType] !== "string")) || (parsed.rank !== undefined && typeof parsed.rank !== "string")) throw new Error();
    return { scope: parsed.scope, rank: parsed.rank };
  } catch { throw fail("Malformed or unknown cursor", 400, "INVALID_CURSOR"); }
};
const encodeCursor = (scope?: Partial<Record<WorkspaceEntityType, string>>, rank?: string) => Buffer.from(JSON.stringify({ v: 1, ...(scope && Object.keys(scope).length ? { scope } : {}), ...(rank ? { rank } : {}) })).toString("base64url");
const validLimit = (value: unknown) => value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100);

export async function workspaceSearch(input: WorkspaceSearchInput, actor: SabahActor, db: WorkspaceSearchDb, options: WorkspaceSearchOptions = {}): Promise<RankedResult> {
  if (typeof db.getCurrentSource !== "function") throw fail("Current-source resolver required", 503, "CURRENT_SOURCE_RESOLVER_REQUIRED");
  if (!Array.isArray(input.entityTypes) || !input.entityTypes.length || input.entityTypes.some((type) => !TYPES.includes(type))) throw fail("Invalid entity types", 400, "INVALID_ENTITY_TYPES");
  if (!validLimit(input.limit)) throw fail("Invalid limit", 400, "INVALID_LIMIT");
  const query = normalizeWorkspaceText(typeof input.query === "string" ? input.query.slice(0, 512) : "") ?? "";
  const limit = input.limit ?? 20;
  const cursor = decodeCursor(input.cursor);
  const entityTypes = Array.from(new Set(input.entityTypes));
  const scopeFilters: ScopeFilters = { ...(input.filters ?? {}), limit: 100, ...(cursor.scope ? { cursorByType: cursor.scope } : {}) };
  const scope = await getAuthorizedEntityIds(actor, entityTypes, scopeFilters, db);
  const pairs = entityTypes.flatMap((entityType) => (scope.ids[entityType] ?? []).map((entityId) => ({ entityType, entityId })));
  const authorized = new Set(pairs.map((pair) => keyOf(pair.entityType, pair.entityId)));
  if (!pairs.length) {
    const nextCursor = scope.truncated && scope.nextCursorByType ? encodeCursor(scope.nextCursorByType) : undefined;
    return { items: [], hasMore: Boolean(nextCursor), ...(nextCursor ? { nextCursor } : {}) };
  }
  const pairOr = pairs.map(({ entityType, entityId }) => ({ entityType, entityId }));
  const trigrams = query.length >= 3 ? Array.from(new Set(Array.from({ length: query.length - 2 }, (_, index) => query.slice(index, index + 3)))) : [];
  const lexicalOr = query ? [{ text: { contains: query, mode: "insensitive" } }, { normalizedText: { contains: query, mode: "insensitive" } }, ...trigrams.filter((gram) => gram !== query).flatMap((gram) => [{ text: { contains: gram, mode: "insensitive" } }, { normalizedText: { contains: gram, mode: "insensitive" } }])] : [];
  const exactOr = pairs.filter(({ entityId }) => entityId === input.query).map(({ entityType, entityId }) => ({ entityType, entityId }));
  const pairWhere = { OR: pairOr };
  const matchClauses = [...lexicalOr, ...exactOr];
  const chunkWhere: IndexedWhere = { AND: [{ staleAt: null, deletedAt: null }, pairWhere, { OR: matchClauses.length ? matchClauses : pairOr }] };
  const fingerprintWhere: IndexedWhere = { staleAt: null, deletedAt: null, fingerprint: { equals: query }, OR: pairOr };
  const [chunks, fingerprints] = await Promise.all([
    db.aiKnowledgeChunk.findMany({ where: chunkWhere, select: { id: true, entityType: true, entityId: true, chunkKind: true, text: true, normalizedText: true, checksum: true, sourceUpdatedAt: true, staleAt: true, deletedAt: true }, orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { id: "asc" }], take: pairs.length * 4 }),
    query ? db.aiEntityFingerprint.findMany({ where: fingerprintWhere, select: { id: true, entityType: true, entityId: true, kind: true, fingerprint: true, sourceUpdatedAt: true, staleAt: true, deletedAt: true }, orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { id: "asc" }], take: pairs.length * 4 }) : Promise.resolve([]),
  ]);
  const safeChunks = chunks.filter((row) => authorized.has(keyOf(row.entityType, row.entityId)) && row.staleAt == null && row.deletedAt == null);
  const safeFingerprints = fingerprints.filter((row) => authorized.has(keyOf(row.entityType, row.entityId)) && row.staleAt == null && row.deletedAt == null && row.fingerprint === query);
  const matched = new Set(safeChunks.map((row) => keyOf(row.entityType, row.entityId)).concat(safeFingerprints.map((row) => keyOf(row.entityType, row.entityId))));
  if (!matched.size) {
    const nextCursor = scope.truncated && scope.nextCursorByType ? encodeCursor(scope.nextCursorByType) : undefined;
    return { items: [], hasMore: Boolean(nextCursor), ...(nextCursor ? { nextCursor } : {}) };
  }
  const identities = await db.aiKnowledgeChunk.findMany({ where: { staleAt: null, deletedAt: null, chunkKind: "identity", OR: pairs.filter((pair) => matched.has(keyOf(pair.entityType, pair.entityId))) }, select: { id: true, entityType: true, entityId: true, chunkKind: true, text: true, normalizedText: true, checksum: true, sourceUpdatedAt: true, staleAt: true, deletedAt: true }, orderBy: [{ entityType: "asc" }, { entityId: "asc" }, { id: "asc" }], take: matched.size });
  const identityByKey = new Map<string, SourceRef>();
  for (const row of identities) { const source = parseSourceRef(row); if (source && authorized.has(keyOf(source.entityType, source.entityId))) identityByKey.set(keyOf(source.entityType, source.entityId), source); }
  const candidates = new Map<string, RankCandidate>();
  for (const row of safeChunks) {
    const key = keyOf(row.entityType, row.entityId); const source = identityByKey.get(key); if (!source) continue;
    const current = candidates.get(key);
    const text = String(row.text ?? "");
    candidates.set(key, { ...(current ?? { source, snippet: row.entityType === "NOTE" ? "Note content omitted." : text.slice(0, 500) }), source, text: `${current?.text ?? ""}\n${text}`.slice(0, 4000), normalizedText: `${current?.normalizedText ?? ""} ${String(row.normalizedText ?? "")}`.trim().slice(0, 4000), sourceUpdatedAt: source.sourceUpdatedAt });
  }
  for (const row of safeFingerprints) { const key = keyOf(row.entityType, row.entityId); const source = identityByKey.get(key); if (!source) continue; const candidate = candidates.get(key); if (candidate) candidate.fingerprintMatch = true; else candidates.set(key, { source, snippet: `${source.label}: ${source.href}`.slice(0, 500), text: "", normalizedText: "", sourceUpdatedAt: source.sourceUpdatedAt, fingerprintMatch: true }); }
  const revalidated: RankCandidate[] = [];
  for (const candidate of Array.from(candidates.values())) {
    try {
      await assertSourceVisible(candidate.source, actor, db);
      const current = await db.getCurrentSource(candidate.source, actor);
      if (!current) continue;
      const currentUpdated = dateIso(current.sourceUpdatedAt);
      const currentChecksum = current.checksum;
      const currentStatus = current.status;
      if (!currentUpdated || typeof currentChecksum !== "string" || currentChecksum.length < 1 || currentChecksum.length > 256 || !SAFE_FIELD.test(currentChecksum) || (currentStatus !== undefined && currentStatus !== null && (typeof currentStatus !== "string" || !SAFE_FIELD.test(currentStatus)))) continue;
      if (currentUpdated !== candidate.source.sourceUpdatedAt || currentChecksum !== candidate.source.checksum) continue;
      revalidated.push(currentStatus === undefined ? candidate : { ...candidate, status: currentStatus ?? undefined });
    }
    catch (error) {
      if (error && typeof error === "object" && (("code" in error && error.code === "NOT_FOUND") || ("status" in error && error.status === 404))) continue;
      throw error;
    }
  }
  let semantic: Awaited<ReturnType<SemanticSearch>> = [];
  if (options.semanticSearch) {
    try { semantic = await options.semanticSearch(query, revalidated.map(({ source }) => source)); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "SEMANTIC_UNAVAILABLE")) throw error; }
  }
  const semanticScores = new Map<EntityKey, number>(semantic.filter((item) => authorized.has(keyOf(item.entityType, item.entityId)) && Number.isFinite(item.score)).map((item) => [keyOf(item.entityType, item.entityId), Math.max(-1, Math.min(1, item.score))]));
  const result = rankAuthorizedCandidates({ query, candidates: revalidated, candidateIds: new Set(revalidated.map(({ source }) => keyOf(source.entityType, source.entityId))), semanticScores, filters: input.filters, limit, cursor: cursor.rank, now: options.now });
  if (result.hasMore && result.nextCursor) return { ...result, nextCursor: encodeCursor(cursor.scope, result.nextCursor) };
  const nextScope = scope.truncated ? scope.nextCursorByType : undefined;
  return { ...result, hasMore: result.hasMore || Boolean(nextScope), ...(result.hasMore && result.nextCursor ? { nextCursor: encodeCursor(cursor.scope, result.nextCursor) } : nextScope ? { nextCursor: encodeCursor(nextScope) } : {}) };
}

export type { SourceRef };
