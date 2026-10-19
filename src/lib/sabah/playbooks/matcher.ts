import type { PlaybookActor, PlaybookAdapter, PlaybookMatch, PlaybookRecord, PlaybookServiceOptions } from "./contracts";
import { isValidPlaybookRecord, playbookChecksum } from "./contracts";
import { canAccessMemory } from "@/lib/sabah/memory/authorization";
import { BUILTIN_PLAYBOOKS } from "./builtins";

export type MatchOptions = PlaybookServiceOptions & { actor: PlaybookActor };
const MAX_ITEMS = 16;
const normalize = (value: string): string => value.normalize("NFKC").toLocaleLowerCase("ar").replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "").replace(/[إأآٱ]/g, "ا").replace(/ـ/g, "").replace(/[^A-Za-z0-9\u0600-\u06FF]+/g, " ").trim().replace(/\s+/g, " ");
const tokens = (value: string): string[] => normalize(value).split(" ").filter(Boolean);
const scoreTrigger = (query: string, trigger: string): number => { const q = normalize(query); const t = normalize(trigger); if (q === t) return 1; if (q.includes(t) || t.includes(q)) return 0.85; const qTokens = new Set(tokens(query)); const overlap = tokens(trigger).filter((token) => qTokens.has(token)).length; return overlap ? 0.5 * overlap / Math.max(tokens(trigger).length, qTokens.size) : 0; };
const parseEntityQuery = (query: string): { entityType: string; entityId: string } | null => {
  const match = query.trim().match(/^([A-Z][A-Z0-9_]{0,31}) ([a-z0-9][a-z0-9._:-]{0,199})$/i);
  return match ? { entityType: match[1].toUpperCase(), entityId: match[2].toLowerCase() } : null;
};
const scoreRequiredEntity = (context: readonly string[], entity: { entityType: string; entityId: string } | null): number => {
  if (!entity) return 0;
  return context.some((item) => {
    const normalized = normalize(item).replace(/[/:]/g, " ");
    const parts = normalized.split(" ").filter(Boolean);
    return parts.includes(entity.entityType.toLowerCase()) && (parts.includes(entity.entityId) || parts.length === 1);
  }) ? 0.7 : 0;
};
const bounded = (value: unknown, limit: number): value is readonly string[] => Array.isArray(value) && value.length > 0 && value.length <= limit && value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 128);
const satisfiesGlobalPolicy = (row: PlaybookRecord, global: readonly string[]): boolean => global.every((approval) => row.requiredApprovals.includes(approval));
const configuredGlobals = (options: MatchOptions): readonly string[] | null => { const global = options.globalRequiredApprovals; return global === undefined ? ["lead"] : Array.isArray(global) && global.length > 0 && global.length <= MAX_ITEMS && global.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 80) ? global : null; };

export async function matchPlaybooks(query: string, options: MatchOptions): Promise<PlaybookMatch[]> {
  if (typeof query !== "string" || query.length > 128 || !normalize(query)) return [];
  const global = configuredGlobals(options); if (!global) return [];
  let customRows: PlaybookRecord[];
  try { customRows = await options.adapter.list(); } catch { return []; }
  if (!Array.isArray(customRows)) return [];
  const rows = [...BUILTIN_PLAYBOOKS, ...customRows];
  const seen = new Set<string>(); const matches: PlaybookMatch[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (!isValidPlaybookRecord(row) || row.checksum !== playbookChecksum(row) || row.state !== "APPROVED" || !satisfiesGlobalPolicy(row, global)) continue;
    const key = `${row.playbookId}@${row.version}`; if (seen.has(key)) continue; seen.add(key);
    const canonicalBuiltin = BUILTIN_PLAYBOOKS.includes(row);
    const policy = canonicalBuiltin ? undefined : row.scope === "TEAM" || row.scope === "WORKSPACE" ? options.sharedAccessPolicy : undefined;
    if (!canonicalBuiltin && !(await canAccessMemory(options.actor, { id: row.id, scope: row.scope, ownerId: row.ownerId, departmentId: row.departmentId }, policy))) continue;
    try { for (const name of row.allowedCapabilities) { const capability = options.registry.resolve(name, 1); if (capability.name !== name || capability.risk === "BLOCKED") throw new Error("capability not allowed"); } } catch { continue; }
    const scores = [...row.triggers.en, ...row.triggers.ar].map((trigger) => scoreTrigger(query, trigger)); const entityScore = scoreRequiredEntity(row.requiredContext, parseEntityQuery(query)); const score = Math.max(...scores, 0, entityScore); if (score < 0.5) continue;
    matches.push({ playbookId: row.playbookId, version: row.version, score, reasons: entityScore >= score && entityScore > 0 ? ["matched required entity context"] : ["matched approved trigger"], requiredContext: row.requiredContext.slice(0, MAX_ITEMS) });
  }
  return matches.sort((left, right) => right.score - left.score || left.playbookId.localeCompare(right.playbookId)).slice(0, 5);
}
