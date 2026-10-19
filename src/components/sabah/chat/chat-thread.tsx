"use client";

import React, { useEffect, useRef } from "react";
import { SabahAvatar } from "../sabah-avatar";
import { SabahMessageBubble, type SabahThreadMessage } from "./message-bubble";
import { SabahThinkingIndicator } from "./thinking-indicator";
import { SabahStreamNotices, SabahToolActivity } from "./tool-activity";
import { ConversationSearch, safeConversationSegment } from "./conversation-search";
import type { LiveStreamNotice, LiveToolActivity } from "../state/sabah-reducer";
import type { WorkflowSnapshot } from "@/lib/sabah/workflows/schemas";
import { SabahActionCard } from "./action-card";
import type { InlineApprovalDecision } from "./inline-approval";

export function isSafeRelativeHref(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\u0000-\u001f\u007f]/.test(value) && !/^[\/]*(?:[a-z][a-z\d+.-]*:)/i.test(value);
}

const WELCOME_SUGGESTIONS = [
  "Review my priorities for today",
  "Review blockers in my work",
  "Draft my weekly update",
];

function WelcomeState({ onSuggestion }: { onSuggestion?: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <SabahAvatar size="lg" />
      <div className="space-y-0.5">
        <h3 className="text-base font-semibold text-foreground">
          Sabah <span className="font-normal text-muted-foreground">· صباح</span>
        </h3>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Employee Copilot</p>
      </div>
      <p className="max-w-[32ch] text-sm leading-relaxed text-muted-foreground">
        Say hello to Sabah — your workspace copilot. She can check your work, draft updates, and prepare changes for your approval.
      </p>
      {onSuggestion && (
        <ul className="flex flex-wrap items-center justify-center gap-2" aria-label="Suggested prompts">
          {WELCOME_SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground hover:border-primary/40 hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-safe:transition-colors motion-safe:duration-150"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type ChatThreadProps = {
  messages?: SabahThreadMessage[];
  pending?: boolean;
  /** Conversation-scoped internal hrefs verified by successful tool results;
   *  ungrounded internal links render as plain text, never navigation. */
  verifiedHrefs?: ReadonlySet<string>;
  onSuggestion?: (text: string) => void;
  showHistorySearch?: boolean;
  compactedHistoryHref?: string;
  onJump?: (conversationId: string, messageId: string) => void | Promise<void>;
  focusedMessageId?: string | null;
  historyError?: string | null;
  liveToolActivity?: LiveToolActivity[];
  streamNotices?: LiveStreamNotice[];
  /** A workflow proposal is rendered in the assistant turn that raised it. */
  workflow?: WorkflowSnapshot | null;
  workflowMessageId?: string | null;
  workflows?: WorkflowSnapshot[];
  workflowMessageIds?: Record<string, string | null>;
  selectedWorkflowId?: string | null;
  onWorkflowDecision?: (approvalId: string, decision: InlineApprovalDecision) => void | Promise<void>;
  onWorkflowDecisionForWorkflow?: (workflowId: string, approvalId: string, decision: InlineApprovalDecision) => void | Promise<void>;
  onWorkflowSelect?: (workflowId: string) => void | Promise<void>;
  workflowRetryId?: string | null;
  onWorkflowRetry?: (workflowId: string) => void | Promise<void>;
  workflowActionBusy?: boolean;
};

export function ChatThread({ messages = [], pending = false, verifiedHrefs, onSuggestion, showHistorySearch = false, compactedHistoryHref, onJump, focusedMessageId, historyError, liveToolActivity = [], streamNotices = [], workflow = null, workflowMessageId = null, workflows, workflowMessageIds = {}, selectedWorkflowId = workflow?.id ?? null, onWorkflowDecision, onWorkflowDecisionForWorkflow, onWorkflowSelect, workflowRetryId = null, onWorkflowRetry, workflowActionBusy = false }: ChatThreadProps) {
  const focusedRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusedMessageId) focusedRef.current?.focus(); }, [focusedMessageId]);

  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const lastAssistantContent = lastAssistant?.content ?? "";
  const lastAssistantStatus = lastAssistant?.streamingStatus ?? "";
  const currentAssistantId = lastAssistantStatus === "STREAMING" ? lastAssistant?.id : null;
  const toolActivityKey = liveToolActivity.map((item) => `${item.assistantMessageId}:${item.id}:${item.name}:${item.status}`).join("|");
  const streamNoticeKey = streamNotices.map((notice) => `${notice.assistantMessageId}:${notice.id}:${notice.kind}`).join("|");
  const streamVisible = currentAssistantId !== null && (liveToolActivity.some((item) => item.assistantMessageId === currentAssistantId) || streamNotices.some((notice) => notice.assistantMessageId === currentAssistantId) || lastAssistantContent.length > 0);
  const retainedWorkflows = (() => {
    const byId = new Map<string, WorkflowSnapshot>();
    for (const snapshot of workflows ?? []) byId.set(snapshot.id, snapshot);
    if (workflow) byId.set(workflow.id, workflow);
    return Array.from(byId.values());
  })();
  const singleWorkflowFallbackMessageId = workflows === undefined && workflow
    ? workflowMessageId ?? lastAssistant?.id ?? null
    : null;
  const messageIdForWorkflow = (snapshot: WorkflowSnapshot): string | null => {
    if (workflowMessageIds[snapshot.id] !== undefined) return workflowMessageIds[snapshot.id] ?? null;
    if (workflows === undefined && snapshot.id === workflow?.id) return singleWorkflowFallbackMessageId;
    return null;
  };
  const workflowsByMessageId = new Map<string, WorkflowSnapshot[]>();
  const unattachedWorkflows: WorkflowSnapshot[] = [];
  for (const snapshot of retainedWorkflows) {
    const messageId = messageIdForWorkflow(snapshot);
    if (messageId && messages.some((message) => message.role === "assistant" && message.id === messageId)) {
      const existing = workflowsByMessageId.get(messageId) ?? [];
      existing.push(snapshot);
      workflowsByMessageId.set(messageId, existing);
    } else {
      unattachedWorkflows.push(snapshot);
    }
  }
  const renderWorkflowCard = (snapshot: WorkflowSnapshot) => {
    const snapshotMessageId = messageIdForWorkflow(snapshot);
    const selected = selectedWorkflowId === snapshot.id;
    const decide = onWorkflowDecisionForWorkflow
      ? (approvalId: string, decision: InlineApprovalDecision) => onWorkflowDecisionForWorkflow(snapshot.id, approvalId, decision)
      : onWorkflowDecision ?? (() => undefined);
    return (
      <div key={snapshot.id} data-testid={`sabah-workflow-card-${snapshot.id}`}>
        {onWorkflowSelect && !selected && (
          <button
            type="button"
            onClick={() => void onWorkflowSelect(snapshot.id)}
            className="mb-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            Resume action
          </button>
        )}
        <SabahActionCard
          workflow={snapshot}
          workflowMessageId={snapshotMessageId}
          onDecide={decide}
          onRetry={onWorkflowRetry && workflowRetryId === snapshot.id ? () => onWorkflowRetry(snapshot.id) : undefined}
          actionBusy={workflowActionBusy}
        />
      </div>
    );
  };

  // Keep the newest message (or the thinking indicator) in view. Jumped-to
  // history messages win: skip auto-scroll while a focused message is set.
  useEffect(() => {
    if (focusedMessageId) return;
    const node = scrollRef.current;
    if (!node) return;
    const reduce = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof node.scrollTo === "function") {
      node.scrollTo({ top: node.scrollHeight, behavior: reduce ? "auto" : "smooth" });
    } else {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages.length, pending, focusedMessageId, lastAssistantContent, lastAssistantStatus, toolActivityKey, streamNoticeKey]);

  return (
    <div ref={scrollRef} role="log" aria-label="Sabah conversation" aria-live="off" className="flex-1 space-y-3 overflow-y-auto p-3">
      {compactedHistoryHref && isSafeRelativeHref(compactedHistoryHref) && <a className="text-xs underline" href={compactedHistoryHref}>Compacted history available</a>}
      {showHistorySearch && !pending && <ConversationSearch onJump={onJump} />}
      {historyError && <p role="alert" className="text-xs text-destructive">{historyError}</p>}
      {messages.length === 0 && !pending && <WelcomeState onSuggestion={onSuggestion} />}
      {messages.map((message) => (
        <div
          key={message.id}
          id={`message-${safeConversationSegment(message.id) ? message.id : "unknown"}`}
          data-testid={`sabah-turn-${safeConversationSegment(message.id) ? message.id : "unknown"}`}
          ref={message.id === focusedMessageId ? focusedRef : undefined}
          tabIndex={message.id === focusedMessageId ? -1 : undefined}
          aria-label={message.id === focusedMessageId ? "Jumped-to message" : undefined}
        >
          <SabahMessageBubble message={message} verifiedHrefs={verifiedHrefs} />
          {message.role === "assistant" && (
            <>
              <SabahToolActivity items={liveToolActivity.filter((item) => item.assistantMessageId === message.id)} />
              <SabahStreamNotices notices={streamNotices.filter((notice) => notice.assistantMessageId === message.id)} />
              {(workflowsByMessageId.get(message.id) ?? []).map(renderWorkflowCard)}
            </>
          )}
        </div>
      ))}
      {unattachedWorkflows.length > 0 && (
        <div data-testid="sabah-recovered-action-turn">
          {unattachedWorkflows.map(renderWorkflowCard)}
        </div>
      )}
      {pending && !streamVisible && <SabahThinkingIndicator />}
    </div>
  );
}
