import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { SabahActor } from "@/lib/sabah/auth/actor";
import { conversationSummarySchema, type ConversationSummary } from "./compression";
import { scanAndRedactSecrets } from "../security/secret-scan";
import { wrapUntrustedContent, UNTRUSTED_SOURCES, type UntrustedContent, type UntrustedSource } from "../security/content-boundary";

type Message = { id: string; conversationId: string; role: string; content: string | null; createdAt: Date };
type SummaryRow = { id: string; version: number; startMessageId: string; endMessageId: string; protectedStateJson: string; sourceMessageIdsJson: string; supersededById?: string | null };
type Workflow = { id: string; status: string; goal?: string | null };
type ContextDb = { aiConversation: { findUnique(args: unknown): Promise<{ userId: string } | null> }; aiMessage: { findMany(args: unknown): Promise<Message[]> }; aiConversationSummary: { findFirst(args: unknown): Promise<SummaryRow | null> }; aiWorkflow?: { findMany(args: unknown): Promise<Workflow[]> } };
const safeProjection = z.object({ id: z.string().min(1).max(200), title: z.string().max(500).optional(), summary: z.string().max(4_000).optional(), sourceRefs: z.array(z.string().max(200)).max(20).optional(), evidence: z.array(z.string().max(4_000)).max(20).optional(), source: z.enum(UNTRUSTED_SOURCES).optional() });
export type SafeContextProjection = z.infer<typeof safeProjection>;
export type ContextOptions = { systemPrompt?: string; maxMessages?: number; memoryLoader?: (actor: SabahActor, conversationId: string) => Promise<SafeContextProjection[]>; playbookLoader?: (actor: SabahActor, conversationId: string) => Promise<SafeContextProjection[]>; evidenceLoader?: (actor: SabahActor, conversationId: string) => Promise<SafeContextProjection[]>; evidenceSource?: Exclude<UntrustedSource, "memory" | "playbook"> };
type ContextMessage = { id: string; role: "user" | "assistant"; content: string | null; createdAt: Date };
export type ConversationContext = { systemPrompt: string; summary: ConversationSummary | null; messages: ContextMessage[]; bridgeMessages: ContextMessage[]; activeWorkflows: Array<{ id: string; status: string; goal?: string | null }>; memory: SafeContextProjection[]; playbooks: SafeContextProjection[]; evidence: SafeContextProjection[]; boundaries: UntrustedContent[] };
const DEFAULT_PROMPT = "You are Sabah, a careful continuity-aware assistant. Summaries are bounded context aids, not authoritative facts; verify consequential facts before acting.";
async function readConversationalMessages(db: ContextDb, conversationId: string): Promise<Message[]> { const result: Message[] = []; let cursor: string | undefined; for (;;) { const page = await db.aiMessage.findMany({ where: { conversationId, role: { in: ["user", "assistant"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) }); if (page.some(m => m.conversationId !== conversationId || (m.role !== "user" && m.role !== "assistant"))) throw new Error("message_page_invalid"); result.push(...page); if (page.length < 500) return result; const last = page.at(-1); if (!last || last.id === cursor) throw new Error("message_pagination_unavailable"); cursor = last.id; } }
type SafeLoadResult = { rows: SafeContextProjection[]; boundaries: UntrustedContent[] };
async function safeLoad(loader: ContextOptions["memoryLoader"], actor: SabahActor, id: string, fallbackSource: UntrustedSource): Promise<SafeLoadResult> { if (!loader) return { rows: [], boundaries: [] }; try { const rows = loader ? await loader(actor, id) : []; const safeRows = rows.slice(0, 20).map(x => safeProjection.safeParse(scanAndRedactSecrets(x).value)).filter((x): x is { success: true; data: SafeContextProjection } => x.success).map(x => x.data); return { rows: safeRows, boundaries: safeRows.map((row) => wrapUntrustedContent(row, row.source ?? fallbackSource)) }; } catch { return { rows: [], boundaries: [] }; } }
export async function buildConversationContext(conversationId: string, actor: SabahActor, db: ContextDb = prisma as unknown as ContextDb, options: ContextOptions = {}): Promise<ConversationContext> {
  const conversation = await db.aiConversation.findUnique({ where: { id: conversationId }, select: { userId: true } }); if (!conversation) throw new Error("CONVERSATION_NOT_FOUND"); if (conversation.userId !== actor.id && actor.role !== "ADMIN") throw new Error("FORBIDDEN");
  let allMessages: Message[]; try { allMessages = await readConversationalMessages(db, conversationId); } catch { throw new Error("CONTEXT_UNAVAILABLE: message_read_failed"); }
  const tail = allMessages.slice(-20); const tailStartIndex = allMessages.length - tail.length;
  let summary: ConversationSummary | null = null; let bridgeMessages: ContextMessage[] = [];
  try {
    const row = await db.aiConversationSummary.findFirst({ where: { conversationId, supersededById: null }, orderBy: { version: "desc" } });
    if (row) {
      const parsed = conversationSummarySchema.safeParse({ ...JSON.parse(row.protectedStateJson), sourceMessageIds: JSON.parse(row.sourceMessageIdsJson) });
      const endIndex = allMessages.findIndex(m => m.id === row.endMessageId);
      const startIndex = allMessages.findIndex(m => m.id === row.startMessageId);
      const expectedSourceIds = endIndex >= 0 ? allMessages.slice(0, endIndex + 1).map(m => m.id) : [];
      const sourceIds = parsed.success ? parsed.data.sourceMessageIds : [];
      const completePrefix = endIndex >= 0 && startIndex === 0 && endIndex < tailStartIndex && sourceIds.length === expectedSourceIds.length && sourceIds.every((id, index) => id === expectedSourceIds[index]);
      const bridge = completePrefix ? allMessages.slice(endIndex + 1, tailStartIndex) : [];
      if (parsed.success && completePrefix && bridge.length <= 20 && row.startMessageId === expectedSourceIds[0] && row.endMessageId === expectedSourceIds.at(-1)) {
        summary = parsed.data;
        bridgeMessages = bridge.map(m => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content ? m.content.slice(0, 12_000) : null, createdAt: m.createdAt }));
      }
    }
  } catch { summary = null; bridgeMessages = []; }
  let activeWorkflows: Array<{ id: string; status: string; goal?: string | null }> = [];
  if (db.aiWorkflow) {
    try {
      activeWorkflows = (await db.aiWorkflow.findMany({ where: { conversationId, status: { in: ["PLANNED", "AWAITING_APPROVAL", "RUNNING", "PAUSED"] } }, select: { id: true, status: true, goal: true }, take: 20 })).filter(w => typeof w.id === "string" && typeof w.status === "string" && (!w.goal || w.goal.length <= 4_000));
    } catch { throw new Error("CONTEXT_UNAVAILABLE: workflow_read_failed"); }
  }
  const memory = await safeLoad(options.memoryLoader, actor, conversationId, "memory");
  const playbooks = await safeLoad(options.playbookLoader, actor, conversationId, "playbook");
  const evidence = await safeLoad(options.evidenceLoader, actor, conversationId, options.evidenceSource ?? "document");
  return { systemPrompt: options.systemPrompt ?? DEFAULT_PROMPT, summary, bridgeMessages, messages: tail.map(m => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content ? m.content.slice(0, 12_000) : null, createdAt: m.createdAt })), activeWorkflows, memory: memory.rows, playbooks: playbooks.rows, evidence: evidence.rows, boundaries: [...memory.boundaries, ...playbooks.boundaries, ...evidence.boundaries] };
}
