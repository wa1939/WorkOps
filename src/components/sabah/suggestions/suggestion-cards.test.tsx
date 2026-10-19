// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import "../test/setup";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SuggestionCards, type SuggestionCard } from "./suggestion-cards";

const makeCard = (overrides: Partial<SuggestionCard> = {}): SuggestionCard => ({
    id: "suggestion-1",
    category: "high-confidence-overload-with-feasible-help",
    title: "Your workload may be overloaded",
    reason: "A teammate has feasible capacity to help.",
    confidence: 0.82,
    destination: "/workload",
    evidenceIds: ["task-1", "capacity-1"],
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
});

describe("SuggestionCards", () => {
    it("action rereads changed source", async () => {
        const user = userEvent.setup();
        const onReview = vi.fn();
        const onAskSabah = vi.fn();
        const original = makeCard({ evidenceIds: ["source-before"] });
        const changed = makeCard({ evidenceIds: ["source-after"] });
        const { rerender } = render(
            <SuggestionCards
                workspaceId="workspace-1"
                conversationId="conversation-1"
                cards={[original]}
                onReview={onReview}
                onAskSabah={onAskSabah}
            />,
        );

        rerender(
            <SuggestionCards
                workspaceId="workspace-1"
                conversationId="conversation-1"
                cards={[changed]}
                onReview={onReview}
                onAskSabah={onAskSabah}
            />,
        );
        await user.click(screen.getByRole("button", { name: "Review" }));
        await user.click(screen.getByRole("button", { name: "Ask Sabah" }));

        expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: changed.id, evidenceIds: changed.evidenceIds }));
        expect(onAskSabah).toHaveBeenCalledWith(expect.objectContaining({ id: changed.id, evidenceIds: changed.evidenceIds }), "conversation-1");
    });

    it("reassignment requires explicit approval", () => {
        render(
            <SuggestionCards
                workspaceId="workspace-1"
                cards={[makeCard()]}
                onReview={vi.fn()}
                onAskSabah={vi.fn()}
                onSnooze={vi.fn()}
                onDismiss={vi.fn()}
            />,
        );

        expect(screen.getByRole("button", { name: "Review" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Ask Sabah" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Snooze" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /apply|execute|approve/i })).not.toBeInTheDocument();
    });

    it("switching workspace fences old suggestion", () => {
        const oldCard = makeCard({ id: "old-suggestion", title: "Old workspace suggestion" });
        const newCard = makeCard({ id: "new-suggestion", title: "New workspace suggestion" });
        const { rerender } = render(<SuggestionCards workspaceId="workspace-old" cards={[oldCard]} />);

        expect(screen.getByText(oldCard.title)).toBeInTheDocument();
        rerender(<SuggestionCards workspaceId="workspace-new" cards={[newCard]} />);

        expect(screen.queryByText(oldCard.title)).not.toBeInTheDocument();
        expect(screen.getByText(newCard.title)).toBeInTheDocument();
    });

    it("dismiss hides card and persists via callback", async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        const card = makeCard();
        render(<SuggestionCards workspaceId="workspace-1" cards={[card]} onDismiss={onDismiss} />);

        await user.click(screen.getByRole("button", { name: "Dismiss" }));

        expect(onDismiss).toHaveBeenCalledWith(expect.objectContaining({ id: card.id, evidenceIds: card.evidenceIds }));
        expect(screen.queryByText(card.title)).not.toBeInTheDocument();
    });
});
