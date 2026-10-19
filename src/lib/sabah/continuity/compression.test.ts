import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/glm", () => ({ callGLMText: vi.fn(async () => JSON.stringify({ factualSummary: "Known facts", userCorrections: [], decisions: [], unresolvedActions: [], approvals: [], safetyBoundaries: [], sourceMessageIds: ["m1", "m2", "m3", "m4", "m5"] })) }));
vi.mock("@/lib/sabah/providers/admin-service", () => ({ resolveRuntimeProviderCredentials: vi.fn(async () => ({})) }));
vi.mock("@/lib/diagnostics/record", () => ({ recordDiagnostic: vi.fn(async () => undefined) }));
import { recordDiagnostic } from "@/lib/diagnostics/record";
import { callGLMText } from "@/lib/glm";
import { resolveRuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";
import { conversationSummarySchema, compressConversation, type CompressionDb, type SummaryRow, type ConversationSummary } from "./compression";
import type { SabahActor } from "@/lib/sabah/auth/actor";
const actor: SabahActor = { id: "u1", role: "MEMBER", departmentIds: [] };
const message = (id: string, role: string, content = "x", createdAt = new Date(Number(id.slice(1)) * 1000)) => ({ id, conversationId: "c1", role, content, toolCallsJson: null, toolCallId: null, createdAt });
const emptyProtected: Pick<ConversationSummary, "userCorrections" | "decisions" | "unresolvedActions" | "approvals" | "safetyBoundaries"> = { userCorrections: [], decisions: [], unresolvedActions: [], approvals: [], safetyBoundaries: [] };
const summary = (sourceMessageIds: string[] = ["m1"], protectedState = emptyProtected) => ({ factualSummary: "Known facts", ...protectedState, sourceMessageIds });
type Query = { cursor?: { id: string }; take?: number };
type CreateInput = { data: Record<string, unknown> };
function fakeDb(messages = Array.from({ length: 25 }, (_, i) => message(`m${i + 1}`, i % 2 ? "assistant" : "user"))) {
  const rows: Array<Record<string, unknown>> = [];
  const db: CompressionDb = {
    aiConversation: { findUnique: async () => ({ userId: actor.id }) },
    aiMessage: { findMany: async (args: unknown) => { const query = args as Query; const eligible = messages.filter(m => m.role === "user" || m.role === "assistant"); const cursor = query.cursor?.id; const start = cursor ? eligible.findIndex(m => m.id === cursor) + 1 : 0; return eligible.slice(start, start + (query.take ?? 500)); } },
    aiFeedback: { findMany: async () => [] }, aiWorkflow: { findMany: async () => [] }, aiApproval: { findMany: async () => [] },
    aiConversationSummary: { findFirst: async () => null, create: async ({ data }: CreateInput): Promise<SummaryRow> => { rows.push(data); return { id: "s1", version: 1, startMessageId: "m1", endMessageId: "m5", protectedStateJson: String(data.protectedStateJson), sourceMessageIdsJson: String(data.sourceMessageIdsJson) }; }, update: async () => ({ id: "old", version: 1, startMessageId: "m1", endMessageId: "m5", protectedStateJson: "{}", sourceMessageIdsJson: "[]" }) },
    $transaction: async <T>(work: (tx: CompressionDb) => Promise<T>) => work(db),
  };
  return { db, rows };
}
describe("conversation summary validation", () => {
  it("rejects malformed provider JSON and unbounded text", () => { expect(() => conversationSummarySchema.parse(JSON.parse("not-json"))).toThrow(); expect(() => conversationSummarySchema.parse({ ...summary(), factualSummary: "x".repeat(12_001) })).toThrow(); });
  it("fails closed when a provider omits a persisted protected field", async () => {
    const { db, rows } = fakeDb();
    db.aiFeedback = { findMany: async () => [{ id: "f1", outcome: "CORRECTED", contextJson: JSON.stringify({ reason: "must retain", source: { messageId: "m1" } }), conversationId: "c1", messageId: "m1" }] };
    const result = await compressConversation("c1", actor, db, { provider: async () => JSON.stringify(summary(["m1", "m2", "m3", "m4", "m5"])) });
    expect(result).toMatchObject({ status: "uncompressed", reason: "protected_item_omitted" });
    expect(rows).toHaveLength(0);
  });
  it("fails closed when a provider alters a persisted protected item", async () => {
    const { db, rows } = fakeDb();
    db.aiFeedback = { findMany: async () => [{ id: "f1", outcome: "CORRECTED", contextJson: JSON.stringify({ reason: "must retain", source: { messageId: "m1" } }), conversationId: "c1", messageId: "m1" }] };
    const result = await compressConversation("c1", actor, db, { provider: async () => JSON.stringify(summary(["m1", "m2", "m3", "m4", "m5"], { ...emptyProtected, userCorrections: [{ messageId: "m1", text: "must retain" }, { messageId: "m1", text: "altered" }] })) });
    expect(result).toMatchObject({ status: "uncompressed", reason: "protected_item_altered" });
    expect(rows).toHaveLength(0);
  });
  it("does not let supplemental protected state replace persisted corrections", async () => { const { db } = fakeDb(); db.aiFeedback = { findMany: async () => [{ id: "f1", outcome: "CORRECTED", contextJson: JSON.stringify({ reason: "persisted", source: { messageId: "m1" } }), conversationId: "c1", messageId: "m1" }] }; let seen = ""; const result = await compressConversation("c1", actor, db, { protectedState: { userCorrections: [{ messageId: "m1", text: "caller" }] as ConversationSummary["userCorrections"] }, provider: async prompt => { seen = prompt; return JSON.stringify(summary(["m1", "m2", "m3", "m4", "m5"], { ...emptyProtected, userCorrections: [{ messageId: "m1", text: "persisted" }, { messageId: "m1", text: "caller" }] as ConversationSummary["userCorrections"] })); } }); expect(result.status).toBe("compressed"); expect(seen).toContain("persisted"); });
  it("persists both persisted and supplemental protected corrections", async () => { const { db, rows } = fakeDb(); db.aiFeedback = { findMany: async () => [{ id: "f1", outcome: "CORRECTED", contextJson: JSON.stringify({ reason: "persisted A", source: { messageId: "m1" } }), conversationId: "c1", messageId: "m1" }] }; const result = await compressConversation("c1", actor, db, { protectedState: { userCorrections: [{ messageId: "m2", text: "supplemental B" }] as ConversationSummary["userCorrections"] }, provider: async () => JSON.stringify(summary(["m1", "m2", "m3", "m4", "m5"], { ...emptyProtected, userCorrections: [{ messageId: "m1", text: "persisted A" }, { messageId: "m2", text: "supplemental B" }] as ConversationSummary["userCorrections"] })) }); expect(result.status).toBe("compressed"); expect(JSON.parse(String(rows[0].protectedStateJson)).userCorrections).toEqual(expect.arrayContaining([{ messageId: "m1", text: "persisted A" }, { messageId: "m2", text: "supplemental B" }])); });
  it("rejects a provider source list missing either stored boundary", async () => { const { db, rows } = fakeDb(); const result = await compressConversation("c1", actor, db, { provider: async () => JSON.stringify(summary(["m2"])) }); expect(result).toMatchObject({ status: "uncompressed", reason: "invalid_source_ids" }); expect(rows).toHaveLength(0); });
  it("rejects a provider source list with a missing middle or wrong order", async () => { const { db } = fakeDb(); const result = await compressConversation("c1", actor, db, { provider: async () => JSON.stringify(summary(["m1", "m3", "m2", "m4", "m5"])) }); expect(result).toMatchObject({ status: "uncompressed", reason: "invalid_source_ids" }); });
  it("fails closed on conflicting persisted feedback references", async () => { const { db, rows } = fakeDb(); db.aiFeedback = { findMany: async () => [{ id: "f1", outcome: "CORRECTED", contextJson: JSON.stringify({ reason: "bad", source: { messageId: "m2" } }), conversationId: "c1", messageId: "m1" }] }; const result = await compressConversation("c1", actor, db, { provider: async () => JSON.stringify(summary(["m1", "m2", "m3", "m4", "m5"])) }); expect(result).toMatchObject({ status: "uncompressed", reason: "protected_state_unavailable" }); expect(rows).toHaveLength(0); });
  it("fails closed when protected record reads are unavailable", async () => { const { db } = fakeDb(); delete db.aiFeedback; const result = await compressConversation("c1", actor, db, { provider: async () => JSON.stringify(summary()) }); expect(result).toMatchObject({ status: "uncompressed", reason: "protected_state_unavailable" }); });
});
describe("lossless compression", () => {
  it("correlates compression provider errors without copying conversation text", async () => {
    const { db } = fakeDb();
    Object.assign(db, { aiModelAssignment: { findUnique: async () => null } });
    vi.mocked(callGLMText).mockClear();
    vi.mocked(recordDiagnostic).mockClear();
    const result = await compressConversation("c1", actor, db);
    expect(result.status, JSON.stringify(result)).toBe("compressed");
    const options = vi.mocked(callGLMText).mock.lastCall?.[1];
    expect(options?.onDiagnostic).toEqual(expect.any(Function));
    await options!.onDiagnostic!({ event: "error", provider: "zai", model: "glm-5", attempt: 1, status: 503 });
    expect(recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: expect.stringMatching(/^compression-/), actorId: "u1", conversationId: "c1",
      category: "PROVIDER_ERROR", level: "ERROR", metadata: expect.objectContaining({ role: "COMPRESSION", status: 503 }),
    }));
    expect(JSON.stringify(vi.mocked(recordDiagnostic).mock.calls)).not.toMatch(/Known facts|sourceMessageIds/);
  });
  it("forwards the admin-selected COMPRESSION fallback chain", async () => {
    const { db } = fakeDb();
    const fallbacks = [{ providerKey: "zai", modelName: "glm-4.5-flash" }];
    Object.assign(db, { aiModelAssignment: { findUnique: async () => ({ providerKey: "nuha", modelName: "Nuha-2.1", configJson: JSON.stringify({ fallbacks }) }) } });
    vi.mocked(callGLMText).mockClear();
    const result = await compressConversation("c1", actor, db);
    expect(result.status).toBe("compressed");
    expect(callGLMText).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ provider: "nuha", model: "Nuha-2.1", fallbacks }));
  });
  it("pages all conversational rows before choosing the boundary", async () => { const messages = Array.from({ length: 1_021 }, (_, i) => message(`m${i + 1}`, i % 3 === 0 ? "tool" : i % 2 ? "assistant" : "user", "x")); const { db } = fakeDb(messages); const result = await compressConversation("c1", actor, db, { maxMessages: 21, provider: async () => { const eligible = messages.filter(m => m.role === "user" || m.role === "assistant").slice(0, -20); return JSON.stringify(summary([eligible[0].id, eligible.at(-1)!.id])); } }); expect(result).toMatchObject({ status: "uncompressed", reason: "source_prefix_too_large" }); });
  it("uses the configured COMPRESSION model resolver", async () => { const { db } = fakeDb(); let resolved = false; const result = await compressConversation("c1", actor, db, { modelResolver: async () => { resolved = true; return "glm-4.5"; }, provider: async () => JSON.stringify(summary(["m1", "m2", "m3", "m4", "m5"])) }); expect(result.status).toBe("compressed"); expect(resolved).toBe(false); const result2 = await compressConversation("c1", actor, db, { modelResolver: async () => { resolved = true; return "glm-4.5"; } }); expect(result2.status).toBe("compressed"); expect(resolved).toBe(true); });
  it("honors a Nuha COMPRESSION assignment with stored credentials", async () => { const { db } = fakeDb(); const credentials = { nuha: "synthetic-runtime-value" }; Object.assign(db, { aiModelAssignment: { findUnique: async () => ({ providerKey: "nuha", modelName: "Nuha-2.1", configJson: null }) } }); vi.mocked(resolveRuntimeProviderCredentials).mockResolvedValueOnce(credentials); const result = await compressConversation("c1", actor, db); expect(result.status).toBe("compressed"); expect(vi.mocked(callGLMText)).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ provider: "nuha", model: "Nuha-2.1", credentials })); });
  it("fails closed for a source outside the conversation and never deletes messages", async () => { const { db, rows } = fakeDb(); const result = await compressConversation("c1", actor, db, { provider: async () => JSON.stringify(summary(["other"])) }); expect(result.status).toBe("uncompressed"); expect(rows).toHaveLength(0); });
  it("allows only one same-conversation compression to succeed", async () => { const { db, rows } = fakeDb(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let calls = 0; const provider = async () => { calls += 1; await gate; return JSON.stringify(summary(["m1", "m2", "m3", "m4", "m5"])); }; const first = compressConversation("c1", actor, db, { provider }); await Promise.resolve(); const second = await compressConversation("c1", actor, db, { provider }); expect(second).toMatchObject({ status: "uncompressed", reason: "compression_in_progress" }); release(); expect((await first).status).toBe("compressed"); expect(calls).toBe(1); expect(rows).toHaveLength(1); });
 });
