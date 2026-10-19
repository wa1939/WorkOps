import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { redactSabahPayload } from "./redact";

type SabahLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SECURITY";
type SabahLogCategory = "RETRIEVAL" | "PLANNING" | "CAPABILITY" | "PROVIDER" | "EXTRACTION" | "JOB" | "SECURITY";

export type SabahLogEvent = {
    level: SabahLogLevel;
    category: SabahLogCategory;
    message: string;
    correlationId: string;
    conversationId?: string;
    workflowId?: string;
    stepId?: string;
    actorId?: string;
    metadata?: unknown;
    expiresAt: Date;
};

type LogDatabase = Pick<PrismaClient, "aiOperationalLog" | "aiWorkflowEvent">;

/**
 * Writes an operational log entry to AiOperationalLog with redacted metadata.
 *
 * Operational logs store redacted structured context for debugging and monitoring.
 * These logs have configurable retention via expiresAt.
 *
 * @param event - The Sabah log event to persist
 * @param db - Prisma database handle
 */
export async function writeOperationalLog(
    event: SabahLogEvent,
    db: LogDatabase = prisma,
): Promise<void> {
    const redactedMetadata = event.metadata ? redactSabahPayload(event.metadata) : null;

    await db.aiOperationalLog.create({
        data: {
            workflowId: event.workflowId ?? "unknown",
            category: event.category,
            level: event.level,
            message: event.message,
            correlationId: event.correlationId,
            metadataJson: redactedMetadata ? JSON.stringify(redactedMetadata) : null,
            expiresAt: event.expiresAt,
        },
    });
}

/**
 * Writes a user activity event to AiWorkflowEvent.
 *
 * Activity events store approved plain-language summaries for audit trails.
 * These are user-facing activities requiring traceability.
 *
 * @param event - The Sabah log event to persist
 * @param db - Prisma database handle
 */
export async function writeActivityEvent(
    event: SabahLogEvent,
    db: LogDatabase = prisma,
): Promise<void> {
    const activityMetadata = {
        conversationId: event.conversationId,
        actorId: event.actorId,
        correlationId: event.correlationId,
    };

    await db.aiWorkflowEvent.create({
        data: {
            workflowId: event.workflowId ?? "unknown",
            stepId: event.stepId,
            eventType: "USER_ACTIVITY",
            level: event.level,
            message: event.message,
            metadataJson: JSON.stringify(activityMetadata),
        },
    });
}

/**
 * Writes a capability audit event to AiWorkflowEvent with full audit fields.
 *
 * Durable audit retains actor/action/entity/diff/approval/verification/undo information
 * and calls the existing AuditLog path for long-term audit trail.
 *
 * @param event - The Sabah log event to persist
 * @param db - Prisma database handle
 */
export async function writeCapabilityAudit(
    event: SabahLogEvent,
    db: LogDatabase = prisma,
): Promise<void> {
    const redactedMetadata = event.metadata ? redactSabahPayload(event.metadata) : null;

    await db.aiWorkflowEvent.create({
        data: {
            workflowId: event.workflowId ?? "unknown",
            stepId: event.stepId,
            eventType: "CAPABILITY_AUDIT",
            level: event.level,
            message: event.message,
            metadataJson: redactedMetadata ? JSON.stringify(redactedMetadata) : null,
        },
    });
}
