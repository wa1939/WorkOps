import type { SabahActor } from "@/lib/sabah/auth/actor";
import { canAccessMemory } from "./authorization";
import type { MemoryAdapter, MemoryProjection, MemoryRecord, SourceVerifier, SourceVerification, SourceChecksumVerifier, SharedScopePolicy } from "./contracts";

export type RetrievalOptions = { adapter: MemoryAdapter; actor: SabahActor; query?: string; limit?: number; now?: Date; sourceVerifier?: SourceVerifier; sourceChecksumVerifier?: SourceChecksumVerifier; canAccessSharedScope?: SharedScopePolicy; terminologyTerms?: string[]; triggerTerms?: string[] };
export type RetrievalResult = { items: MemoryProjection[]; reviewIds: string[] };
const factualKinds = new Set(["FACT", "DECISION", "RELATIONSHIP"]);
const project = (row: MemoryRecord): MemoryProjection => ({ id: row.id, scope: row.scope, kind: row.kind, content: row.content.slice(0, 500), provenance: row.provenance, confidence: row.confidence, freshness: row.freshness, expiresAt: row.expiresAt ?? null, ownerId: row.ownerId ?? null, departmentId: row.departmentId ?? null, sources: row.sources.slice(0, 5).map((source) => ({ entityType: source.entityType, entityId: source.entityId, label: source.label.slice(0, 200), href: source.href.slice(0, 500), sourceUpdatedAt: source.sourceUpdatedAt, checksum: source.checksum })) });
const scopeScore: Record<MemoryRecord["scope"], number> = { USER: 12, DEPARTMENT: 9, TEAM: 6, WORKSPACE: 3 };
const boundedTerms = (terms: string[] | undefined): string[] => (terms ?? []).filter((term) => typeof term === "string").map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0 && term.length <= 100).slice(0, 20);
const parseEntityQuery = (query: string): { entityType: string; entityId: string } | null => {
  const match = query.trim().match(/^([A-Z][A-Z0-9_]{0,31}) ([a-z0-9][a-z0-9._:-]{0,199})$/i);
  return match ? { entityType: match[1].toUpperCase(), entityId: match[2].toLowerCase() } : null;
};
const score = (row: MemoryRecord, query: string, options: RetrievalOptions): number => {
  const q = query.trim().toLowerCase();
  if (!q) return scopeScore[row.scope];
  const entity = parseEntityQuery(query);
  const words = q.split(/\s+/).filter(Boolean);
  const content = row.content.toLowerCase();
  let value = words.reduce((total, word) => total + (content.includes(word) ? 2 : 0), 0);
  if (content.includes(q)) value += 8;
  const terminology = [...boundedTerms(row.terminologyTerms), ...boundedTerms(options.terminologyTerms)];
  const triggers = [...boundedTerms(row.triggerTerms), ...boundedTerms(options.triggerTerms)];
  if (row.kind === "TERMINOLOGY" || terminology.some((term) => q.includes(term) || term.includes(q))) value += 40;
  if (triggers.some((term) => q.includes(term))) value += 30;
  if (entity) for (const source of row.sources) {
    if (source.entityType.toUpperCase() === entity.entityType) value += source.entityId.toLowerCase() === entity.entityId ? 100 : 35;
  }
  value += scopeScore[row.scope];
  return value;
};

export async function retrieveMemories(options: RetrievalOptions): Promise<RetrievalResult> {
  const now = options.now ?? new Date();
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 50);
  const rows = await options.adapter.list();
  const reviewIds: string[] = [];
  const candidates = rows.filter((row) => {
    if (row.state !== "APPROVED" || row.supersededById || (row.expiresAt && row.expiresAt <= now)) return false;
    if (row.scope === "TEAM" || row.scope === "WORKSPACE") return true;
    return true;
  });
  const accessible: MemoryRecord[] = [];
  for (const row of candidates) {
    if (!await canAccessMemory(options.actor, row, options.canAccessSharedScope)) continue;
    if (factualKinds.has(row.kind) && row.freshness === "STALE") {
      reviewIds.push(row.id);
      continue;
    }
    accessible.push(row);
  }
  const verifiedRows: MemoryRecord[] = [];
  for (const row of accessible) {
    let verified = true;
    if (factualKinds.has(row.kind) && !options.sourceVerifier) verified = false;
    for (const source of row.sources) {
      try {
        const status: SourceVerification | boolean = options.sourceVerifier ? await options.sourceVerifier(options.actor, source) : true;
        const checksumOk = options.sourceChecksumVerifier ? await options.sourceChecksumVerifier(options.actor, source) : true;
        if (!((status === true || status === "CURRENT") && checksumOk)) { verified = false; break; }
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || (error as { code?: unknown }).code !== "NOT_FOUND") throw error;
        verified = false;
        break;
      }
    }
    if (verified && (row.sources.length > 0 || !factualKinds.has(row.kind))) verifiedRows.push(row); else reviewIds.push(row.id);
  }
  const unique = new Map<string, MemoryRecord>();
  for (const row of verifiedRows) {
    const key = `${row.kind}:${row.content.trim().toLowerCase().replace(/\s+/g, " ")}`;
    const current = unique.get(key);
    if (!current || score(row, options.query ?? "", options) > score(current, options.query ?? "", options) || (score(row, options.query ?? "", options) === score(current, options.query ?? "", options) && (row.updatedAt.getTime() > current.updatedAt.getTime() || (row.updatedAt.getTime() === current.updatedAt.getTime() && row.id.localeCompare(current.id) < 0)))) unique.set(key, row);
  }
  const items = Array.from(unique.values()).sort((a, b) => score(b, options.query ?? "", options) - score(a, options.query ?? "", options) || b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id)).slice(0, limit).map(project);
  return { items, reviewIds: Array.from(new Set(reviewIds)) };
}
