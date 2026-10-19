// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../sabah/test/setup";
import { SystemDiagnostics } from "./system-diagnostics";

afterEach(() => vi.unstubAllGlobals());

const listResponse = {
    logs: [{
        id: "log-1",
        source: "operational",
        category: "PROVIDER_ERROR",
        level: "ERROR",
        message: "AI provider failed",
        correlationId: "trace-123",
        metadata: { provider: "zai" },
        createdAt: "2026-09-06T10:00:00.000Z",
    }],
    conversations: [{
        id: "conv-1",
        title: "Chat debug",
        user: { id: "user-1", name: "Test User", email: "test@example.com" },
        messageCount: 2,
        createdAt: "2026-09-06T09:00:00.000Z",
        updatedAt: "2026-09-06T10:00:00.000Z",
    }],
    pagination: {
        logs: { limit: 25, hasMore: false, nextCursor: null },
        conversations: { limit: 25, hasMore: false, nextCursor: null },
    },
    retention: { days: 30, readFilter: true, automaticPurge: false, prune: "explicit DELETE only" },
};

describe("SystemDiagnostics", () => {
    it.each([
        ["logs", true], ["logs", false], ["chats", true], ["chats", false],
    ] as const)("paginates %s independently when the other collection hasMore=%s", async (collection, otherHasMore) => {
        const first = {
            ...listResponse,
            pagination: {
                logs: { limit: 25, hasMore: collection === "logs" || otherHasMore, nextCursor: collection === "logs" || otherHasMore ? "events-next" : null },
                conversations: { limit: 25, hasMore: collection === "chats" || otherHasMore, nextCursor: collection === "chats" || otherHasMore ? "chats-next" : null },
            },
        };
        const second = { ...listResponse, logs: collection === "logs" ? [{ ...listResponse.logs[0], id: "log-2", message: "Second event" }] : [], conversations: collection === "chats" ? [{ ...listResponse.conversations[0], id: "conv-2", title: "Second chat" }] : [] };
        const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first))).mockResolvedValueOnce(new Response(JSON.stringify(second)));
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();
        render(<SystemDiagnostics />);
        await screen.findByText("AI provider failed");
        await user.click(screen.getByRole("button", { name: collection === "logs" ? "Load more events" : "Load more chats" }));
        await screen.findByText(collection === "logs" ? "Second event" : "Second chat");
        const params = new URL(fetchMock.mock.calls[1][0], "https://example.test").searchParams;
        expect(params.get("view")).toBe(collection);
        expect(params.get(collection === "logs" ? "logCursor" : "chatCursor")).toBe(collection === "logs" ? "events-next" : "chats-next");
        expect(params.has(collection === "logs" ? "chatCursor" : "logCursor")).toBe(false);
        expect(screen.getAllByText(collection === "logs" ? "Chat debug" : "AI provider failed")).toHaveLength(1);
        const otherButton = screen.queryByRole("button", { name: collection === "logs" ? "Load more chats" : "Load more events" });
        if (otherHasMore) expect(otherButton).toBeVisible(); else expect(otherButton).toBeNull();
    });

    it("loads logs and opens a redacted transcript with trace identifiers", async () => {
        const fetchMock = vi.fn(async (input: string) => {
            if (input.includes("/conversations/")) {
                return new Response(JSON.stringify({
                    conversation: listResponse.conversations[0],
                    messages: [
                        { id: "msg-1", role: "user", content: "password=[REDACTED]", toolCalls: null, truncated: false, createdAt: "2026-09-06T09:00:00.000Z" },
                    ],
                    pagination: { limit: 100, hasMore: false, nextCursor: null },
                    redaction: { applied: true, transcriptDuplicatedInLogs: false },
                }), { status: 200 });
            }
            return new Response(JSON.stringify(listResponse), { status: 200 });
        });
        vi.stubGlobal("fetch", fetchMock);
        const user = userEvent.setup();

        render(<SystemDiagnostics />);

        expect(await screen.findByText("AI provider failed")).toBeVisible();
        expect(screen.getByText(/Trace trace-123/i)).toBeVisible();
        await user.click(screen.getByRole("button", { name: /Open Chat debug/i }));
        expect(await screen.findByText("password=[REDACTED]")).toBeVisible();
        expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/admin/diagnostics/conversations/conv-1"), expect.objectContaining({ cache: "no-store" }));
    });

    it("renders API failures plainly with the response trace id", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Diagnostics database unavailable" }), {
            status: 503,
            headers: { "X-Correlation-ID": "diag-failure-1" },
        })));

        render(<SystemDiagnostics />);

        expect(await screen.findByRole("alert")).toHaveTextContent("Diagnostics database unavailable");
        expect(screen.getByText(/trace diag-failure-1/i)).toBeVisible();
    });
});
