// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../sabah/test/setup";
import { render, screen } from "@testing-library/react";
import { ChatMessageBubble } from "./chat-message";
import { ToolCard } from "./tool-card";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

const call = { name: "listMyTasks", params: {}, result: { ok: true as const, data: [{ id: "real", title: "Real task", url: "/tasks/real" }] } };

describe("legacy Sabah grounding compatibility", () => {
    it("does not make an invented model link navigable", () => {
        render(<ChatMessageBubble message={{ id: "m1", role: "assistant", content: "[Invented](/tasks/fake)" }} />);
        expect(screen.getByText("Invented")).toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "Invented" })).not.toBeInTheDocument();
    });

    it("preserves verified links from persisted tool calls", () => {
        render(<ChatMessageBubble message={{ id: "m1", role: "assistant", content: "[Verified](/tasks/real)", toolCalls: [call] }} />);
        expect(screen.getByRole("link", { name: "Verified" })).toHaveAttribute("href", "/tasks/real");
    });

    it("renders bounded result envelopes and explicitly labels incomplete matches", () => {
        render(<ToolCard call={{ ...call, result: { ok: true, data: { items: call.result.data, returnedCount: 1, limit: 1, hasMore: true, countsScope: "returned_items_only" } } }} />);
        expect(screen.getByRole("link", { name: "Real task" })).toHaveAttribute("href", "/tasks/real");
        expect(screen.getByText(/more matches available/i)).toBeInTheDocument();
    });

    it("continues rendering legacy persisted task arrays", () => {
        render(<ToolCard call={call} />);
        expect(screen.getByRole("link", { name: "Real task" })).toHaveAttribute("href", "/tasks/real");
    });
});
