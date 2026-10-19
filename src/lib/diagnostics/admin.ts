import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SabahForbiddenError, toSabahActor, type SabahActor } from "@/lib/sabah/auth/actor";
import {
    boundedDiagnosticEventName,
    diagnosticCutoff,
    diagnosticRetentionWhere,
    DIAGNOSTIC_ENTITY_TYPE,
    isSafeDiagnosticId,
} from "./record";
import { redactDiagnosticPayload, redactDiagnosticText } from "./redact";
import type { DiagnosticLevel, DiagnosticSource } from "./types";

export const DEFAULT_DIAGNOSTIC_PAGE_SIZE = 25;
export const MAX_DIAGNOSTIC_PAGE_SIZE = 100;
export const DEFAULT_TRANSCRIPT_PAGE_SIZE = 100;
export const MAX_TRANSCRIPT_PAGE_SIZE = 200;
export const MAX_SOURCE_ROWS = 250;

export type DiagnosticsDatabase = Partial<Pick<PrismaClient,
    "auditLog" | "aiOperationalLog" | "aiWorkflowEvent" | "aiConversation" | "aiMessage"
>>;

type QueryModel = { findMany?: (args: Record<string, unknown>) => Promise<unknown[]> };
type ConversationModel = QueryModel & { findUnique?: (args: Record<string, unknown>) => Promise<unknown> };

export type DiagnosticsFilters = {
    view: "all" | "logs" | "chats";
    source: "all" | DiagnosticSource;
    limit: number;
    cursor?: Cursor;
    logCursor?: Cursor;
    chatCursor?: Cursor;
    page?: number;
    from?: Date;
    to?: Date;
    level?: DiagnosticLevel;
    category?: string;
    correlationId?: string;
    conversationId?: string;
};

type CursorScope = "logs" | "conversations" | "transcript";
export type Cursor = { scope: CursorScope; at: Date; id: string };

export type DiagnosticLogRecord = {
    id: string;
    source: DiagnosticSource;
    entityType?: string;
    entityId?: string;
    workflowId?: string;
    stepId?: string;
    actorId?: string;
    conversationId?: string;
    correlationId?: string;
    category: string;
    level: DiagnosticLevel;
    message: string;
    metadata: unknown;
    createdAt: string;
};

export type DiagnosticConversationRecord = {
    id: string;
    title: string | null;
    userId?: string;
    user: { id: string; name: string; email: string } | null;
    messageCount: number;
    createdAt: string;
    updatedAt: string;
};

export type DiagnosticTranscriptMessage = {
    id: string;
    role: string;
    content: string | null;
    toolCalls: unknown;
    toolCallId?: string;
    truncated: boolean;
    createdAt: string;
};

export type DiagnosticPagination = {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
};

export type DiagnosticListResult = {
    logs: DiagnosticLogRecord[];
    conversations: DiagnosticConversationRecord[];
    pagination: {
        logs: DiagnosticPagination;
        conversations: DiagnosticPagination;
    };
    retention: {
        days: 30;
        readFilter: true;
        automaticPurge: false;
        prune: "explicit DELETE only";
    };
};

export function createDiagnosticCorrelationId(): string {
    try {
        return `diag-${randomUUID()}`;
    } catch {
        // randomUUID is present in the supported Node runtime; this branch
        // keeps tests and unusual edge runtimes within the safe ID contract.
        return `diag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }
}

export function privateDiagnosticResponse(
    body: unknown,
    status: number,
    correlationId: string,
): NextResponse {
    const response = NextResponse.json(body, { status });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("X-Correlation-ID", correlationId);
    return response;
}

export async function requireDiagnosticsAdmin(
    correlationId: string,
): Promise<{ actor: SabahActor } | NextResponse> {
    const session = await auth();
    if (!session?.user?.id) {
        return privateDiagnosticResponse({ error: "Unauthorized" }, 401, correlationId);
    }

    try {
        // The persisted actor is the authorization source. The session role is
        // intentionally ignored so demotions/deactivations apply immediately.
        const actor = await toSabahActor(session.user);
        if (actor.role !== "ADMIN") {
            return privateDiagnosticResponse({ error: "Forbidden" }, 403, correlationId);
        }
        return { actor };
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return privateDiagnosticResponse({ error: "Forbidden" }, 403, correlationId);
        }
        return privateDiagnosticResponse({ error: "Unable to resolve user" }, 500, correlationId);
    }
}

function queryKeys(request: Request): Set<string> {
    return new Set(new URL(request.url).searchParams.keys());
}

const LIST_QUERY_KEYS = new Set([
    "view", "tab", "source", "limit", "pageSize", "page", "cursor", "logCursor", "chatCursor",
    "from", "to", "dateFrom", "dateTo", "level", "category", "correlationId", "conversationId",
]);

function parseInteger(value: string | null, name: string, min: number, max: number): number | null {
    if (value === null) return null;
    if (!/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${name}`);
    return parsed;
}

function parseDate(value: string | null, name: string): Date | undefined {
    if (value === null) return undefined;
    if (value.length === 0 || value.length > 64) throw new Error(`Invalid ${name}`);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${name}`);
    return date;
}

function encodeCursor(cursor: Cursor): string {
    const raw = JSON.stringify({ scope: cursor.scope, at: cursor.at.toISOString(), id: cursor.id });
    return Buffer.from(raw, "utf8").toString("base64url");
}

function decodeCursor(value: string | null, scope: CursorScope): Cursor | undefined {
    if (value === null) return undefined;
    if (value.length < 8 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid cursor");
    let decoded: unknown;
    try {
        decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    } catch {
        throw new Error("Invalid cursor");
    }
    if (!decoded || typeof decoded !== "object") throw new Error("Invalid cursor");
    const candidate = decoded as Record<string, unknown>;
    const at = typeof candidate.at === "string" ? new Date(candidate.at) : null;
    if (candidate.scope !== scope || !at || Number.isNaN(at.getTime()) || !isSafeDiagnosticId(candidate.id)) {
        throw new Error("Invalid cursor");
    }
    return { scope, at, id: candidate.id as string };
}

function parseId(value: string | null, name: string): string | undefined {
    if (value === null) return undefined;
    if (!isSafeDiagnosticId(value)) throw new Error(`Invalid ${name}`);
    return value;
}

function parseCategory(value: string | null): string | undefined {
    if (value === null) return undefined;
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value)) throw new Error("Invalid category");
    return value;
}

function parseLevel(value: string | null): DiagnosticLevel | undefined {
    if (value === null) return undefined;
    const levels: readonly DiagnosticLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL", "SECURITY"];
    if (!(levels as readonly string[]).includes(value)) throw new Error("Invalid level");
    return value as DiagnosticLevel;
}

export function parseDiagnosticsFilters(request: Request): DiagnosticsFilters {
    const params = new URL(request.url).searchParams;
    for (const key of Array.from(queryKeys(request))) {
        if (!LIST_QUERY_KEYS.has(key)) throw new Error("Invalid query parameter");
    }

    const viewValue = params.get("view") ?? params.get("tab") ?? "all";
    if (viewValue !== "all" && viewValue !== "logs" && viewValue !== "chats") throw new Error("Invalid view");
    const sourceValue = params.get("source") ?? "all";
    const sources: readonly string[] = ["all", "diagnostic", "audit", "operational", "workflow"];
    if (!sources.includes(sourceValue)) throw new Error("Invalid source");

    const limit = parseInteger(params.get("limit") ?? params.get("pageSize"), "limit", 1, MAX_DIAGNOSTIC_PAGE_SIZE) ?? DEFAULT_DIAGNOSTIC_PAGE_SIZE;
    const page = parseInteger(params.get("page"), "page", 1, 1_000) ?? undefined;
    const cursorValue = params.get("cursor");
    if (cursorValue && page !== undefined) throw new Error("Cursor and page cannot be combined");
    const cursor = decodeCursor(cursorValue, viewValue === "chats" ? "conversations" : "logs");
    const logCursor = decodeCursor(params.get("logCursor"), "logs");
    const chatCursor = decodeCursor(params.get("chatCursor"), "conversations");
    if (page !== undefined && (logCursor || chatCursor)) throw new Error("Cursor and page cannot be combined");

    const from = parseDate(params.get("from") ?? params.get("dateFrom"), "from");
    const to = parseDate(params.get("to") ?? params.get("dateTo"), "to");
    if (from && to && from.getTime() > to.getTime()) throw new Error("Invalid date range");

    return {
        view: viewValue,
        source: sourceValue as DiagnosticsFilters["source"],
        limit,
        cursor,
        logCursor,
        chatCursor,
        page,
        from,
        to,
        level: parseLevel(params.get("level")),
        category: parseCategory(params.get("category")),
        correlationId: parseId(params.get("correlationId"), "correlationId"),
        conversationId: parseId(params.get("conversationId"), "conversationId"),
    };
}

export function parseTranscriptFilters(request: Request): { limit: number; cursor?: Cursor } {
    const params = new URL(request.url).searchParams;
    for (const key of Array.from(params.keys())) {
        if (key !== "limit" && key !== "pageSize" && key !== "cursor") throw new Error("Invalid query parameter");
    }
    const limit = parseInteger(params.get("limit") ?? params.get("pageSize"), "limit", 1, MAX_TRANSCRIPT_PAGE_SIZE) ?? DEFAULT_TRANSCRIPT_PAGE_SIZE;
    return { limit, cursor: decodeCursor(params.get("cursor"), "transcript") };
}

function idOrUndefined(value: unknown): string | undefined {
    return isSafeDiagnosticId(value) ? value : undefined;
}

function levelOrDefault(value: unknown): DiagnosticLevel {
    const levels: readonly DiagnosticLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL", "SECURITY"];
    return typeof value === "string" && (levels as readonly string[]).includes(value)
        ? value as DiagnosticLevel
        : "INFO";
}

function dateOrEpoch(value: unknown): Date {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "string") {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
    }
    return new Date(0);
}

function parseMetadata(json: unknown): unknown {
    if (typeof json !== "string" || json.length === 0) return null;
    try {
        return redactDiagnosticPayload(JSON.parse(json));
    } catch {
        return { omitted: true, reason: "invalid_metadata" };
    }
}

function recordMetadata(record: unknown): Record<string, unknown> {
    return record && typeof record === "object" && !Array.isArray(record) ? record as Record<string, unknown> : {};
}

function linkedValue(metadata: unknown, key: string): unknown {
    const root = recordMetadata(metadata);
    const nested = recordMetadata(root.metadata);
    return root[key] ?? nested[key];
}

function makeLogRecord(
    source: DiagnosticSource,
    row: Record<string, unknown>,
    workflow: Record<string, unknown> | undefined,
): DiagnosticLogRecord {
    const metadata = parseMetadata(row.metaJson ?? row.metadataJson);
    const workflowMetadata = workflow ?? {};
    const entityId = idOrUndefined(row.entityId);
    const workflowId = idOrUndefined(row.workflowId ?? workflowMetadata.id);
    const stepId = idOrUndefined(row.stepId);
    const rowCorrelation = idOrUndefined(row.correlationId);
    const workflowCorrelation = idOrUndefined(workflowMetadata.correlationId);
    const correlationId = source === "diagnostic"
        ? entityId
        : rowCorrelation ?? workflowCorrelation ?? idOrUndefined(linkedValue(metadata, "correlationId"));
    const conversationId = idOrUndefined(row.conversationId ?? workflowMetadata.conversationId ?? linkedValue(metadata, "conversationId"));
    const actorId = idOrUndefined(row.actorId ?? workflowMetadata.actorId ?? linkedValue(metadata, "actorId"));
    const category = boundedDiagnosticEventName(row.action ?? row.category ?? row.eventType);
    const metadataMessage = linkedValue(metadata, "message");
    const message = redactDiagnosticText(
        typeof metadataMessage === "string"
            ? metadataMessage
            : typeof row.message === "string" ? row.message : "",
    );
    const createdAt = dateOrEpoch(row.createdAt);
    return {
        id: idOrUndefined(row.id) ?? `${source}-${createdAt.getTime()}`,
        source,
        ...(typeof row.entityType === "string" ? { entityType: boundedDiagnosticEventName(row.entityType) } : {}),
        ...(entityId ? { entityId } : {}),
        ...(workflowId ? { workflowId } : {}),
        ...(stepId ? { stepId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(conversationId ? { conversationId } : {}),
        ...(correlationId ? { correlationId } : {}),
        category,
        level: levelOrDefault(row.level ?? linkedValue(metadata, "level")),
        message,
        metadata,
        createdAt: createdAt.toISOString(),
    };
}

function inDateRange(date: Date, filters: DiagnosticsFilters): boolean {
    return (!filters.from || date.getTime() >= filters.from.getTime()) && (!filters.to || date.getTime() <= filters.to.getTime());
}

function matchesLogFilters(log: DiagnosticLogRecord, filters: DiagnosticsFilters, now: Date): boolean {
    const date = new Date(log.createdAt);
    if (log.source === "diagnostic" && date.getTime() < diagnosticCutoff(now).getTime()) return false;
    if (!inDateRange(date, filters)) return false;
    if (filters.level && log.level !== filters.level) return false;
    if (filters.category && log.category.toLowerCase() !== filters.category.toLowerCase()) return false;
    if (filters.correlationId && log.correlationId !== filters.correlationId) return false;
    if (filters.conversationId && log.conversationId !== filters.conversationId) return false;
    return true;
}

function cursorWhere(
    cursor: Cursor | undefined,
    ascending = false,
    field: "createdAt" | "updatedAt" = "createdAt",
): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    const operator = ascending ? "gt" : "lt";
    return {
        OR: [
            { [field]: { [operator]: cursor.at } },
            { [field]: cursor.at, id: { [operator]: cursor.id } },
        ],
    };
}

function rangedCreatedAt(filters: DiagnosticsFilters, now: Date, includeRetention: boolean): Record<string, Date> {
    const range: Record<string, Date> = {};
    if (filters.from) range.gte = filters.from;
    if (filters.to) range.lte = filters.to;
    if (includeRetention) {
        const cutoff = diagnosticCutoff(now);
        range.gte = range.gte && range.gte.getTime() > cutoff.getTime() ? range.gte : cutoff;
    }
    return range;
}

function addAfter(
    where: Record<string, unknown>,
    cursor: Cursor | undefined,
    ascending = false,
    field: "createdAt" | "updatedAt" = "createdAt",
): Record<string, unknown> {
    const after = cursorWhere(cursor, ascending, field);
    return after ? { AND: [where, after] } : where;
}

function withMetadataContains(
    where: Record<string, unknown>,
    filters: readonly { key: string; value: string }[],
): Record<string, unknown> {
    // AuditLog.metaJson is a String rather than Prisma Json. These values come
    // from parser-constrained IDs/enums, so Prisma's parameterized contains
    // predicate can run before take without raw SQL; mapping still rechecks it.
    const metadataWhere = filters.map(({ key, value }) => ({
        metaJson: { contains: `"${key}":"${value}"` },
    }));
    if (metadataWhere.length === 0) return where;
    if (metadataWhere.length === 1) return { ...where, ...metadataWhere[0] };
    return { AND: [where, ...metadataWhere] };
}

function selectAvailable(model: unknown): model is QueryModel {
    return Boolean(model && typeof (model as QueryModel).findMany === "function");
}

async function findRows(model: unknown, args: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    if (!selectAvailable(model)) return [];
    const rows = await model.findMany!(args);
    return Array.isArray(rows) ? rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")) : [];
}

function sourceEnabled(source: DiagnosticsFilters["source"], target: DiagnosticSource): boolean {
    return source === "all" || source === target;
}

function logCursorFor(filters: DiagnosticsFilters): Cursor | undefined {
    return filters.view === "chats" ? undefined : filters.cursor ?? filters.logCursor;
}

function chatCursorFor(filters: DiagnosticsFilters): Cursor | undefined {
    return filters.view === "logs" ? undefined : filters.cursor ?? filters.chatCursor;
}

function logPagination(logs: DiagnosticLogRecord[], hasMore: boolean, limit: number): DiagnosticPagination {
    const last = logs[logs.length - 1];
    return {
        limit,
        hasMore,
        nextCursor: last && isSafeDiagnosticId(last.id)
            ? encodeCursor({ scope: "logs", at: new Date(last.createdAt), id: last.id })
            : null,
    };
}

function chatPagination(chats: DiagnosticConversationRecord[], hasMore: boolean, limit: number): DiagnosticPagination {
    const last = chats[chats.length - 1];
    return {
        limit,
        hasMore,
        nextCursor: last && isSafeDiagnosticId(last.id)
            ? encodeCursor({ scope: "conversations", at: new Date(last.updatedAt), id: last.id })
            : null,
    };
}

function conversationRecord(row: Record<string, unknown>): DiagnosticConversationRecord {
    const user = row.user && typeof row.user === "object" ? row.user as Record<string, unknown> : undefined;
    const id = idOrUndefined(row.id) ?? "invalid-conversation";
    const userId = idOrUndefined(row.userId);
    return {
        id,
        title: typeof row.title === "string" ? redactDiagnosticText(row.title, 256) : null,
        ...(userId ? { userId } : {}),
        user: user && idOrUndefined(user.id)
            ? {
                id: idOrUndefined(user.id)!,
                name: redactDiagnosticText(typeof user.name === "string" ? user.name : "", 256),
                email: redactDiagnosticText(typeof user.email === "string" ? user.email : "", 320),
            }
            : null,
        messageCount: userNumber(row._count, "messages"),
        createdAt: dateOrEpoch(row.createdAt).toISOString(),
        updatedAt: dateOrEpoch(row.updatedAt).toISOString(),
    };
}

function userNumber(value: unknown, key: string): number {
    if (!value || typeof value !== "object") return 0;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0 ? Math.min(candidate, 100_000) : 0;
}

export async function listDiagnostics(
    filters: DiagnosticsFilters,
    db: DiagnosticsDatabase = prisma,
    now = new Date(),
): Promise<DiagnosticListResult> {
    const logCursor = logCursorFor(filters);
    const chatCursor = chatCursorFor(filters);
    const offset = filters.page ? (filters.page - 1) * filters.limit : undefined;
    const sourceTake = Math.min(MAX_SOURCE_ROWS, Math.max(filters.limit + 1, filters.limit * 3 + 1));
    const logRange = rangedCreatedAt(filters, now, false);
    const diagnosticRange = rangedCreatedAt(filters, now, true);
    const queryLimit = offset === undefined ? sourceTake : Math.min(MAX_SOURCE_ROWS, offset + filters.limit + 1);
    const orderBy = [{ createdAt: "desc" }, { id: "desc" }];

    const diagnosticWhere = withMetadataContains({
        ...diagnosticRetentionWhere(now),
        createdAt: diagnosticRange,
        ...(filters.category ? { action: { equals: filters.category, mode: "insensitive" } } : {}),
        ...(filters.correlationId ? { entityId: filters.correlationId } : {}),
    }, [
        ...(filters.level ? [{ key: "level", value: filters.level }] : []),
        ...(filters.conversationId ? [{ key: "conversationId", value: filters.conversationId }] : []),
    ]);
    const auditWhere = withMetadataContains({
        entityType: { not: DIAGNOSTIC_ENTITY_TYPE },
        ...(Object.keys(logRange).length ? { createdAt: logRange } : {}),
        ...(filters.category ? { action: { equals: filters.category, mode: "insensitive" } } : {}),
    }, [
        ...(filters.level ? [{ key: "level", value: filters.level }] : []),
        ...(filters.correlationId ? [{ key: "correlationId", value: filters.correlationId }] : []),
        ...(filters.conversationId ? [{ key: "conversationId", value: filters.conversationId }] : []),
    ]);
    const operationalWhere: Record<string, unknown> = {
        ...(Object.keys(logRange).length ? { createdAt: logRange } : {}),
        ...(filters.level ? { level: filters.level } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.correlationId ? { correlationId: filters.correlationId } : {}),
        ...(filters.conversationId ? { workflow: { conversationId: filters.conversationId } } : {}),
    };
    const workflowWhere: Record<string, unknown> = {
        ...(Object.keys(logRange).length ? { createdAt: logRange } : {}),
        ...(filters.level ? { level: filters.level } : {}),
        ...(filters.category ? { eventType: filters.category } : {}),
        ...(filters.conversationId ? { workflow: { conversationId: filters.conversationId } } : {}),
    };
    if (filters.correlationId) {
        workflowWhere.workflow = { ...(workflowWhere.workflow as Record<string, unknown> | undefined), correlationId: filters.correlationId };
    }

    const diagnosticRows = filters.view === "chats" || !sourceEnabled(filters.source, "diagnostic")
        ? []
        : await findRows(db.auditLog, { where: addAfter(diagnosticWhere, logCursor), orderBy, ...(offset === undefined ? {} : { skip: offset }), take: queryLimit, select: { id: true, entityType: true, entityId: true, action: true, actorId: true, metaJson: true, createdAt: true } });
    const auditRows = filters.view === "chats" || !sourceEnabled(filters.source, "audit")
        ? []
        : await findRows(db.auditLog, { where: addAfter(auditWhere, logCursor), orderBy, ...(offset === undefined ? {} : { skip: offset }), take: queryLimit, select: { id: true, entityType: true, entityId: true, action: true, actorId: true, metaJson: true, createdAt: true } });
    const operationalRows = filters.view === "chats" || !sourceEnabled(filters.source, "operational")
        ? []
        : await findRows(db.aiOperationalLog, { where: addAfter(operationalWhere, logCursor), orderBy, ...(offset === undefined ? {} : { skip: offset }), take: queryLimit, select: { id: true, workflowId: true, category: true, level: true, message: true, correlationId: true, metadataJson: true, createdAt: true, workflow: { select: { id: true, actorId: true, conversationId: true, correlationId: true } } } });
    const workflowRows = filters.view === "chats" || !sourceEnabled(filters.source, "workflow")
        ? []
        : await findRows(db.aiWorkflowEvent, { where: addAfter(workflowWhere, logCursor), orderBy, ...(offset === undefined ? {} : { skip: offset }), take: queryLimit, select: { id: true, workflowId: true, stepId: true, eventType: true, level: true, message: true, metadataJson: true, createdAt: true, workflow: { select: { id: true, actorId: true, conversationId: true, correlationId: true } } } });

    const logs = [
        ...diagnosticRows.map((row) => makeLogRecord("diagnostic", row, undefined)),
        ...auditRows.map((row) => makeLogRecord("audit", row, undefined)),
        ...operationalRows.map((row) => makeLogRecord("operational", row, recordMetadata(row.workflow))),
        ...workflowRows.map((row) => makeLogRecord("workflow", row, recordMetadata(row.workflow))),
    ]
        .filter((row) => matchesLogFilters(row, filters, now))
        .sort((a, b) => {
            const date = b.createdAt.localeCompare(a.createdAt);
            return date || b.id.localeCompare(a.id);
        });
    const hasMoreLogs = logs.length > filters.limit;
    const boundedLogs = logs.slice(0, filters.limit);

    let conversations: DiagnosticConversationRecord[] = [];
    let hasMoreConversations = false;
    if (filters.view !== "logs") {
        const conversationWhere: Record<string, unknown> = {
            ...(filters.conversationId ? { id: filters.conversationId } : {}),
            ...((filters.from || filters.to) ? { updatedAt: rangedCreatedAt(filters, now, false) } : {}),
        };
        const conversationRows = await findRows(db.aiConversation, {
            where: addAfter(conversationWhere, chatCursor, false, "updatedAt"),
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            ...(offset === undefined ? {} : { skip: offset }),
            take: queryLimit,
            select: { id: true, title: true, userId: true, createdAt: true, updatedAt: true, user: { select: { id: true, name: true, email: true } }, _count: { select: { messages: true } } },
        });
        const mapped = conversationRows.map(conversationRecord).sort((a, b) => {
            const date = b.updatedAt.localeCompare(a.updatedAt);
            return date || b.id.localeCompare(a.id);
        });
        hasMoreConversations = mapped.length > filters.limit;
        conversations = mapped.slice(0, filters.limit);
    }

    return {
        logs: boundedLogs,
        conversations,
        pagination: {
            logs: logPagination(boundedLogs, hasMoreLogs, filters.limit),
            conversations: chatPagination(conversations, hasMoreConversations, filters.limit),
        },
        retention: {
            days: 30,
            readFilter: true,
            automaticPurge: false,
            prune: "explicit DELETE only",
        },
    };
}

function safeTranscriptContent(value: unknown): { content: string | null; truncated: boolean } {
    if (value === null || value === undefined) return { content: null, truncated: false };
    if (typeof value !== "string") return { content: redactDiagnosticText(String(value), 8_000), truncated: true };
    const content = redactDiagnosticText(value, 8_000);
    return { content, truncated: value.length > 8_000 || content.includes("[TRUNCATED]") };
}

function safeToolCalls(value: unknown): unknown {
    if (typeof value !== "string" || value.length === 0) return null;
    try {
        return redactDiagnosticPayload(JSON.parse(value), { maxStringLength: 2_000, maxArrayLength: 32, maxObjectKeys: 32, maxDepth: 4 });
    } catch {
        return { omitted: true, reason: "invalid_tool_calls" };
    }
}

export async function getDiagnosticTranscript(
    conversationId: string,
    options: { limit: number; cursor?: Cursor },
    db: DiagnosticsDatabase = prisma,
): Promise<{ conversation: DiagnosticConversationRecord | null; messages: DiagnosticTranscriptMessage[]; pagination: DiagnosticPagination } | null> {
    const conversationModel = db.aiConversation as unknown as ConversationModel | undefined;
    if (!conversationModel?.findUnique) return null;
    const conversation = await conversationModel.findUnique({
        where: { id: conversationId },
        select: { id: true, title: true, userId: true, createdAt: true, updatedAt: true, user: { select: { id: true, name: true, email: true } } },
    }) as Record<string, unknown> | null;
    if (!conversation) return null;

    const messageWhere: Record<string, unknown> = { conversationId };
    if (options.cursor) {
        const after = cursorWhere(options.cursor, true);
        if (after) messageWhere.AND = [after];
    }
    const rows = await findRows(db.aiMessage, {
        where: messageWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: options.limit + 1,
        select: { id: true, role: true, content: true, toolCallsJson: true, toolCallId: true, createdAt: true },
    });
    const hasMore = rows.length > options.limit;
    const messages = rows.slice(0, options.limit).map((row) => {
        const safeContent = safeTranscriptContent(row.content);
        return {
            id: idOrUndefined(row.id) ?? "invalid-message",
            role: typeof row.role === "string" ? redactDiagnosticText(row.role, 64) : "unknown",
            content: safeContent.content,
            toolCalls: safeToolCalls(row.toolCallsJson),
            ...(idOrUndefined(row.toolCallId) ? { toolCallId: idOrUndefined(row.toolCallId) } : {}),
            truncated: safeContent.truncated,
            createdAt: dateOrEpoch(row.createdAt).toISOString(),
        };
    });
    const last = messages[messages.length - 1];
    const pagination: DiagnosticPagination = {
        limit: options.limit,
        hasMore,
        nextCursor: last && isSafeDiagnosticId(last.id)
            ? encodeCursor({ scope: "transcript", at: new Date(last.createdAt), id: last.id })
            : null,
    };
    return { conversation: conversationRecord(conversation), messages, pagination };
}

export function isDiagnosticsAdminResponse(value: unknown): value is NextResponse {
    return value instanceof NextResponse;
}

export { encodeCursor };
