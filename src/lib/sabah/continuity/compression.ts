import { z } from "zod";
import { callGLMText, type GLMModel, type GLMDiagnosticEvent } from "@/lib/glm";
import { randomUUID } from "node:crypto";
import { recordDiagnostic } from "@/lib/diagnostics/record";
import { prisma } from "@/lib/prisma";
import { resolveModelForRole, getConfiguredFallbacks } from "@/lib/sabah/providers/roles";
import { resolveRuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";
import { isCompressionTargetSupported } from "@/lib/sabah/providers/model-support";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { enqueueJob } from "../jobs/queue";
import type { JobDb, QueueJob, JsonValue } from "../jobs/contracts";
import { scanAndRedactSecrets } from "../security/secret-scan";

const boundedText = z.string().trim().min(1).max(4_000);
const item = z.object({ messageId: z.string().trim().min(1).max(200), text: boundedText }).strict();
export const conversationSummarySchema = z.object({
  factualSummary: z.string().max(12_000), userCorrections: z.array(item).max(100), decisions: z.array(item).max(100),
  unresolvedActions: z.array(z.object({ workflowId: z.string().trim().min(1).max(200).nullable(), text: boundedText }).strict()).max(100),
  approvals: z.array(z.object({ approvalId: z.string().trim().min(1).max(200), decision: boundedText }).strict()).max(100),
  safetyBoundaries: z.array(z.string().trim().min(1).max(1_000)).max(100), sourceMessageIds: z.array(z.string().trim().min(1).max(200)).max(500),
}).strict();
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
type Message = { id: string; conversationId: string; role: string; content: string | null; toolCallsJson?: string | null; toolCallId?: string | null; createdAt: Date };
export type SummaryRow = { id: string; version: number; startMessageId: string; endMessageId: string; protectedStateJson: string; sourceMessageIdsJson: string; supersededById?: string | null };
type Feedback = { id: string; outcome: string; contextJson: string; conversationId?: string | null; messageId?: string | null };
type Workflow = { id: string; goal: string; status: string; conversationId?: string | null };
type Approval = { id: string; status: string; decisionType?: string | null; decisionReason?: string | null; workflowId: string };
export type CompressionDb = {
  aiConversation: { findUnique(args: unknown): Promise<{ userId: string } | null> };
  aiMessage: { findMany(args: unknown): Promise<Message[]> };
  aiConversationSummary: { findFirst(args: unknown): Promise<SummaryRow | null>; create(args: unknown): Promise<SummaryRow>; update(args: unknown): Promise<SummaryRow> };
  aiFeedback?: { findMany(args: unknown): Promise<Feedback[]> };
  aiWorkflow?: { findMany(args: unknown): Promise<Workflow[]> };
  aiApproval?: { findMany(args: unknown): Promise<Approval[]> };
  $transaction<T>(work: (tx: CompressionDb) => Promise<T>): Promise<T>;
};
export type CompressionOptions = {
  provider?: (prompt: string) => Promise<string>;
  modelResolver?: (db: CompressionDb) => Promise<string>;
  logger?: (event: { conversationId: string; actorId: string; reason: string }) => Promise<void> | void;
  protectedState?: Partial<Pick<ConversationSummary, "userCorrections" | "decisions" | "unresolvedActions" | "approvals" | "safetyBoundaries">>;
  maxMessages?: number;
  signal?: AbortSignal;
  background?: { idempotencyKey: string; db?: JobDb; enqueuer?: CompressionEnqueuer };
};
export type CompressionEnqueuer = (input: { type: "COMPRESSION"; idempotencyKey: string; priority: 1 | 2 | 3 | 4; payload: JsonValue; actorId: string; maxAttempts: number }) => Promise<QueueJob>;
export async function enqueueCompression(conversationId: string, actor: SabahActor, idempotencyKey: string, options: { db?: JobDb; enqueuer?: CompressionEnqueuer } = {}): Promise<QueueJob> {
  if (!/^[A-Za-z0-9:_./-]{1,160}$/.test(conversationId) || !/^[A-Za-z0-9:_./-]{1,160}$/.test(idempotencyKey) || !/^[A-Za-z0-9:_./-]{1,160}$/.test(actor.id)) throw new Error("compression queue identity required");
  const payload = scanAndRedactSecrets({ conversationId, actor: { role: actor.role, departmentIds: actor.departmentIds.slice(0, 100) } }).value;
  if (JSON.stringify(payload).length > 50_000) throw new Error("compression payload exceeds bounds");
  const input = { type: "COMPRESSION" as const, idempotencyKey, priority: 2 as const, payload, actorId: actor.id, maxAttempts: 3 };
  return options.enqueuer ? options.enqueuer(input) : enqueueJob(options.db, input);
}
const failure = (conversationId: string, reason: string) => ({ status: "uncompressed" as const, conversationId, reason: reason.slice(0, 200) });
async function logFailure(o: CompressionOptions, conversationId: string, actor: SabahActor, reason: string) { try { await o.logger?.({ conversationId, actorId: actor.id, reason: reason.slice(0, 200) }); } catch { /* best effort */ } }

const key = (s: ConversationSummary) => [...s.userCorrections.map(x => `u:${x.messageId}:${x.text}`), ...s.decisions.map(x => `d:${x.messageId}:${x.text}`), ...s.unresolvedActions.map(x => `w:${x.workflowId ?? "null"}:${x.text}`), ...s.approvals.map(x => `a:${x.approvalId}:${x.decision}`), ...s.safetyBoundaries.map(x => `s:${x}`)];
function parseDescriptor(row: Feedback): { messageId: string; text: string } | null {
  try {
    const x = JSON.parse(row.contextJson) as { reason?: unknown; context?: unknown; source?: { messageId?: unknown } };
    const rowId = row.messageId;
    const sourceId = x.source?.messageId;
    if (rowId !== undefined && rowId !== null && typeof rowId !== "string") return null;
    if (sourceId !== undefined && sourceId !== null && typeof sourceId !== "string") return null;
    if (typeof rowId === "string" && typeof sourceId === "string" && rowId !== sourceId) return null;
    const messageId = typeof rowId === "string" ? rowId : typeof sourceId === "string" ? sourceId : null;
    const text = typeof x.reason === "string" ? x.reason : typeof x.context === "string" ? x.context : null;
    return messageId && text && text.trim().length <= 4_000 ? { messageId, text: text.trim() } : null;
  } catch { return null; }
}
async function readMessages(db: CompressionDb, conversationId: string, pageSize: number): Promise<Message[]> { const result: Message[] = []; let cursor: string | undefined; for (;;) { const page = await db.aiMessage.findMany({ where: { conversationId, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: pageSize, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }); if (page.some(m => m.conversationId !== conversationId || (m.role !== "user" && m.role !== "assistant"))) throw new Error("invalid_message_page"); result.push(...page); if (page.length < pageSize) return result; const next = page[page.length - 1]; if (!next || next.id === cursor) throw new Error("message_pagination_unavailable"); cursor = next.id; } }
type DerivedProtectedState = Pick<ConversationSummary, "userCorrections" | "decisions" | "unresolvedActions" | "approvals" | "safetyBoundaries">;
async function protectedFromRecords(db: CompressionDb, conversationId: string, eligibleIds: Set<string>): Promise<DerivedProtectedState> { if (!db.aiFeedback || !db.aiWorkflow || !db.aiApproval) throw new Error("protected_state_unavailable"); const [feedback, workflows] = await Promise.all([db.aiFeedback.findMany({ where: { conversationId }, select: { id: true, outcome: true, contextJson: true, conversationId: true, messageId: true }, take: 201 }), db.aiWorkflow.findMany({ where: { conversationId }, select: { id: true, goal: true, status: true, conversationId: true }, take: 101 })]); if (feedback.length > 200 || workflows.length > 100) throw new Error("protected_state_unavailable"); const linked = workflows.filter(w => w.conversationId === conversationId); if (workflows.some(w => typeof w.id !== "string" || typeof w.goal !== "string" || w.goal.trim().length > 4_000)) throw new Error("protected_state_unavailable"); const approvals = await db.aiApproval.findMany({ where: { workflowId: { in: linked.map(w => w.id) } }, select: { id: true, workflowId: true, status: true, decisionType: true, decisionReason: true }, take: 201 }); if (approvals.length > 200 || feedback.some(x => x.conversationId !== conversationId || typeof x.contextJson !== "string") || approvals.some(a => typeof a.id !== "string" || typeof a.workflowId !== "string" || typeof a.status !== "string")) throw new Error("protected_state_unavailable"); const relevantFeedback = feedback.filter(x => x.conversationId === conversationId && ["CORRECTED", "ACCEPTED", "EDITED", "REJECTED"].includes(x.outcome)); const descriptors = relevantFeedback.map(parseDescriptor); if (descriptors.some(x => !x || !eligibleIds.has(x.messageId))) throw new Error("protected_state_unavailable"); const parseContext = (row: Feedback) => { try { return JSON.parse(row.contextJson) as { safetyBoundary?: unknown }; } catch { return {}; } }; const corrections = relevantFeedback.filter(x => x.outcome === "CORRECTED").map(parseDescriptor) as Array<{ messageId: string; text: string }>; const decisions = relevantFeedback.filter(x => ["ACCEPTED", "EDITED", "REJECTED"].includes(x.outcome) && typeof parseContext(x).safetyBoundary !== "string").map(parseDescriptor) as Array<{ messageId: string; text: string }>; const safetyBoundaries = relevantFeedback.map(x => parseContext(x).safetyBoundary).filter((x): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= 1_000); return { userCorrections: corrections, decisions, unresolvedActions: linked.filter(w => !["COMPLETED", "FAILED", "CANCELED"].includes(w.status)).map(w => ({ workflowId: w.id, text: w.goal.trim() })), approvals: approvals.filter(a => linked.some(w => w.id === a.workflowId)).map(a => ({ approvalId: a.id, decision: [a.status, a.decisionType, a.decisionReason].filter((x): x is string => !!x && x.length <= 4_000).join(": ") })), safetyBoundaries }; }
function mergeProtected(persisted: DerivedProtectedState, supplemental: CompressionOptions["protectedState"]): DerivedProtectedState { const candidate = conversationSummarySchema.parse({ factualSummary: "", ...persisted, ...(supplemental ?? {}), sourceMessageIds: [] }); const dedupe = <T>(values: T[], identity: (x: T) => string) => Array.from(new Map(values.map(x => [identity(x), x])).values()); return { userCorrections: dedupe([...persisted.userCorrections, ...candidate.userCorrections], x => `u:${x.messageId}:${x.text}`), decisions: dedupe([...persisted.decisions, ...candidate.decisions], x => `d:${x.messageId}:${x.text}`), unresolvedActions: dedupe([...persisted.unresolvedActions, ...candidate.unresolvedActions], x => `w:${x.workflowId ?? "null"}:${x.text}`), approvals: dedupe([...persisted.approvals, ...candidate.approvals], x => `a:${x.approvalId}:${x.decision}`), safetyBoundaries: dedupe([...persisted.safetyBoundaries, ...candidate.safetyBoundaries], x => x) }; }
const compressionLocks = new Set<string>();
export async function compressConversation(conversationId: string, actor: SabahActor, db: CompressionDb = prisma as unknown as CompressionDb, options: CompressionOptions = {}) {
  if (options.background) return enqueueCompression(conversationId, actor, options.background.idempotencyKey, options.background);
  options.signal?.throwIfAborted();
  const conversation = await db.aiConversation.findUnique({ where: { id: conversationId }, select: { userId: true } }); if (!conversation) return failure(conversationId, "conversation_not_found"); if (conversation.userId !== actor.id && actor.role !== "ADMIN") return failure(conversationId, "forbidden");
  const correlationId = `compression-${randomUUID()}`;
  const onDiagnostic = (event: GLMDiagnosticEvent) => recordDiagnostic({
    correlationId, actorId: actor.id, conversationId,
    category: `PROVIDER_${event.event.toUpperCase()}`,
    level: event.event === "error" ? "ERROR" : event.event === "fallback" ? "WARN" : "INFO",
    message: `Compression provider ${event.event}`,
    metadata: { ...event, role: "COMPRESSION" },
  });
  if (compressionLocks.has(conversationId)) return failure(conversationId, "compression_in_progress"); compressionLocks.add(conversationId);
  try { const messages = await readMessages(db, conversationId, Math.min(Math.max(options.maxMessages ?? 500, 21), 500)); if (messages.length <= 20) return { status: "uncompressed" as const, conversationId, reason: "below_threshold" }; const tail = messages.slice(-20); const eligible = messages.slice(0, -20); if (eligible.length > 500) return failure(conversationId, "source_prefix_too_large"); const persisted = await protectedFromRecords(db, conversationId, new Set(eligible.map(m => m.id))); const protectedState = mergeProtected(persisted, options.protectedState); const payload = JSON.stringify({ instruction: "Return only valid JSON matching the conversation summary schema. Bounded aid, not authoritative.", messages: eligible.map(m => ({ id: m.id, role: m.role, content: m.content ?? "" })), protectedState }); if (payload.length > 48_000) return failure(conversationId, "provider_context_too_large"); const provider = options.provider ?? (async (prompt: string) => { let credentials = {}; try { credentials = await resolveRuntimeProviderCredentials(db as unknown as Parameters<typeof resolveRuntimeProviderCredentials>[0]); } catch { /* environment credentials remain available */ } if (options.modelResolver) { const model = await options.modelResolver(db); if (!isCompressionTargetSupported("zai", model)) throw new Error("invalid_compression_model"); return callGLMText(prompt, { model: model as GLMModel, provider: "zai", credentials, temperature: 0.1, max_tokens: 4_000, signal: options.signal, onDiagnostic }); } const assignment = await resolveModelForRole("COMPRESSION", db as unknown as Parameters<typeof resolveModelForRole>[1]); if (!isCompressionTargetSupported(assignment.providerKey, assignment.modelName)) throw new Error("invalid_compression_target"); return callGLMText(prompt, { model: assignment.modelName, provider: assignment.providerKey, fallbacks: getConfiguredFallbacks("COMPRESSION", JSON.stringify(assignment.config)), credentials, temperature: 0.1, max_tokens: 4_000, signal: options.signal, onDiagnostic }); }); options.signal?.throwIfAborted(); const raw = await provider(payload); options.signal?.throwIfAborted(); let parsed: ConversationSummary; try { parsed = conversationSummarySchema.parse(JSON.parse(raw)); } catch { await logFailure(options, conversationId, actor, "invalid_provider_summary"); return failure(conversationId, "invalid_provider_summary"); } const sourceSet = new Set(parsed.sourceMessageIds); if (sourceSet.size !== parsed.sourceMessageIds.length || parsed.sourceMessageIds.length !== eligible.length || parsed.sourceMessageIds.some((id, index) => id !== eligible[index].id) || parsed.sourceMessageIds.some(id => !eligible.some(m => m.id === id))) { await logFailure(options, conversationId, actor, "invalid_source_ids"); return failure(conversationId, "invalid_source_ids"); } const expectedProtectedKeys = key({ factualSummary: "", ...protectedState, sourceMessageIds: [] }); const actualProtectedKeys = key(parsed); if (expectedProtectedKeys.some(k => !actualProtectedKeys.includes(k))) { await logFailure(options, conversationId, actor, "protected_item_omitted"); return failure(conversationId, "protected_item_omitted"); } if (actualProtectedKeys.length !== expectedProtectedKeys.length || actualProtectedKeys.some((k, index) => k !== expectedProtectedKeys[index])) { await logFailure(options, conversationId, actor, "protected_item_altered"); return failure(conversationId, "protected_item_altered"); } options.signal?.throwIfAborted(); const result = await db.$transaction(async tx => { const latest = await readMessages(tx, conversationId, 500); if (latest.at(-1)?.id !== messages.at(-1)?.id) throw new Error("concurrent_new_turn"); const prior = await tx.aiConversationSummary.findFirst({ where: { conversationId, supersededById: null }, orderBy: { version: "desc" } }); const row = await tx.aiConversationSummary.create({ data: { conversationId, version: (prior?.version ?? 0) + 1, startMessageId: eligible[0].id, endMessageId: eligible.at(-1)!.id, protectedStateJson: JSON.stringify({ factualSummary: parsed.factualSummary, ...protectedState, sourceMessageIds: parsed.sourceMessageIds }), sourceMessageIdsJson: JSON.stringify(parsed.sourceMessageIds) } }); if (prior) await tx.aiConversationSummary.update({ where: { id: prior.id }, data: { supersededById: row.id } }); return row; }); return { status: "compressed" as const, conversationId, version: result.version, summaryId: result.id, boundaryMessageId: eligible.at(-1)!.id, endMessageId: eligible.at(-1)!.id }; } catch (error) { if (options.signal?.aborted) throw error; const reason = error instanceof Error ? error.message : "compression_failed"; await logFailure(options, conversationId, actor, reason); return failure(conversationId, reason); } finally { compressionLocks.delete(conversationId); }
}
