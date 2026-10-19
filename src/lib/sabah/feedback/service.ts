import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import type { AiFeedback } from "@prisma/client";
import { summarizeSignals } from "./signals";
import { FeedbackAuthorizationError, FeedbackValidationError, feedbackOutcomes, type FeedbackActor, type FeedbackAuthorization, type FeedbackEvent, type FeedbackInput, type FeedbackScope, type FeedbackSource, type LearningProposal, type PreferenceSignal } from "./contracts";
export type { FeedbackEvent } from "./contracts";

export type FeedbackRepository = {
  insertIfAbsent?: (event: FeedbackEvent) => Promise<FeedbackEvent>;
  insert?: (event: FeedbackEvent) => Promise<FeedbackEvent>;
  findByFingerprint?: (fingerprint: string) => Promise<FeedbackEvent | null>;
  list?: () => Promise<FeedbackEvent[]>;
  rows: FeedbackEvent[];
};

const MAX_TEXT = 120;
const hashPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[A-Za-z0-9:_./-]{1,160}$/;
const secretLike = /(password|passwd|secret|token|api[_ -]?key|bearer|private[_ -]?key|authorization)/i;
const piiLike = /(?:[\w.+-]+@[\w-]+\.[\w.-]+|\+?\d[\d ()-]{8,}\d)/;
const scopes = new Set<FeedbackScope>(["PERSONAL", "TEAM", "DEPARTMENT"]);
const kinds = new Set(["WORKFLOW", "FIELD", "CAPABILITY", "REPORT"]);
const inputKeys = new Set(["source", "outcome", "context", "proposedDiffHash", "finalDiffHash", "reason", "privateBody", "scope", "scopeId", "occurredAt"]);
const sourceKeys = new Set(["kind", "id", "workflowId", "approvalId", "conversationId", "messageId", "sourceId", "fieldName", "capability", "reportId"]);
const contextKeys = new Set(["workflow", "field", "capability", "report", "proposal", "action"]);

export function validatePersistedFeedbackIdentity(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && idPattern.test(row.id) && typeof row.actorId === "string" && idPattern.test(row.actorId) && typeof row.fingerprint === "string" && hashPattern.test(row.fingerprint);
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new FeedbackValidationError(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > MAX_TEXT || secretLike.test(value) || piiLike.test(value)) throw new FeedbackValidationError(`${label} must be a bounded declarative descriptor`);
  return value;
}
function descriptor(value: unknown, label: string): string {
  const result = text(value, label);
  if (!idPattern.test(result)) throw new FeedbackValidationError(`${label} has invalid format`);
  return result;
}
function validateInput(input: FeedbackInput): FeedbackInput {
  const raw = plainObject(input, "feedback input");
  for (const key of Object.keys(raw)) if (!inputKeys.has(key)) throw new FeedbackValidationError(`Unknown feedback input key: ${key}`);
  const rawSource = plainObject(raw.source, "feedback source");
  for (const key of Object.keys(rawSource)) if (!sourceKeys.has(key)) throw new FeedbackValidationError(`Unknown feedback source key: ${key}`);
  if (typeof rawSource.kind !== "string" || !kinds.has(rawSource.kind)) throw new FeedbackValidationError("Invalid feedback source kind");
  const source: FeedbackSource = { kind: rawSource.kind as FeedbackSource["kind"], id: descriptor(rawSource.id, "source id") };
  sourceKeys.forEach((key) => { if (key !== "kind" && key !== "id" && rawSource[key] !== undefined) (source as Record<string, unknown>)[key] = descriptor(rawSource[key], `source ${key}`); });
  const outcome = raw.outcome;
  if (!feedbackOutcomes.includes(outcome as FeedbackInput["outcome"])) throw new FeedbackValidationError("Invalid feedback outcome");
  if (raw.scope !== undefined && !scopes.has(raw.scope as FeedbackScope)) throw new FeedbackValidationError("Invalid feedback scope");
  if (raw.scopeId !== undefined) descriptor(raw.scopeId, "scope id");
  if (raw.reason !== undefined) text(raw.reason, "reason", true);
  if (raw.privateBody !== undefined) throw new FeedbackValidationError("Raw private body is not accepted");
  if (raw.proposedDiffHash !== undefined && (typeof raw.proposedDiffHash !== "string" || !hashPattern.test(raw.proposedDiffHash))) throw new FeedbackValidationError("Invalid proposed diff hash");
  if (raw.finalDiffHash !== undefined && (typeof raw.finalDiffHash !== "string" || !hashPattern.test(raw.finalDiffHash))) throw new FeedbackValidationError("Invalid final diff hash");
  if (outcome === "EDITED" || outcome === "CORRECTED") {
    if (!raw.proposedDiffHash || !raw.finalDiffHash || raw.proposedDiffHash === raw.finalDiffHash) throw new FeedbackValidationError("Edited feedback requires distinct proposed and final hashes");
  }
  if (raw.occurredAt !== undefined && (!(raw.occurredAt instanceof Date) || Number.isNaN(raw.occurredAt.getTime()))) throw new FeedbackValidationError("Invalid occurredAt");
  const context: Record<string, string> = {};
  if (raw.context !== undefined) {
    const rawContext = plainObject(raw.context, "feedback context");
    for (const [key, value] of Object.entries(rawContext)) {
      if (!contextKeys.has(key)) throw new FeedbackValidationError("Unknown feedback context key");
      if (value !== undefined) context[key] = descriptor(value, `context ${key}`);
    }
  }
  return { source, outcome: outcome as FeedbackInput["outcome"], context, reason: raw.reason as string | undefined, scope: raw.scope as FeedbackScope | undefined, scopeId: raw.scopeId as string | undefined, proposedDiffHash: raw.proposedDiffHash as string | undefined, finalDiffHash: raw.finalDiffHash as string | undefined, occurredAt: (raw.occurredAt as Date | undefined) ?? new Date() };
}

export function createFeedbackRepository(): FeedbackRepository {
  const rows: FeedbackEvent[] = [];
  const fingerprints = new Set<string>();
  return {
    rows,
    async insertIfAbsent(event) { if (fingerprints.has(event.fingerprint)) return rows.find((row) => row.fingerprint === event.fingerprint)!; fingerprints.add(event.fingerprint); rows.push(event); return event; },
    async list() { return [...rows]; },
  };
}

export function createPrismaFeedbackRepository(): FeedbackRepository {
  const persistedEvent = (row: AiFeedback): FeedbackEvent | null => {
    if (typeof row.id !== "string" || typeof row.actorId !== "string" || !idPattern.test(row.id) || !idPattern.test(row.actorId) || !(row.createdAt instanceof Date) || Number.isNaN(row.createdAt.getTime()) || typeof row.contextJson !== "string") return null;
    try {
      const parsed: unknown = JSON.parse(row.contextJson);
      if (!parsed || typeof parsed !== "object") return null;
      const stored = parsed as { fingerprint?: unknown; source?: unknown; scope?: unknown; scopeId?: unknown; context?: unknown; reason?: unknown };
      const fingerprint = typeof stored.fingerprint === "string" ? stored.fingerprint : null;
      if (!fingerprint || !validatePersistedFeedbackIdentity({ id: row.id, actorId: row.actorId, fingerprint }) || !stored.source || typeof stored.scope !== "string" || typeof stored.scopeId !== "string" || !stored.context) return null;
      const scopeId = stored.scopeId;
      const validated = validateInput({ source: stored.source as FeedbackEvent["source"], outcome: row.outcome as FeedbackInput["outcome"], context: stored.context as FeedbackInput["context"], proposedDiffHash: row.proposedDiffHash ?? undefined, finalDiffHash: row.finalDiffHash ?? undefined, reason: stored.reason as string | undefined, scope: stored.scope as FeedbackScope, scopeId, occurredAt: row.createdAt });
      return {
        id: row.id,
        actorId: row.actorId,
        source: validated.source,
        outcome: validated.outcome,
        context: validated.context!,
        proposedDiffHash: row.proposedDiffHash ?? undefined,
        finalDiffHash: row.finalDiffHash ?? undefined,
        reason: typeof stored.reason === "string" ? stored.reason : undefined,
        scope: validated.scope!,
        scopeId: validated.scopeId!,
        occurredAt: row.createdAt,
        fingerprint,
      };
    } catch { return null; }
  };
  return {
    rows: [],
    // The schema has no fingerprint column or uniqueness constraint. The bounded
    // lookup prevents duplicate writes in normal cases, but cannot guarantee
    // serializable deduplication across concurrent adapters.
    async insertIfAbsent(event) {
      const candidates = await prisma.aiFeedback.findMany({ where: { contextJson: { contains: event.fingerprint } }, take: 25 });
      const existing = candidates.map(persistedEvent).find((candidate) => candidate?.fingerprint === event.fingerprint);
      if (existing) return existing;
      await prisma.aiFeedback.create({ data: { id: event.id, outcome: event.outcome, contextJson: JSON.stringify({ fingerprint: event.fingerprint, scope: event.scope, scopeId: event.scopeId, context: event.context, reason: event.reason, source: event.source }), proposedDiffHash: event.proposedDiffHash, finalDiffHash: event.finalDiffHash, workflowId: event.source.workflowId, approvalId: event.source.approvalId, conversationId: event.source.conversationId, messageId: event.source.messageId, sourceId: event.source.sourceId, actorId: event.actorId } });
      return event;
    },
    async list() {
      const rows = await prisma.aiFeedback.findMany({ orderBy: { createdAt: "asc" }, take: 500 });
      return rows.map(persistedEvent).filter((event: FeedbackEvent | null): event is FeedbackEvent => event !== null);
    },
  };
}

export function createFeedbackService(repository: FeedbackRepository, authorization: FeedbackAuthorization) {
  const recordFeedback = async (raw: FeedbackInput, actor: FeedbackActor): Promise<FeedbackEvent> => {
    const input = validateInput(raw);
    if (!actor || typeof actor.id !== "string" || !actor.id || !scopes.has(actor.scope) || !idPattern.test(actor.scopeId)) throw new FeedbackValidationError("Invalid actor");
    const scope = input.scope ?? actor.scope; const scopeId = input.scopeId ?? actor.scopeId;
    if (!(await authorization.authorizeSource(input.source, actor)) || !(await authorization.authorizeScope(scope, scopeId, actor))) throw new FeedbackAuthorizationError();
    const event: FeedbackEvent = { ...input, id: crypto.randomUUID(), actorId: actor.id, scope, scopeId, context: input.context ?? {}, occurredAt: input.occurredAt!, fingerprint: crypto.createHash("sha256").update(JSON.stringify({ actorId: actor.id, scope, scopeId, source: input.source, outcome: input.outcome, context: input.context, proposedDiffHash: input.proposedDiffHash, finalDiffHash: input.finalDiffHash, reason: input.reason })).digest("hex") };
    return repository.insertIfAbsent ? repository.insertIfAbsent(event) : repository.findByFingerprint && repository.insert ? (await repository.findByFingerprint(event.fingerprint)) ?? repository.insert(event) : repository.insert ? repository.insert(event) : Promise.reject(new FeedbackValidationError("Feedback repository cannot persist events"));
  };
  const authorizedRows = async (scope: FeedbackScope, scopeId: string, actor: FeedbackActor) => { if (!(await authorization.authorizeScope(scope, scopeId, actor))) throw new FeedbackAuthorizationError(); return (await (repository.list ? repository.list() : Promise.resolve(repository.rows ?? []))).filter((row) => row.scope === scope && row.scopeId === scopeId); };
  const getPreferenceSignals = async (target: { scope: FeedbackScope; scopeId: string }, actor: FeedbackActor): Promise<PreferenceSignal[]> => summarizeSignals(await authorizedRows(target.scope, target.scopeId, actor), target.scope, target.scopeId);
  const proposeLearningFromSignals = async (target: { scope: FeedbackScope; scopeId: string }, actor: FeedbackActor): Promise<LearningProposal[]> => (await getPreferenceSignals(target, actor)).filter((signal) => signal.rejectionCount === 0 && signal.positiveCount >= (target.scope === "PERSONAL" ? 3 : 5) && (target.scope === "PERSONAL" || signal.userCount >= 2)).map((signal) => ({ type: target.scope === "PERSONAL" ? "MEMORY" : "PLAYBOOK", key: signal.key, scope: target.scope, scopeId: target.scopeId, confidence: signal.confidence, state: "PROPOSED", negativePolicy: false }));
  return { recordFeedback, getPreferenceSignals, proposeLearningFromSignals };
}
export const recordFeedback = (service: ReturnType<typeof createFeedbackService>) => service.recordFeedback;
export const getPreferenceSignals = (service: ReturnType<typeof createFeedbackService>) => service.getPreferenceSignals;
export const proposeLearningFromSignals = (service: ReturnType<typeof createFeedbackService>) => service.proposeLearningFromSignals;
