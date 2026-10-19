import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeWorkspaceText } from "@/lib/sabah/intelligence/normalize";
import type { SabahActor } from "@/lib/sabah/auth/actor";

export class ConversationNotFoundError extends Error {
  readonly status = 404;
  readonly code = "CONVERSATION_NOT_FOUND";
  constructor() { super("Conversation not found"); this.name = "ConversationNotFoundError"; }
}

export class InvalidConversationSearchCursorError extends Error {
  readonly status = 400;
  readonly code = "INVALID_CONVERSATION_SEARCH_CURSOR";
  constructor(message = "Invalid conversation search cursor") { super(message); this.name = "InvalidConversationSearchCursorError"; }
}

type Conversation = { id: string; title: string | null };
type Message = { id: string; conversationId: string; role: string; content: string | null; createdAt: Date };

export type ConversationSearchDb = Pick<PrismaClient, "aiConversation" | "aiMessage" | "aiWorkflow">;
export type ConversationSearchOptions = {
  conversationId?: string; entityType?: string; entityId?: string; workflowId?: string;
  before?: Date; after?: Date; limit?: number; cursor?: string;
};
export type ConversationSearchItem = {
  messageId: string; conversationId: string; title: string | null; createdAt: string; role: string;
  excerpt: string; highlight: string; workflowIds: string[]; cursor: string;
};
export type ConversationSearchResult = { items: ConversationSearchItem[]; hasMore: boolean; nextCursor: string | null; truncated: boolean };

type SearchCursor = { createdAt: string; id: string };
const MAX_LIMIT = 50;
const MAX_EXCERPT = 240;
const MAX_CONVERSATION_CANDIDATES = 1000;
const MAX_WORKFLOW_CANDIDATES = 1000;
const MAX_MESSAGE_CANDIDATES = 1000;
const encodeCursor = (value: SearchCursor) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
function decodeCursor(value: string | undefined): SearchCursor | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed === "object" && parsed !== null && "createdAt" in parsed && "id" in parsed && typeof parsed.createdAt === "string" && typeof parsed.id === "string" && parsed.id.length > 0 && !Number.isNaN(new Date(parsed.createdAt).getTime())) return parsed as SearchCursor;
  } catch { /* handled as a client error below */ }
  throw new InvalidConversationSearchCursorError();
}
function tokens(value: string): string[] {
  return value.replace(/[^A-Za-z0-9\u00C0-\u02AF\u0300-\u036F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g, " ").split(" ").filter(Boolean);
}
function matches(content: string, query: string): boolean {
  const normalized = normalizeWorkspaceText(content) ?? "";
  const wanted = normalizeWorkspaceText(query)?.replace(/^"|"$/g, "") ?? "";
  if (!wanted) return false;
  if (query.trim().startsWith('"') && query.trim().endsWith('"')) return normalized.includes(wanted);
  const haystack = tokens(normalized);
  return tokens(wanted).every((term) => haystack.some((token) => token === term || token.startsWith(term)));
}

type Offset = { start: number; end: number };
function normalizedWithOffsets(content: string): { value: string; offsets: Offset[] } {
  const chars: Array<{ char: string; offset: Offset }> = [];
  let position = 0;
  for (const original of content) {
    const start = position;
    position += original.length;
    const piece = /\s/.test(original) ? " " : (normalizeWorkspaceText(original) ?? "");
    for (const char of piece) chars.push({ char, offset: { start, end: position } });
  }
  const output: string[] = [];
  const offsets: Offset[] = [];
  let pendingSpace: Offset | null = null;
  for (const item of chars) {
    if (/\s/.test(item.char)) { pendingSpace = pendingSpace ?? item.offset; continue; }
    if (pendingSpace && output.length > 0) { output.push(" "); offsets.push(pendingSpace); }
    pendingSpace = null;
    output.push(item.char);
    offsets.push(item.offset);
  }
  return { value: output.join(""), offsets };
}
function boundedHighlight(content: string, query: string): { excerpt: string; highlight: string } {
  const normalizedQuery = normalizeWorkspaceText(query)?.replace(/^"|"$/g, "") ?? query;
  const normalized = normalizedWithOffsets(content);
  const index = normalized.value.indexOf(normalizedQuery);
  if (index < 0 || normalizedQuery.length === 0) {
    const excerpt = content.slice(0, MAX_EXCERPT);
    return { excerpt, highlight: escapeHtml(excerpt) };
  }
  const rawMatchStart = normalized.offsets[index]?.start ?? 0;
  const rawMatchEnd = normalized.offsets[index + normalizedQuery.length - 1]?.end ?? rawMatchStart;
  const start = Math.max(0, rawMatchStart - 80);
  const excerpt = content.slice(start, start + MAX_EXCERPT);
  const localStart = rawMatchStart - start;
  const localEnd = Math.min(rawMatchEnd - start, excerpt.length);
  const length = Math.max(0, localEnd - localStart);
  const highlight = length > 0 ? `${escapeHtml(excerpt.slice(0, localStart))}<mark>${escapeHtml(excerpt.slice(localStart, localStart + length))}</mark>${escapeHtml(excerpt.slice(localStart + length))}` : escapeHtml(excerpt);
  return { excerpt, highlight };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function searchConversationHistory(query: string, actor: SabahActor, db: ConversationSearchDb = prisma, options: ConversationSearchOptions = {}): Promise<ConversationSearchResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), MAX_LIMIT);
  const cursor = decodeCursor(options.cursor);
  const ownedWhere = options.conversationId ? { userId: actor.id, id: options.conversationId } : { userId: actor.id };
  const owned = await db.aiConversation.findMany({ where: ownedWhere, take: MAX_CONVERSATION_CANDIDATES + 1, select: { id: true, title: true } });
  const conversationsTruncated = owned.length > MAX_CONVERSATION_CANDIDATES;
  const boundedOwned = owned.slice(0, MAX_CONVERSATION_CANDIDATES);
  const ownedIds = boundedOwned.map((conversation) => conversation.id);
  if (options.conversationId && !ownedIds.includes(options.conversationId)) throw new ConversationNotFoundError();
  if (options.entityType || options.entityId) return { items: [], hasMore: false, nextCursor: null, truncated: conversationsTruncated };

  let allowedIds = options.conversationId ? [options.conversationId] : ownedIds;
  let workflowIdsByConversation = new Map<string, string[]>();
  let workflowsTruncated = false;
  if (options.workflowId) {
    const workflows = await db.aiWorkflow.findMany({ where: { id: options.workflowId, conversationId: { in: allowedIds } }, take: MAX_WORKFLOW_CANDIDATES + 1, select: { id: true, conversationId: true } });
    if (!workflows.some((workflow) => workflow.id === options.workflowId)) return { items: [], hasMore: false, nextCursor: null, truncated: conversationsTruncated };
    allowedIds = workflows.map((workflow) => workflow.conversationId).filter((id): id is string => id !== null);
  }
  const workflows = await db.aiWorkflow.findMany({ where: { conversationId: { in: allowedIds } }, take: MAX_WORKFLOW_CANDIDATES + 1, select: { id: true, conversationId: true } });
  workflowsTruncated = workflows.length > MAX_WORKFLOW_CANDIDATES;
  for (const workflow of workflows.slice(0, MAX_WORKFLOW_CANDIDATES)) {
    if (workflow.conversationId === null) continue;
    workflowIdsByConversation.set(workflow.conversationId, [...(workflowIdsByConversation.get(workflow.conversationId) ?? []), workflow.id]);
  }
  const createdAt = { ...(options.before ? { lt: options.before } : {}), ...(options.after ? { gte: options.after } : {}) };
  const cursorWhere = cursor ? { OR: [{ createdAt: { lt: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } }] } : {};
  const rows = await db.aiMessage.findMany({ where: { conversationId: { in: allowedIds }, content: { not: null }, ...(Object.keys(createdAt).length ? { createdAt } : {}), ...cursorWhere }, take: MAX_MESSAGE_CANDIDATES + 1, select: { id: true, conversationId: true, role: true, content: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const messageTruncated = rows.length > MAX_MESSAGE_CANDIDATES;
  const boundedRows = rows.slice(0, MAX_MESSAGE_CANDIDATES);
  const titleById = new Map(boundedOwned.map((conversation) => [conversation.id, conversation.title]));
  const filtered = boundedRows.filter((row) => row.content && matches(row.content, query) && (!options.before || row.createdAt < options.before) && (!options.after || row.createdAt >= options.after) && (!cursor || row.createdAt < new Date(cursor.createdAt) || (row.createdAt.getTime() === new Date(cursor.createdAt).getTime() && row.id < cursor.id)) && (!options.workflowId || workflowIdsByConversation.get(row.conversationId)?.includes(options.workflowId)));
  const page = filtered.slice(0, limit + 1);
  const scopeTruncated = conversationsTruncated || workflowsTruncated;
  const hasFilteredPage = page.length > limit;
  const hasMore = !scopeTruncated && (hasFilteredPage || messageTruncated);
  const items = page.slice(0, limit).map((row) => {
    const cursorValue = encodeCursor({ createdAt: row.createdAt.toISOString(), id: row.id });
    const bounded = boundedHighlight(row.content!, query);
    return { messageId: row.id, conversationId: row.conversationId, title: titleById.get(row.conversationId) ?? null, createdAt: row.createdAt.toISOString(), role: row.role, ...bounded, workflowIds: workflowIdsByConversation.get(row.conversationId) ?? [], cursor: cursorValue };
  });
  const rawCursor = boundedRows.length ? encodeCursor({ createdAt: boundedRows[boundedRows.length - 1].createdAt.toISOString(), id: boundedRows[boundedRows.length - 1].id }) : null;
  const nextCursor = hasMore ? (hasFilteredPage && items.length ? items[items.length - 1].cursor : rawCursor) : null;
  return { items, hasMore, nextCursor, truncated: scopeTruncated || messageTruncated };
}
