import { describe, expect, it } from "vitest";
import { buildConversationContext } from "./context-builder";
import type { SabahActor } from "@/lib/sabah/auth/actor";

const actor: SabahActor = { id: "u1", role: "MEMBER", departmentIds: [] };
const messages = Array.from({ length: 25 }, (_, i) => ({ id: `m${i + 1}`, conversationId: "c1", role: i % 2 ? "assistant" : "user", content: `message ${i + 1}`, toolCallsJson: null, toolCallId: null, createdAt: new Date(2026, 7, i + 1) }));
const db = {
  aiConversation: { findUnique: async () => ({ userId: actor.id }) },
  aiMessage: { findMany: async () => messages },
  aiConversationSummary: { findFirst: async () => ({ id: "s1", version: 1, startMessageId: "m1", endMessageId: "m5", protectedStateJson: JSON.stringify({}), sourceMessageIdsJson: JSON.stringify(["m1"]), supersededById: null }) },
  aiWorkflow: { findMany: async () => [{ id: "w1", status: "RUNNING", goal: "Keep going" }] },
};

describe("buildConversationContext", () => {
  it("authorizes first, preserves recent role order, and bounds the verbatim tail", async () => {
    const result = await buildConversationContext("c1", actor, db, { systemPrompt: "Stable prompt" });
    expect(result.systemPrompt).toBe("Stable prompt");
    expect(result.messages.map((m) => m.id)).toEqual(messages.slice(-20).map((m) => m.id));
    expect(result.messages.map((m) => m.role)).toEqual(messages.slice(-20).map((m) => m.role));
    expect(result.activeWorkflows).toEqual([{ id: "w1", status: "RUNNING", goal: "Keep going" }]);
  });

  it("rejects a summary whose boundary is not a prefix of the current conversation", async () => {
    const result = await buildConversationContext("c1", actor, db, { systemPrompt: "Stable prompt" });
    expect(result.summary).toBeNull();
  });

  it("preserves a valid checkpoint after new turns and exposes the bounded bridge", async () => {
    const grownMessages = Array.from({ length: 47 }, (_, i) => ({ ...messages[i % messages.length], id: `m${i + 1}`, content: `message ${i + 1}`, createdAt: new Date(2026, 7, i + 1) }));
    const summaryDb = {
      ...db,
      aiMessage: { findMany: async () => grownMessages },
      aiConversationSummary: { findFirst: async () => ({ id: "s1", version: 1, startMessageId: "m1", endMessageId: "m25", protectedStateJson: JSON.stringify({ factualSummary: "facts", userCorrections: [], decisions: [], unresolvedActions: [], approvals: [], safetyBoundaries: [] }), sourceMessageIdsJson: JSON.stringify(Array.from({ length: 25 }, (_, i) => `m${i + 1}`)), supersededById: null }) },
    };
    const result = await buildConversationContext("c1", actor, summaryDb);
    expect(result.summary?.factualSummary).toBe("facts");
    expect(result.summary?.sourceMessageIds).toEqual(Array.from({ length: 25 }, (_, i) => `m${i + 1}`));
    expect(result.bridgeMessages.map((m) => m.id)).toEqual(["m26", "m27"]);
    expect(result.messages.map((m) => m.id)).toEqual(Array.from({ length: 20 }, (_, i) => `m${i + 28}`));
  });

  it("rejects a summary with a hole in its historical source prefix", async () => {
    const summaryDb = { ...db, aiConversationSummary: { findFirst: async () => ({ id: "s1", version: 1, startMessageId: "m1", endMessageId: "m5", protectedStateJson: JSON.stringify({ factualSummary: "facts", userCorrections: [], decisions: [], unresolvedActions: [], approvals: [], safetyBoundaries: [] }), sourceMessageIdsJson: JSON.stringify(["m1", "m5"]), supersededById: null }) } };
    const result = await buildConversationContext("c1", actor, summaryDb);
    expect(result.summary).toBeNull();
  });

  it("filters unsafe loader rows to the explicit safe projection", async () => {
    const result = await buildConversationContext("c1", actor, db, { memoryLoader: async () => [{ id: "safe", title: "Visible", privateBody: "secret" }, { id: "bad", toolPayload: "secret" }] });
    expect(result.memory).toEqual([{ id: "safe", title: "Visible" }, { id: "bad" }]);
  });

  it("exposes source-fenced data-only envelopes for every content loader", async () => {
    const result = await buildConversationContext("c1", actor, db, {
      memoryLoader: async () => [{ id: "m", summary: "memory" }],
      playbookLoader: async () => [{ id: "p", summary: "playbook" }],
      evidenceLoader: async () => [{ id: "e", summary: "document" }],
    });
    expect(result.boundaries).toEqual([
      expect.objectContaining({ source: "memory", trusted: false, instructionAuthority: "data", fencing: "source-fenced" }),
      expect.objectContaining({ source: "playbook", trusted: false, instructionAuthority: "data", fencing: "source-fenced" }),
      expect.objectContaining({ source: "document", trusted: false, instructionAuthority: "data", fencing: "source-fenced" }),
    ]);
    expect(result.boundaries.every((boundary) => boundary.content.length <= 4_000)).toBe(true);
  });

  it("skips malformed summaries fail-closed", async () => {
    const malformedDb = { ...db, aiConversationSummary: { findFirst: async () => ({ ...await db.aiConversationSummary.findFirst(), protectedStateJson: "{" }) } };
    const result = await buildConversationContext("c1", actor, malformedDb);
    expect(result.summary).toBeNull();
  });
  it("fails closed when workflow state cannot be read", async () => { const failingDb = { ...db, aiWorkflow: { findMany: async () => { throw new Error("read failed"); } } }; await expect(buildConversationContext("c1", actor, failingDb)).rejects.toThrow("CONTEXT_UNAVAILABLE"); });
  it("throws when the authorized conversation message read fails", async () => { const failingDb = { ...db, aiMessage: { findMany: async () => { throw new Error("read failed"); } } }; await expect(buildConversationContext("c1", actor, failingDb)).rejects.toThrow("CONTEXT_UNAVAILABLE: message_read_failed"); });
});
