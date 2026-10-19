"use client";

import React, { useEffect, useState } from "react";
import { SuggestionCards, type SuggestionCard } from "./suggestion-cards";

type SabahClientLike = {
    sendMessage: (conversationId: string | null, content: string, options?: { history?: unknown[] }) => Promise<{ conversationId: string | null; reply: string }>;
};

/**
 * Mounts pending proactive suggestions for the current actor+workspace and
 * bridges "Ask Sabah" into the existing Sabah client conversation. The mount
 * reads suggestions through the provided loader and never auto-approves
 * anything: Ask Sabah only seeds the conversation with the card evidence.
 */
export function SabahSuggestionMount({
    workspaceId,
    client,
    loadSuggestions,
}: {
    workspaceId: string;
    client: SabahClientLike;
    loadSuggestions: () => Promise<SuggestionCard[]>;
}) {
    const [cards, setCards] = useState<SuggestionCard[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoaded(false);
        loadSuggestions()
            .then((rows) => {
                if (!cancelled) setCards(Array.isArray(rows) ? rows.slice(0, 3) : []);
            })
            .catch(() => {
                if (!cancelled) setCards([]);
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => {
            cancelled = true;
        };
    }, [workspaceId, loadSuggestions]);

    const handleAskSabah = async (card: SuggestionCard) => {
        const content = `Regarding the suggestion "${card.title}" (evidence: ${card.evidenceIds.join(", ")}):`;
        try {
            const result = await client.sendMessage(conversationId, content);
            if (result.conversationId) setConversationId(result.conversationId);
        } catch {
            // Surface through card state; the chat thread owns conversation errors.
        }
        setCards((current) => current.filter((row) => row.id !== card.id));
    };

    if (!loaded) return null;
    if (cards.length === 0) return null;

    return (
        <SuggestionCards
            cards={cards}
            workspaceId={workspaceId}
            conversationId={conversationId}
            onAskSabah={(card) => {
                void handleAskSabah(card);
            }}
            onSnooze={(card) => {
                setCards((current) => current.filter((row) => row.id !== card.id));
            }}
            onDismiss={(card) => {
                setCards((current) => current.filter((row) => row.id !== card.id));
            }}
        />
    );
}
