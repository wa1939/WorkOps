import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redactDiagnosticPayload, redactDiagnosticText, serializeDiagnosticMetadata } from "./redact";
import type { DiagnosticEvent, DiagnosticLevel } from "./types";

export const DIAGNOSTIC_ENTITY_TYPE = "SYSTEM_DIAGNOSTIC" as const;
export const DIAGNOSTIC_RETENTION_DAYS = 30 as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ID_LENGTH = 128;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_EVENT_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const LEVELS: readonly DiagnosticLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL", "SECURITY"];

type DiagnosticDatabase = Pick<PrismaClient, "auditLog">;

export function diagnosticCutoff(now = new Date()): Date {
    return new Date(now.getTime() - DIAGNOSTIC_RETENTION_DAYS * DAY_MS);
}

export function diagnosticRetentionWhere(now = new Date()): { entityType: typeof DIAGNOSTIC_ENTITY_TYPE; createdAt: { gte: Date } } {
    return {
        entityType: DIAGNOSTIC_ENTITY_TYPE,
        createdAt: { gte: diagnosticCutoff(now) },
    };
}

export function isSafeDiagnosticId(value: unknown): value is string {
    return typeof value === "string" && SAFE_ID.test(value);
}

function safeId(value: unknown): string | undefined {
    if (!isSafeDiagnosticId(value)) return undefined;
    return value.slice(0, MAX_ID_LENGTH);
}

export function boundedDiagnosticEventName(value: unknown): string {
    const input = typeof value === "string" ? value.trim() : "";
    if (SAFE_EVENT_NAME.test(input)) return input;
    const normalized = input.replace(/[^A-Za-z0-9_.:-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
    return SAFE_EVENT_NAME.test(normalized) ? normalized : "DIAGNOSTIC_EVENT";
}

function safeLevel(value: unknown): DiagnosticLevel {
    return typeof value === "string" && (LEVELS as readonly string[]).includes(value)
        ? value as DiagnosticLevel
        : "INFO";
}

function fallbackError(value: unknown): string {
    if (value instanceof Error) return redactDiagnosticText(value.message, 256);
    if (typeof value === "string") return redactDiagnosticText(value, 256);
    return "Diagnostic storage failure";
}

function emitStorageFallback(event: {
    correlationId?: string;
    category?: unknown;
    level?: unknown;
    message?: unknown;
    storageError?: unknown;
}): void {
    const payload = {
        event: "diagnostic_storage_failure",
        entityType: DIAGNOSTIC_ENTITY_TYPE,
        correlationId: safeId(event.correlationId) ?? "invalid",
        action: boundedDiagnosticEventName(event.category),
        level: safeLevel(event.level),
        message: redactDiagnosticText(typeof event.message === "string" ? event.message : "Diagnostic event could not be persisted", 256),
        storageError: fallbackError(event.storageError),
    };
    // console.error is the server stderr sink. Keep this one structured and
    // bounded; do not add an in-memory retry queue or log buffer.
    try {
        console.error(JSON.stringify(payload));
    } catch {
        console.error("{\"event\":\"diagnostic_storage_failure\",\"message\":\"unavailable\"}");
    }
}

/**
 * Persist one redacted diagnostic event. This function deliberately never
 * throws: diagnostics must not break the user-facing request path.
 */
export async function recordDiagnostic(event: DiagnosticEvent, db: DiagnosticDatabase = prisma): Promise<void> {
    const correlationId = safeId(event?.correlationId);
    const action = boundedDiagnosticEventName(event?.category);
    const level = safeLevel(event?.level);
    const actorId = safeId(event?.actorId);
    const conversationId = safeId(event?.conversationId);
    const message = redactDiagnosticText(typeof event?.message === "string" ? event.message : "Diagnostic event", 1_000);

    if (!correlationId) {
        emitStorageFallback({ correlationId: event?.correlationId, category: action, level, message, storageError: "Invalid correlation id" });
        return;
    }

    const metadata = event?.metadata === undefined ? undefined : redactDiagnosticPayload(event.metadata);
    const payload = {
        correlationId,
        ...(actorId ? { actorId } : {}),
        ...(conversationId ? { conversationId } : {}),
        category: action,
        level,
        message,
        ...(metadata === undefined ? {} : { metadata }),
    };

    try {
        if (!db?.auditLog?.create) throw new Error("Diagnostic AuditLog storage unavailable");
        await db.auditLog.create({
            data: {
                entityType: DIAGNOSTIC_ENTITY_TYPE,
                entityId: correlationId,
                action,
                actorId,
                metaJson: serializeDiagnosticMetadata(payload),
            },
        });
    } catch (storageError) {
        emitStorageFallback({ correlationId, category: action, level, message, storageError });
    }
}

/**
 * Explicit, operator-invoked cleanup for this namespace only. There is no
 * automated purge claim: callers must invoke this function deliberately.
 */
export async function pruneDiagnosticLogs(
    db: DiagnosticDatabase = prisma,
    now = new Date(),
): Promise<{ count: number }> {
    return db.auditLog.deleteMany({
        where: {
            entityType: DIAGNOSTIC_ENTITY_TYPE,
            createdAt: { lt: diagnosticCutoff(now) },
        },
    });
}
