import { describe, expect, it } from "vitest";
import { searchConversationHistory, ConversationNotFoundError, InvalidConversationSearchCursorError, type ConversationSearchDb } from "./search";
import type { SabahActor } from "@/lib/sabah/auth/actor";

const actor = { id: "u1", role: "MEMBER", departmentIds: [] } as SabahActor;
const date = (value: string) => new Date(value);

type Row = { id: string; conversationId: string; role: string; content: string | null; toolCallsJson?: string | null; createdAt: Date };
function db(rows: Row[], conversations = [{ id: "c1", title: "My chat", userId: "u1" }, { id: "c2", title: "Other chat", userId: "u2" }], workflows: Array<{ id: string; conversationId: string }> = [], calls?: { messages?: unknown[]; conversations?: unknown[]; workflows?: unknown[] }): ConversationSearchDb {
  const fake = {
    aiConversation: { findMany: async (args: { where?: { userId?: string } }) => { calls?.conversations?.push(args); return conversations.filter((c) => !args.where?.userId || c.userId === args.where.userId); } },
    aiMessage: { findMany: async (args: { where?: { conversationId?: { in?: string[] } } }) => { calls?.messages?.push(args); return rows.filter((r) => (!args.where?.conversationId?.in || args.where.conversationId.in.includes(r.conversationId))); } },
    aiWorkflow: { findMany: async (args: { where?: { id?: string; conversationId?: { in?: string[] } } }) => { calls?.workflows?.push(args); return workflows.filter((w) => !args.where?.conversationId?.in || args.where.conversationId.in.includes(w.conversationId)); } },
  };
  return fake as unknown as ConversationSearchDb;
}

describe("searchConversationHistory", () => {
  it("isolates owner conversations and searches persisted content, never tool payloads", async () => {
    const result = await searchConversationHistory("secret", actor, db([
      { id: "m1", conversationId: "c1", role: "user", content: "My secret phrase", toolCallsJson: "secret" , createdAt: date("2026-01-02") },
      { id: "m2", conversationId: "c2", role: "user", content: "Other secret", createdAt: date("2026-01-02") },
    ]));
    expect(result.items.map((item) => item.messageId)).toEqual(["m1"]);
  });

  it("supports exact phrase, Arabic normalization, and bounded prefix matching", async () => {
    const result = await searchConversationHistory('"خطة العمل"', actor, db([
      { id: "m1", conversationId: "c1", role: "assistant", content: "هذه خُطَّةُ العمل الجديدة", createdAt: date("2026-01-01") },
      { id: "m2", conversationId: "c1", role: "user", content: "planning roadmap", createdAt: date("2026-01-02") },
    ]));
    expect(result.items[0].messageId).toBe("m1");
    expect(result.items[0].excerpt.length).toBeLessThanOrEqual(240);
    expect(result.items[0].highlight).toContain("<mark>خُطَّةُ العمل</mark>");

    const prefix = await searchConversationHistory("plan", actor, db([
      { id: "m3", conversationId: "c1", role: "user", content: "planning roadmap", createdAt: date("2026-01-02") },
    ]));
    expect(prefix.items.map((item) => item.messageId)).toEqual(["m3"]);
  });

  it("supports date, conversation, workflow filters and fails closed for unsupported entity links", async () => {
    const rows = [
      { id: "m1", conversationId: "c1", role: "user", content: "release plan", createdAt: date("2026-01-01") },
      { id: "m2", conversationId: "c1", role: "assistant", content: "release plan", createdAt: date("2026-02-01") },
    ];
    const harness = db(rows, undefined, [{ id: "wf1", conversationId: "c1" }]);
    expect((await searchConversationHistory("release", actor, harness, { after: date("2026-01-15"), workflowId: "wf1" })).items.map((x) => x.messageId)).toEqual(["m2"]);
    expect((await searchConversationHistory("release", actor, harness, { entityType: "TASK", entityId: "t1" })).items).toEqual([]);
  });

  it("includes compacted persisted messages and returns truthful bounded cursor pagination", async () => {
    const rows = [1, 2, 3].map((n) => ({ id: `m${n}`, conversationId: "c1", role: "assistant", content: `compacted ${n} ` + "x".repeat(400), createdAt: date(`2026-01-0${n}`) }));
    const first = await searchConversationHistory("compacted", actor, db(rows), { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeTruthy();
    expect(first.items.every((x) => x.excerpt.length <= 240 && x.messageId)).toBe(true);
    const second = await searchConversationHistory("compacted", actor, db(rows), { limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((x) => x.messageId)).toEqual(["m1"]);
    expect(second.hasMore).toBe(false);
  });

  it("signals capped owner candidates as truncated without claiming another page", async () => {
    const conversations = Array.from({ length: 1001 }, (_, n) => ({ id: `c${n}`, title: `Chat ${n}`, userId: "u1" }));
    const result = await searchConversationHistory("missing", actor, db([], conversations));
    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it("provides a cursor when a bounded message scan is truncated, even without matches", async () => {
    const rows = Array.from({ length: 1001 }, (_, n) => ({ id: `m${n}`, conversationId: "c1", role: "user", content: "does not match", createdAt: date(`2026-01-${String((n % 28) + 1).padStart(2, "0")}`) }));
    const result = await searchConversationHistory("missing", actor, db(rows));
    expect(result.truncated).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
  });

  it("escapes persisted markup in HTML highlights while retaining the mark element", async () => {
    const result = await searchConversationHistory("hello", actor, db([
      { id: "m1", conversationId: "c1", role: "user", content: `<script>alert("x")</script> & \"' hello`, createdAt: date("2026-01-01") },
    ]));
    expect(result.items[0].highlight).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;&#39; <mark>hello</mark>");
    expect(result.items[0].highlight).not.toContain("<script>");
  });

  it("pushes date and cursor predicates and a hard candidate bound into retrieval", async () => {
    const calls = { messages: [] as unknown[], conversations: [] as unknown[], workflows: [] as unknown[] };
    const first = await searchConversationHistory("release", actor, db([
      { id: "m2", conversationId: "c1", role: "user", content: "release", createdAt: date("2026-02-01") },
      { id: "m1", conversationId: "c1", role: "user", content: "release", createdAt: date("2026-01-01") },
    ], undefined, [], calls), { after: date("2026-01-01"), limit: 1 });
    expect(first.items).toHaveLength(1);
    const messageArgs = calls.messages[0] as { where: Record<string, unknown>; take: number; orderBy: unknown };
    expect(messageArgs.take).toBeGreaterThan(1);
    expect(messageArgs.where).toMatchObject({ createdAt: { gte: date("2026-01-01") } });
    expect(messageArgs.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("rejects malformed cursors instead of scanning the first page", async () => {
    await expect(searchConversationHistory("release", actor, db([]), { cursor: "not-a-cursor" })).rejects.toBeInstanceOf(InvalidConversationSearchCursorError);
  });

  it("throws a safe not-found error when an explicitly requested conversation is inaccessible", async () => {
    await expect(searchConversationHistory("anything", actor, db([], [{ id: "c2", title: "Other", userId: "u2" }]), { conversationId: "c2" })).rejects.toBeInstanceOf(ConversationNotFoundError);
  });
});
