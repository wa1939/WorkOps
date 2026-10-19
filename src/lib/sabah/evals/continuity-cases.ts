import type { CompressionDb, ConversationSummary, SummaryRow } from "../continuity/compression";
import { compressConversation } from "../continuity/compression";
import type { SabahActor } from "../auth/actor";

type ProtectedState = Pick<ConversationSummary, "userCorrections" | "decisions" | "unresolvedActions" | "approvals" | "safetyBoundaries">;

export const protectedContinuityKinds = [
  "approved-persona-design-correction",
  "never-overwrite-filled-fields",
  "blocked-safety-boundary",
  "unresolved-workflow",
  "rejected-suggestion",
  "accepted-wording-preference",
  "source-links",
  "original-message-ids",
] as const;
export type ProtectedContinuityKind = typeof protectedContinuityKinds[number];

export type ContinuityCase = {
  readonly caseId: string;
  readonly kind: ProtectedContinuityKind;
  readonly messages: readonly MessageFixture[];
  readonly expectedProtected: ProtectedState;
  readonly providerProtected: ProtectedState;
  readonly records: PersistedFixtureRecords;
};
type MessageFixture = { readonly id: string; readonly conversationId: string; readonly role: "user" | "assistant"; readonly content: string; readonly createdAt: Date };
type PersistedFixtureRecords = {
  readonly feedback: readonly { id: string; outcome: string; contextJson: string; conversationId: string; messageId: string }[];
  readonly workflows: readonly { id: string; goal: string; status: string; conversationId: string }[];
  readonly approvals: readonly { id: string; status: string; decisionType: string; decisionReason: string; workflowId: string }[];
  readonly messagesWithOriginalIds: readonly OriginalMessageRecord[];
};
type OriginalMessageRecord = { readonly id: string; readonly conversationId: string; readonly originalMessageId: string };

export type ContinuityCaseMetric = {
  caseId: string;
  originalMessageCount: number;
  protectedFieldCount: number;
  preservedFieldCount: number;
  sourceIdCount: number;
  sourceIdsPreserved: boolean;
  workflowIdsPreserved: boolean;

};
export type ContinuityEvaluation = {
  totalCases: number;
  protectedFieldPreservationRate: number;
  sourceIdPreservationRate: number;
  unresolvedWorkflowPreservationRate: number;
  failingCaseIds: string[];
  metrics: ContinuityCaseMetric[];
};

const actor: SabahActor = { id: "continuity-eval-actor", role: "MEMBER", departmentIds: ["continuity-eval-dept"] };
const date = (index: number): Date => new Date(Date.UTC(2026, 7, 1, 0, index));
const emptyProtected = (): ProtectedState => ({ userCorrections: [], decisions: [], unresolvedActions: [], approvals: [], safetyBoundaries: [] });
const messages = (): readonly MessageFixture[] => Array.from({ length: 25 }, (_, index) => ({
  id: `continuity-message-${index + 1}`,
  conversationId: "continuity-conversation",
  role: index % 2 === 0 ? "user" : "assistant",
  content: `Synthetic continuity turn ${index + 1}`,
  createdAt: date(index),
}));
const sourceIds = (): string[] => messages().slice(0, 5).map((message) => message.id);
const withProtected = (partial: Partial<ProtectedState>): ProtectedState => ({ ...emptyProtected(), ...partial });
const correction = (text: string, messageId = sourceIds()[0]) => [{ messageId, text }];
const decision = (text: string, messageId = sourceIds()[1]) => [{ messageId, text }];
const unresolved = (workflowId: string) => [{ workflowId, text: "Synthetic workflow remains unresolved" }];
const approval = (approvalId: string) => [{ approvalId, decision: "APPROVED: synthetic: Synthetic approval decision" }];

function persistedRecords(kind: ProtectedContinuityKind, expected: ProtectedState): PersistedFixtureRecords {
  const ids = sourceIds();
  const workflowId = expected.unresolvedActions[0]?.workflowId ?? "synthetic-workflow-1";
  const feedback = expected.userCorrections.map((entry, index) => ({ id: `feedback-${kind}-${index}`, outcome: "CORRECTED", contextJson: JSON.stringify({ reason: entry.text, source: { messageId: entry.messageId } }), conversationId: "continuity-conversation", messageId: entry.messageId }));
  if (expected.safetyBoundaries.length) feedback.push({ id: `boundary-${kind}`, outcome: "REJECTED", contextJson: JSON.stringify({ reason: expected.safetyBoundaries[0], safetyBoundary: expected.safetyBoundaries[0], source: { messageId: ids[1] } }), conversationId: "continuity-conversation", messageId: ids[1] });
  feedback.push(...expected.decisions.map((entry, index) => ({ id: `decision-${kind}-${index}`, outcome: entry.text.includes("rejected") ? "REJECTED" : "ACCEPTED", contextJson: JSON.stringify({ reason: entry.text, source: { messageId: entry.messageId } }), conversationId: "continuity-conversation", messageId: entry.messageId })));
  const workflows = expected.unresolvedActions.length || expected.approvals.length ? [{ id: workflowId, goal: expected.unresolvedActions[0]?.text ?? "Synthetic approved proposal", status: expected.unresolvedActions.length ? "PLANNED" : "COMPLETED", conversationId: "continuity-conversation" }] : [];
  const approvals = expected.approvals.map((entry) => ({ id: entry.approvalId, status: "APPROVED", decisionType: "synthetic", decisionReason: entry.decision.replace("APPROVED: synthetic: ", ""), workflowId }));
  return { feedback, workflows, approvals, messagesWithOriginalIds: kind === "original-message-ids" ? ids.map((id) => ({ id: `persisted-message-${id}`, conversationId: "continuity-conversation", originalMessageId: id })) : [] };
}

export const continuityCases: readonly ContinuityCase[] = protectedContinuityKinds.map((kind) => {
  const expectedProtected = kind === "approved-persona-design-correction"
    ? withProtected({ userCorrections: correction("Use the approved persona design") })
    : kind === "never-overwrite-filled-fields"
    ? withProtected({ decisions: decision("Never overwrite a filled field") })
    : kind === "blocked-safety-boundary"
      ? withProtected({ safetyBoundaries: ["Do not disclose synthetic restricted details"] })
        : kind === "unresolved-workflow"
          ? withProtected({ unresolvedActions: unresolved("synthetic-workflow-1") })
          : kind === "rejected-suggestion"
            ? withProtected({ decisions: decision("Suggestion rejected by the user") })
            : kind === "accepted-wording-preference"
              ? withProtected({ decisions: decision("Prefer concise wording") })
              : kind === "source-links"
                ? withProtected({ decisions: decision("Retain the source link https://example.test/source") })
                : withProtected({ approvals: approval("synthetic-approval-1") });
  return { caseId: `continuity-${kind}`, kind, messages: messages(), expectedProtected, providerProtected: expectedProtected, records: persistedRecords(kind, expectedProtected) };
});

const protectedCount = (state: ProtectedState): number => Object.values(state).reduce((count, values) => count + values.length, 0);
const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const statePreserved = (expected: ProtectedState, actual: ProtectedState): number => {
  let preserved = 0;
  if (sameJson(expected.userCorrections, actual.userCorrections)) preserved += expected.userCorrections.length;
  if (sameJson(expected.decisions, actual.decisions)) preserved += expected.decisions.length;
  if (sameJson(expected.unresolvedActions, actual.unresolvedActions)) preserved += expected.unresolvedActions.length;
  if (sameJson(expected.approvals, actual.approvals)) preserved += expected.approvals.length;
  if (sameJson(expected.safetyBoundaries, actual.safetyBoundaries)) preserved += expected.safetyBoundaries.length;
  return preserved;
};

function declaredSourceIds(item: ContinuityCase): string[] {
  if (item.kind !== "original-message-ids") return sourceIds();
  const records = item.records.messagesWithOriginalIds;
  if (records.length !== 5 || records.some((record) => record.conversationId !== "continuity-conversation" || record.originalMessageId.length < 1 || record.originalMessageId.length > 200)) return [];
  const ids = records.map((record) => record.originalMessageId);
  if (new Set(ids).size !== ids.length || ids.some((id) => !item.messages.some((message) => message.id === id))) return [];
  return ids;
}

function fixtureDb(item: ContinuityCase, rows: SummaryRow[]): CompressionDb {
  const source = item.messages.slice(0, -20);
  const { feedback, workflows, approvals } = item.records;
  return {
    aiConversation: { findUnique: async () => ({ userId: actor.id }) },
    aiMessage: { findMany: async (args: unknown) => { const query = args as { cursor?: { id: string }; take?: number }; const start = query.cursor ? item.messages.findIndex((message) => message.id === query.cursor?.id) + 1 : 0; return item.messages.slice(start, start + (query.take ?? 500)); } },
    aiFeedback: { findMany: async () => [...feedback] },
    aiWorkflow: { findMany: async () => [...workflows] },
    aiApproval: { findMany: async () => [...approvals] },
    aiConversationSummary: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => { const row: SummaryRow = { id: `summary-${item.caseId}`, version: 1, startMessageId: source[0].id, endMessageId: source.at(-1)?.id ?? source[0].id, protectedStateJson: String(data.protectedStateJson), sourceMessageIdsJson: String(data.sourceMessageIdsJson) }; rows.push(row); return row; },
      update: async () => rows[0],
    },
    $transaction: async <T>(work: (transactionDb: CompressionDb) => Promise<T>): Promise<T> => work({ ...fixtureDbWithoutTransaction(item, rows), $transaction: async <U>(nested: (db: CompressionDb) => Promise<U>) => nested(fixtureDbWithoutTransaction(item, rows)) }),
  };
}
function fixtureDbWithoutTransaction(item: ContinuityCase, rows: SummaryRow[]): CompressionDb {
  const base = fixtureDb(item, rows);
  return { ...base, $transaction: async <T>(work: (db: CompressionDb) => Promise<T>) => work(base) };
}

export async function evaluateContinuity(cases: readonly ContinuityCase[]): Promise<ContinuityEvaluation> {
  const metrics: ContinuityCaseMetric[] = [];
  for (const item of cases) {
    const rows: SummaryRow[] = [];
    const result = await compressConversation("continuity-conversation", actor, fixtureDb(item, rows), { provider: async () => JSON.stringify({ factualSummary: "Synthetic bounded summary", ...item.providerProtected, sourceMessageIds: declaredSourceIds(item) }) });
    const row = rows[0];
    const actual = row ? JSON.parse(row.protectedStateJson) as ProtectedState : emptyProtected();
    const sourceMessageIds = row ? JSON.parse(row.sourceMessageIdsJson) as string[] : [];
    const expectedWorkflows = item.expectedProtected.unresolvedActions.map((entry) => entry.workflowId).filter((id): id is string => id !== null);
    const actualWorkflows = actual.unresolvedActions.map((entry) => entry.workflowId).filter((id): id is string => id !== null);
    const expectedSourceIds = declaredSourceIds(item);
    metrics.push({ caseId: item.caseId, originalMessageCount: item.messages.length, protectedFieldCount: protectedCount(item.expectedProtected), preservedFieldCount: result.status === "compressed" ? statePreserved(item.expectedProtected, actual) : 0, sourceIdCount: expectedSourceIds.length, sourceIdsPreserved: result.status === "compressed" && sameJson(sourceMessageIds, expectedSourceIds), workflowIdsPreserved: sameJson(actualWorkflows, expectedWorkflows) });
  }
  const totalFields = metrics.reduce((sum, metric) => sum + metric.protectedFieldCount, 0);
  const preservedFields = metrics.reduce((sum, metric) => sum + metric.preservedFieldCount, 0);
  const rate = (count: number, total: number): number => total === 0 ? 1 : count / total;
  return {
    totalCases: cases.length,
    protectedFieldPreservationRate: rate(preservedFields, totalFields),
    sourceIdPreservationRate: rate(metrics.filter((metric) => metric.sourceIdsPreserved).length, metrics.length),
    unresolvedWorkflowPreservationRate: rate(metrics.filter((metric) => metric.workflowIdsPreserved).length, metrics.filter((metric) => metric.protectedFieldCount > 0).length),
    failingCaseIds: metrics.filter((metric) => metric.preservedFieldCount !== metric.protectedFieldCount || !metric.sourceIdsPreserved || !metric.workflowIdsPreserved).map((metric) => metric.caseId),
    metrics,
  };
}
