"use client";

import React, { useEffect, useState } from "react";

export const MAX_VISIBLE_SUGGESTIONS = 3;
/** One working day is deliberately represented as 24 hours for local snoozing. */
export const SUGGESTION_SNOOZE_MS = 24 * 60 * 60 * 1000;
const EXPIRY_NOTICE_WINDOW_MS = SUGGESTION_SNOOZE_MS;
const HOUR_MS = 60 * 60 * 1000;

export type SuggestionCategory =
    | "similar-work-on-draft"
    | "empty-recorded-queue-with-eligible-pool"
    | "high-confidence-overload-with-feasible-help"
    | "approaching-task-with-preparation-material"
    | "stale-progress-checkin";

/**
 * The display contract emitted by Sabah's evidence-backed suggestion ranking.
 * Dates may be Date instances or serialized ISO values at the client boundary.
 */
export type SuggestionCard = {
    id: string;
    category: SuggestionCategory;
    title: string;
    reason: string;
    confidence: number;
    destination: string;
    evidenceIds: string[];
    expiresAt?: Date | string;
};

export type SuggestionCardsProps = {
    cards: SuggestionCard[];
    /** Workspace identity fences local action state from a previous workspace. */
    workspaceId?: string;
    /** Existing Sabah conversation supplied by the copilot mount, when available. */
    conversationId?: string | null;
    /**
     * The copilot mount owns conversation creation/reuse. This component does
     * not call /api/ai/chat or invent a conversation id; a follow-up mount task
     * should pass the id returned by the existing Sabah client and include the
     * card evidence in that turn.
     */
    onAskSabah?: (card: SuggestionCard, conversationId: string | null) => void | Promise<void>;
    onSnooze?: (card: SuggestionCard) => void;
    onDismiss?: (card: SuggestionCard) => void;
    onReview?: (card: SuggestionCard) => void;
};

type LocalAction = "reviewed" | "asked";
type LocalState = {
    workspaceKey: string;
    hiddenIds: Set<string>;
    snoozedUntil: Map<string, number>;
    actions: Map<string, LocalAction>;
};

const DEFAULT_WORKSPACE_KEY = "__unscoped__";

function workspaceKey(workspaceId: string | undefined): string {
    return workspaceId ?? DEFAULT_WORKSPACE_KEY;
}

function freshLocalState(key: string): LocalState {
    return { workspaceKey: key, hiddenIds: new Set(), snoozedUntil: new Map(), actions: new Map() };
}

function expiryTimestamp(value: Date | string | undefined): number | null {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value !== "string") return null;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

function expiryNote(value: Date | string | undefined): string | null {
    const timestamp = expiryTimestamp(value);
    if (timestamp === null) return null;
    const remaining = timestamp - Date.now();
    if (remaining <= 0) return "Expired";
    if (remaining > EXPIRY_NOTICE_WINDOW_MS) return null;
    if (remaining < HOUR_MS) return "Expires within an hour";
    return `Expires in ${Math.ceil(remaining / HOUR_MS)} hours`;
}

function confidenceLabel(value: number): string {
    if (!Number.isFinite(value)) return "—";
    const percentage = value <= 1 ? value * 100 : value;
    return `${Math.round(Math.max(0, Math.min(100, percentage)))}%`;
}

function cardDomId(cardId: string, index: number): string {
    const safeId = cardId.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    return `sabah-suggestion-${safeId || "card"}-${index}`;
}

export function SuggestionCards({
    cards,
    workspaceId,
    conversationId = null,
    onAskSabah,
    onSnooze,
    onDismiss,
    onReview,
}: SuggestionCardsProps) {
    const currentWorkspaceKey = workspaceKey(workspaceId);
    const [localState, setLocalState] = useState<LocalState>(() => freshLocalState(currentWorkspaceKey));
    const [readyWorkspaceKey, setReadyWorkspaceKey] = useState(currentWorkspaceKey);

    // Do not let a render from the prior workspace leak while the new scope is
    // being committed. The effect resets action state and then releases cards.
    useEffect(() => {
        setLocalState((previous) => previous.workspaceKey === currentWorkspaceKey ? previous : freshLocalState(currentWorkspaceKey));
        setReadyWorkspaceKey(currentWorkspaceKey);
    }, [currentWorkspaceKey]);

    const scopedState = localState.workspaceKey === currentWorkspaceKey ? localState : freshLocalState(currentWorkspaceKey);
    const cappedCards = Array.isArray(cards) ? cards.slice(0, MAX_VISIBLE_SUGGESTIONS) : [];
    const visibleCards = readyWorkspaceKey === currentWorkspaceKey
        ? cappedCards.filter((card) => {
            if (scopedState.hiddenIds.has(card.id)) return false;
            const snoozedUntil = scopedState.snoozedUntil.get(card.id);
            return snoozedUntil === undefined || snoozedUntil <= Date.now();
        })
        : [];

    const updateLocalState = (update: (current: LocalState) => LocalState) => {
        setLocalState((previous) => update(previous.workspaceKey === currentWorkspaceKey ? previous : freshLocalState(currentWorkspaceKey)));
    };

    const markAction = (cardId: string, action: LocalAction) => {
        updateLocalState((current) => {
            const actions = new Map(current.actions);
            actions.set(cardId, action);
            return { ...current, actions };
        });
    };

    const handleAskSabah = (card: SuggestionCard) => {
        if (!onAskSabah) return;
        markAction(card.id, "asked");
        void onAskSabah(card, conversationId);
    };

    const handleSnooze = (card: SuggestionCard) => {
        updateLocalState((current) => {
            const hiddenIds = new Set(current.hiddenIds);
            hiddenIds.add(card.id);
            const snoozedUntil = new Map(current.snoozedUntil);
            snoozedUntil.set(card.id, Date.now() + SUGGESTION_SNOOZE_MS);
            return { ...current, hiddenIds, snoozedUntil };
        });
        onSnooze?.(card);
    };

    const handleDismiss = (card: SuggestionCard) => {
        updateLocalState((current) => {
            const hiddenIds = new Set(current.hiddenIds);
            hiddenIds.add(card.id);
            return { ...current, hiddenIds };
        });
        onDismiss?.(card);
    };

    const handleReview = (card: SuggestionCard) => {
        markAction(card.id, "reviewed");
        onReview?.(card);
    };

    if (visibleCards.length === 0) return null;

    return (
        <section aria-label="Sabah suggestions" data-testid="sabah-suggestion-cards" className="space-y-2">
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleCards.map((card, index) => {
                    const id = cardDomId(card.id, index);
                    const action = scopedState.actions.get(card.id);
                    const note = expiryNote(card.expiresAt);
                    return (
                        <li key={card.id}>
                            <article
                                aria-labelledby={`${id}-title`}
                                data-suggestion-id={card.id}
                                data-destination={card.destination}
                                className="flex h-full min-w-0 flex-col rounded-xl border border-border bg-card p-4 text-start shadow-sm"
                            >
                                <div className="flex min-w-0 items-start justify-between gap-3">
                                    <h3 id={`${id}-title`} className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                                        {card.title}
                                    </h3>
                                    <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground" aria-label={`Confidence ${confidenceLabel(card.confidence)}`}>
                                        {confidenceLabel(card.confidence)}
                                    </span>
                                </div>
                                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.reason}</p>
                                {card.evidenceIds.length > 0 && (
                                    <p className="mt-2 text-xs text-muted-foreground" data-testid={`${id}-evidence`}>
                                        Evidence: {card.evidenceIds.join(", ")}
                                    </p>
                                )}
                                {note && <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">{note}</p>}
                                {(action || note) && (
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground" aria-live="polite">
                                        {action === "reviewed" && <span data-testid={`${id}-reviewed`}>Reviewed</span>}
                                        {action === "asked" && <span data-testid={`${id}-asked`}>Asked Sabah</span>}
                                    </div>
                                )}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        className="min-h-11 min-w-11 flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                                        onClick={() => handleReview(card)}
                                        disabled={action === "reviewed"}
                                    >
                                        Review
                                    </button>
                                    <button
                                        type="button"
                                        className="min-h-11 min-w-11 flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                                        onClick={() => handleAskSabah(card)}
                                        disabled={!onAskSabah || action === "asked"}
                                        title={!onAskSabah ? "Sabah chat mount is not connected yet" : undefined}
                                    >
                                        Ask Sabah
                                    </button>
                                    <button
                                        type="button"
                                        className="min-h-11 min-w-11 flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                        onClick={() => handleSnooze(card)}
                                    >
                                        Snooze
                                    </button>
                                    <button
                                        type="button"
                                        className="min-h-11 min-w-11 flex-1 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                        onClick={() => handleDismiss(card)}
                                    >
                                        Dismiss
                                    </button>
                                </div>
                            </article>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

export default SuggestionCards;
