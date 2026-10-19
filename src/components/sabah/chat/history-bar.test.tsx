// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "../test/setup";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SabahHistoryBar } from "./history-bar";

const conversations = [
    { id: "conv-1", title: "Planning", createdAt: "2026-09-13T08:00:00.000Z", updatedAt: new Date().toISOString(), messageCount: 4 },
    { id: "conv-2", title: null, createdAt: "2026-09-12T08:00:00.000Z", updatedAt: "2026-09-12T09:00:00.000Z", messageCount: 1 },
];

describe("SabahHistoryBar", () => {
    beforeEach(() => {
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it("starts a new conversation from the toolbar", async () => {
        const onNewConversation = vi.fn();
        render(<SabahHistoryBar activeConversationId={null} onNewConversation={onNewConversation} onOpenConversation={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
        expect(onNewConversation).toHaveBeenCalledTimes(1);
    });

    it("lists conversations on demand and opens one", async () => {
        const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(conversations), { status: 200 }));
        const onOpenConversation = vi.fn();
        render(<SabahHistoryBar activeConversationId="conv-1" onNewConversation={vi.fn()} onOpenConversation={onOpenConversation} />);
        fireEvent.click(screen.getByRole("button", { name: "Browse conversation history" }));
        expect(await screen.findByText("Planning")).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/ai/conversations");
        fireEvent.click(screen.getByRole("button", { name: "Open conversation: Planning" }));
        expect(onOpenConversation).toHaveBeenCalledWith("conv-1");
        expect(screen.getByRole("button", { name: /Open conversation: Planning/ })).toHaveAttribute("aria-current", "true");
    });

    it("marks a deleted conversation only after a confirming second tap and reports the deletion", async () => {
        vi.spyOn(global, "fetch")
            .mockResolvedValueOnce(new Response(JSON.stringify(conversations), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        const onDeletedConversation = vi.fn();
        render(<SabahHistoryBar activeConversationId={null} onNewConversation={vi.fn()} onOpenConversation={vi.fn()} onDeletedConversation={onDeletedConversation} />);
        fireEvent.click(screen.getByRole("button", { name: "Browse conversation history" }));
        const deleteButton = await screen.findByRole("button", { name: "Delete conversation: Planning" });
        fireEvent.click(deleteButton);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const confirmButton = screen.getByRole("button", { name: "Confirm delete conversation: Planning" });
        fireEvent.click(confirmButton);
        await waitFor(() => expect(onDeletedConversation).toHaveBeenCalledWith("conv-1"));
        expect(screen.queryByText("Planning")).not.toBeInTheDocument();
    });

    it("reports an unavailable history without throwing", async () => {
        vi.spyOn(global, "fetch").mockRejectedValue(new Error("offline"));
        render(<SabahHistoryBar activeConversationId={null} onNewConversation={vi.fn()} onOpenConversation={vi.fn()} />);
        fireEvent.click(screen.getByRole("button", { name: "Browse conversation history" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(/history unavailable/i);
    });
});
