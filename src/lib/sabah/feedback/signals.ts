import type { FeedbackEvent, FeedbackScope, PreferenceSignal } from "./contracts";

const positiveOutcomes = new Set(["ACCEPTED", "EDITED", "CORRECTED"]);
const negativeOutcomes = new Set(["REJECTED", "IGNORED", "UNDONE"]);

export function signalKey(event: FeedbackEvent): string {
  const proposal = event.proposedDiffHash ?? "none";
  const finalHash = event.finalDiffHash ?? "none";
  const action = event.context.action ?? event.outcome;
  return `${event.source.kind}:${event.source.id}:${event.source.capability ?? ""}:${event.source.fieldName ?? ""}:${proposal}:${finalHash}:${action}`;
}

export function summarizeSignals(events: FeedbackEvent[], scope: FeedbackScope, scopeId: string): PreferenceSignal[] {
  const groups = new Map<string, FeedbackEvent[]>();
  for (const event of events.filter((candidate) => candidate.scope === scope && candidate.scopeId === scopeId)) {
    const key = signalKey(event);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return Array.from(groups.entries()).map(([key, rows]) => {
    const positiveCount = rows.filter((row) => positiveOutcomes.has(row.outcome)).length;
    const rejectionCount = rows.filter((row) => negativeOutcomes.has(row.outcome)).length;
    const lastOccurredAt = rows.reduce((latest, row) => row.occurredAt > latest ? row.occurredAt : latest, rows[0].occurredAt);
    const confidence = Math.max(0, Math.min(1, (positiveCount - rejectionCount * 0.25) / (scope === "PERSONAL" ? 3 : 5)));
    return { key, scope, scopeId, count: rows.length, positiveCount, rejectionCount, userCount: new Set(rows.map((row) => row.actorId)).size, lastOccurredAt, confidence };
  }).sort((left, right) => right.confidence - left.confidence || right.positiveCount - left.positiveCount).slice(0, 100);
}
