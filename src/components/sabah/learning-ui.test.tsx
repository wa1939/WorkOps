// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryCard } from "./context/memory-card";
import { PlaybookCard } from "./context/playbook-card";
import { ConversationSearch } from "./chat/conversation-search";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const source = { entityType: "TASK" as const, entityId: "t1", label: "Quarterly report", href: "/tasks/t1", sourceUpdatedAt: "2026-08-01T00:00:00.000Z", checksum: "abc" };
const memory = { id: "m1", scope: "TEAM" as const, kind: "FACT" as const, content: "The team prefers concise updates.", provenance: "USER_PROVIDED" as const, confidence: 0.9, expiresAt: "2026-08-10T00:00:00.000Z", freshness: "STALE" as const, state: "PROPOSED" as const, sources: [source] };
const playbook = { id: "pb1", playbookId: "pb1", version: 2, name: "Weekly update", description: "A bounded update workflow", scope: "TEAM" as const, ownerId: "u1", triggers: { en: ["weekly"], ar: [] }, requiredContext: ["team"], allowedCapabilities: ["notes.read"], requiredApprovals: [], outputSchema: {}, evaluationCases: [{ input: "x", expected: "y" }], state: "IN_REVIEW" as const, builtin: false, checksum: "sha256:abc" };

describe("Task 8 learning and history UI", () => {
  it("shows proposed versus approved state, safe provenance and stale expiry warning", () => {
    render(<MemoryCard memory={memory} canDecide={false} />);
    expect(screen.getByText("PROPOSED")).toBeTruthy();
    expect(screen.getByRole("status", { name: "" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Quarterly report/i }).getAttribute("href")).toBe("/tasks/t1");
    cleanup();
    render(<MemoryCard memory={{ ...memory, id: "m2", state: "APPROVED", expiresAt: null, freshness: "FRESH" }} canDecide={false} />);
    expect(screen.getByText("APPROVED")).toBeTruthy();
  });

  it("hides unsafe provenance and requires a rejection reason before deciding", async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    render(<MemoryCard memory={{ ...memory, sources: [{ ...source, href: "javascript:alert(1)" }] }} canDecide onDecision={onDecision} />);
    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(screen.getByText(/reason is required/i)).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Not authoritative" } });
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    await waitFor(() => expect(onDecision).toHaveBeenCalledWith("REJECTED", "Not authoritative"));
  });

  it("permission-gates approval and shows immutable version history", () => {
    render(<PlaybookCard playbook={playbook} canDecide={false} versions={[{ id: "pb1", version: 1, state: "APPROVED", checksum: "old" }, playbook]} />);
    expect(screen.getByText("IN_REVIEW")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /approve/i })).toBeNull();
    expect(screen.getAllByText(/Version 1/).length).toBe(1);
    expect(screen.getAllByText(/Version 2/).length).toBe(2);
    expect(screen.getByText("notes.read")).toBeTruthy();
  });

  it("submits a DRAFT for review through the supplied bounded callback", async () => {
    const onSubmitReview = vi.fn().mockResolvedValue(undefined);
    render(<PlaybookCard playbook={{ ...playbook, state: "DRAFT" }} canDecide onSubmitReview={onSubmitReview} />);
    fireEvent.click(screen.getByRole("button", { name: /submit for review/i }));
    await waitFor(() => expect(onSubmitReview).toHaveBeenCalledTimes(1));
  });

  it("searches bounded history, safely renders excerpts, and reports top-level continuation metadata", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [{ messageId: "m1", conversationId: "c1", title: "Planning", excerpt: "<script>alert(1)</script> hello", highlight: "<mark>hello</mark>", role: "user", createdAt: "2026-08-01T00:00:00.000Z" }], hasMore: true, nextCursor: "cursor-1", truncated: true }), { status: 200 }));
    render(<ConversationSearch onJump={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(await screen.findByText(/hello/)).toBeTruthy();
    expect(screen.queryByText("alert(1)")).toBeNull();
    expect(screen.getByText(/history results were truncated/i)).toBeTruthy();
    expect(screen.getByText(/more results available/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Planning/i })).toBeTruthy();
  });

  it("jumps through the supplied callback and never creates unsafe links", async () => {
    const onJump = vi.fn();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ items: [
      { messageId: "m1", conversationId: "//attacker", title: "Unsafe", excerpt: "hello" },
      { messageId: "m2", conversationId: "c2", title: "Safe", excerpt: "hello" },
    ], hasMore: false, nextCursor: null, truncated: false }), { status: 200 }));
    render(<ConversationSearch onJump={onJump} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    await screen.findByRole("button", { name: /Safe/i });
    expect(screen.queryByRole("link", { name: /Unsafe/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Safe/i }));
    expect(onJump).toHaveBeenCalledWith("c2", "m2");
  });
});
