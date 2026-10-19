export const feedbackOutcomes = ["ACCEPTED", "EDITED", "REJECTED", "IGNORED", "UNDONE", "CORRECTED"] as const;
export type FeedbackOutcome = (typeof feedbackOutcomes)[number];
export type FeedbackScope = "PERSONAL" | "TEAM" | "DEPARTMENT";
export type FeedbackSourceKind = "WORKFLOW" | "FIELD" | "CAPABILITY" | "REPORT";

export type FeedbackActor = { id: string; scope: FeedbackScope; scopeId: string };
export type FeedbackSource = {
  kind: FeedbackSourceKind;
  id: string;
  workflowId?: string;
  approvalId?: string;
  conversationId?: string;
  messageId?: string;
  sourceId?: string;
  fieldName?: string;
  capability?: string;
  reportId?: string;
};
export type FeedbackContext = {
  workflow?: string;
  field?: string;
  capability?: string;
  report?: string;
  proposal?: string;
  action?: string;
  privateBody?: string;
};
export type FeedbackInput = {
  source: FeedbackSource;
  outcome: FeedbackOutcome;
  context?: FeedbackContext;
  proposedDiffHash?: string;
  finalDiffHash?: string;
  reason?: string;
  privateBody?: string;
  scope?: FeedbackScope;
  scopeId?: string;
  occurredAt?: Date;
};
export type FeedbackRecorder = (input: FeedbackInput) => Promise<void> | void;
export type FeedbackAuthorization = {
  authorizeSource: (source: FeedbackSource, actor: FeedbackActor) => Promise<boolean>;
  authorizeScope: (scope: FeedbackScope, scopeId: string, actor: FeedbackActor) => Promise<boolean>;
};
export type FeedbackEvent = FeedbackInput & {
  id: string;
  actorId: string;
  scope: FeedbackScope;
  scopeId: string;
  context: FeedbackContext;
  fingerprint: string;
  occurredAt: Date;
};
export type PreferenceSignal = {
  key: string;
  scope: FeedbackScope;
  scopeId: string;
  count: number;
  positiveCount: number;
  rejectionCount: number;
  userCount: number;
  lastOccurredAt: Date;
  confidence: number;
};
export type LearningProposal = {
  type: "MEMORY" | "PLAYBOOK";
  key: string;
  scope: FeedbackScope;
  scopeId: string;
  confidence: number;
  state: "PROPOSED";
  negativePolicy: false;
};

export class FeedbackValidationError extends Error {
  readonly code = "INVALID_FEEDBACK";
  constructor(message: string) { super(message); this.name = "FeedbackValidationError"; }
}
export class FeedbackAuthorizationError extends Error {
  readonly code = "FEEDBACK_FORBIDDEN";
  constructor(message = "Feedback source or scope is not authorized") { super(message); this.name = "FeedbackAuthorizationError"; }
}
