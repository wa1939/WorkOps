import type { SabahActor } from "@/lib/sabah/auth/actor";
import type { SourceRef } from "./contracts";
import type { CapacityEvidence, ContextPackDb } from "./context-packs";
import { effectiveCapacity } from "@/lib/team-load";
import { createEntityFingerprint } from "./fingerprint";
import { normalizeWorkspaceText } from "./normalize";
export interface AssignmentRequest { taskRef: SourceRef; candidateUserIds: string[]; effortHours: number }
export interface AssignmentRecommendation { userId: string; evidence: CapacityEvidence; reasons: string[] }
export interface AssignmentRecommendations { recommendations: AssignmentRecommendation[]; sources: SourceRef[]; truncated: boolean }
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const validEvidence = (row: CapacityEvidence) => validId(row.userId) && typeof row.displayName === "string" && row.displayName.length <= 500 && Number.isFinite(row.capacityHours) && row.capacityHours >= 0 && row.capacityHours <= 10_000 && Number.isFinite(row.loadHours) && row.loadHours >= 0 && row.loadHours <= 100_000 && Number.isFinite(row.leaveDays) && row.leaveDays >= 0 && row.leaveDays <= 5;
const canonicalTaskSource = (source: SourceRef): SourceRef | null => {
  if (source.entityType !== "TASK" || !validId(source.entityId) || typeof source.label !== "string" || !normalizeWorkspaceText(source.label)) return null;
  const parsed = typeof source.sourceUpdatedAt === "string" ? Date.parse(source.sourceUpdatedAt) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  const label = normalizeWorkspaceText(source.label)?.slice(0, 120) ?? "";
  if (!label) return null;
  const sourceUpdatedAt = new Date(parsed).toISOString();
  const checksum = createEntityFingerprint({ entityType: "TASK", entityId: source.entityId, label, updatedAt: sourceUpdatedAt });
  return { entityType: "TASK", entityId: source.entityId, label: label.slice(0, 120), href: `/tasks/${encodeURIComponent(source.entityId)}`, sourceUpdatedAt, checksum };
};
export async function recommendAssignments(request: AssignmentRequest, actor: SabahActor, db: ContextPackDb): Promise<AssignmentRecommendations> {
  if (!request || request.taskRef?.entityType !== "TASK" || !validId(request.taskRef?.entityId) || !Number.isFinite(request.effortHours) || request.effortHours < 0 || request.effortHours > 10_000 || !Array.isArray(request.candidateUserIds) || request.candidateUserIds.length > 100 || request.candidateUserIds.some((id) => !validId(id)) || !db.capacity || !db.authorizeCandidates || !db.getCurrentSource) return { recommendations: [], sources: [], truncated: false };
  const authorizedTask = (await db.authorize([request.taskRef], actor)).find((r) => r.entityType === "TASK" && r.entityId === request.taskRef.entityId); if (!authorizedTask) return { recommendations: [], sources: [], truncated: false };
  const candidateIds = Array.from(new Set(request.candidateUserIds)).sort(); if (!candidateIds.length) return { recommendations: [], sources: [], truncated: false };
  const authorizedIds = await db.authorizeCandidates(actor, candidateIds); if (!Array.isArray(authorizedIds) || authorizedIds.some((id) => !candidateIds.includes(id) || !validId(id))) return { recommendations: [], sources: [], truncated: false };
  const allowed = new Set(authorizedIds); const uniqueRows = new Map<string, CapacityEvidence>();
  for (const row of await db.capacity(actor)) if (validEvidence(row) && allowed.has(row.userId) && candidateIds.includes(row.userId)) uniqueRows.set(row.userId, row);
  const rows = Array.from(uniqueRows.values()).slice(0, 100);
  const remaining = (row: CapacityEvidence) => effectiveCapacity(row.capacityHours, row.leaveDays) - row.loadHours - request.effortHours;
  const ordered = [...rows].sort((a, b) => remaining(b) - remaining(a) || a.userId.localeCompare(b.userId));
  const current = await db.getCurrentSource(authorizedTask, actor); if (!current || current.entityType !== "TASK" || current.entityId !== request.taskRef.entityId) return { recommendations: [], sources: [], truncated: false };
  const source = canonicalTaskSource(current); if (!source) return { recommendations: [], sources: [], truncated: false };
  return { recommendations: ordered.map((row) => ({ userId: row.userId, evidence: { userId: row.userId, displayName: row.displayName.slice(0, 120), capacityHours: row.capacityHours, loadHours: row.loadHours, leaveDays: row.leaveDays }, reasons: [`Available capacity after current load: ${Math.max(0, remaining(row))} hours`, ...(row.leaveDays > 0 ? [`${row.leaveDays} leave day(s) reduce weekly capacity`] : [])] })), sources: [source], truncated: false };
}
