import type { SearchCandidate, SourceRef, WorkspaceEntityType } from "./contracts";
import { normalizeWorkspaceText } from "./normalize";

export type EntityKey = `${WorkspaceEntityType}:${string}`;
export type RankCandidate = Omit<SearchCandidate, "score"> & {
  title?: string;
  normalizedTitle?: string;
  text?: string;
  normalizedText?: string;
  exactId?: boolean;
  exactTitle?: boolean;
  fingerprintMatch?: boolean;
  lexicalScore?: number;
  semanticScore?: number;
  status?: string;
  staleAt?: string | Date | null;
  sourceUpdatedAt?: string | Date;
};
export type RankInput = {
  query: string;
  candidates: RankCandidate[];
  candidateIds?: Set<EntityKey>;
  semanticScores?: Map<EntityKey, number>;
  filters?: Record<string, unknown>;
  limit?: number;
  cursor?: string;
  now?: Date;
};
export type RankedResult = { items: SearchCandidate[]; hasMore: boolean; nextCursor?: string };

type RankCursor = { v: 1; score: number; key: EntityKey };
const TYPES = new Set<WorkspaceEntityType>(["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"]);
const bad = (message: string) => Object.assign(new Error(message), { status: 400, code: "INVALID_CURSOR" });
const boundedLimit = (value: number | undefined) => Math.max(1, Math.min(100, Number.isFinite(value) ? Math.trunc(value!) : 20));
const keyOf = (source: SourceRef): EntityKey => `${source.entityType}:${source.entityId}` as EntityKey;
const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const time = (value: string | Date | undefined | null) => {
  const parsed = value instanceof Date ? value.getTime() : value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const FILTER_KEYS = new Set(["status", "updatedAfter", "updatedBefore"]);
const validateFilters = (filters?: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (!FILTER_KEYS.has(key)) throw Object.assign(new Error(`Unsupported filter: ${key}`), { status: 400, code: "INVALID_FILTER" });
    if ((key === "updatedAfter" || key === "updatedBefore") && value !== undefined && value !== null && time(value as string) === null) throw Object.assign(new Error(`Invalid date filter: ${key}`), { status: 400, code: "INVALID_FILTER" });
    if (key === "status" && value !== undefined && value !== null && typeof value !== "string") throw Object.assign(new Error(`Invalid filter: ${key}`), { status: 400, code: "INVALID_FILTER" });
  }
};
const encode = (value: RankCursor) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const decode = (value: string): RankCursor => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<RankCursor>;
    const key = parsed.key;
    const score = parsed.score;
    if (parsed.v !== 1 || typeof key !== "string" || typeof score !== "number" || !Number.isFinite(score)) throw new Error();
    const split = key.indexOf(":");
    if (split <= 0 || !TYPES.has(key.slice(0, split) as WorkspaceEntityType) || !key.slice(split + 1)) throw new Error();
    return { v: 1, score, key: key as EntityKey };
  } catch { throw bad("Malformed or unknown cursor"); }
};
const trigrams = (value: string) => value.length < 3 ? [] : Array.from({ length: value.length - 2 }, (_, index) => value.slice(index, index + 3));
const lexical = (candidate: RankCandidate, query: string) => {
  const supplied = candidate.lexicalScore;
  if (supplied !== undefined) return Math.max(0, Math.min(1, finite(supplied)));
  if (!query) return 0;
  const haystack = normalizeWorkspaceText(candidate.normalizedText ?? candidate.text ?? "") ?? "";
  if (haystack === query) return 1;
  if (haystack.includes(query)) return 0.8;
  if (query.length < 3) return haystack.includes(query) ? 0.65 : 0;
  const grams = trigrams(query);
  return grams.length ? 0.6 * grams.filter((gram) => haystack.includes(gram)).length / grams.length : 0;
};
const matchesFilters = (candidate: RankCandidate, filters?: Record<string, unknown>) => Object.entries(filters ?? {}).every(([key, value]) => {
  if (value === undefined || value === null) return true;
  if (key === "updatedAfter" || key === "updatedBefore") {
    const candidateTime = time(candidate.sourceUpdatedAt ?? candidate.source.sourceUpdatedAt);
    const filterTime = time(value as string);
    if (candidateTime === null || filterTime === null) return false;
    return key === "updatedAfter" ? candidateTime >= filterTime : candidateTime <= filterTime;
  }
  return candidate[key as keyof RankCandidate] === value;
});

export function rankAuthorizedCandidates(input: RankInput): RankedResult {
  const query = normalizeWorkspaceText(input.query) ?? "";
  validateFilters(input.filters);
  const limit = boundedLimit(input.limit);
  const now = time(input.now ?? new Date()) ?? Date.now();
  const cursor = input.cursor ? decode(input.cursor) : undefined;
  const ranked = input.candidates.filter((candidate) => {
    const key = keyOf(candidate.source);
    return (!input.candidateIds || input.candidateIds.has(key)) && matchesFilters(candidate, input.filters);
  }).map((candidate) => {
    const key = keyOf(candidate.source);
    const title = normalizeWorkspaceText(candidate.normalizedTitle ?? candidate.title ?? candidate.source.label) ?? "";
    const exactId = candidate.exactId === true || candidate.source.entityId === input.query;
    const exactTitle = candidate.exactTitle === true || (Boolean(query) && title === query);
    const semantic = Math.max(-1, Math.min(1, finite(input.semanticScores?.get(key) ?? candidate.semanticScore)));
    const updated = time(candidate.sourceUpdatedAt ?? candidate.source.sourceUpdatedAt);
    const ageDays = updated === null ? 365 : Math.max(0, (now - updated) / 86400000);
    const freshness = 25 * Math.exp(-Math.min(ageDays, 365) / 30);
    const stalePenalty = candidate.staleAt ? 75 : 0;
    const score = (exactId ? 1000 : 0) + (exactTitle ? 800 : 0) + (candidate.fingerprintMatch ? 500 : 0) + (title.includes(query) && Boolean(query) ? 300 : 0) + lexical(candidate, query) * 100 + semantic * 50 + freshness - stalePenalty;
    return { candidate, key, score: finite(score) };
  }).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const start = cursor ? ranked.findIndex((item) => item.score === cursor.score && item.key === cursor.key) + 1 : 0;
  if (cursor && start === 0) throw bad("Unknown cursor");
  const page = ranked.slice(start, start + limit);
  const items = page.map(({ candidate, score }) => ({ source: candidate.source, score: Number(score.toFixed(6)), ...(candidate.snippet ? { snippet: candidate.snippet.slice(0, 500) } : {}) }));
  const hasMore = start + limit < ranked.length;
  return { items, hasMore, ...(hasMore && page.length ? { nextCursor: encode({ v: 1, score: page[page.length - 1].score, key: page[page.length - 1].key }) } : {}) };
}

export type { SourceRef };
