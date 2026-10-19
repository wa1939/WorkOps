import type { Prisma } from "@prisma/client";

export type PmoAuditScalar = string | number | boolean | null;
export type PmoAuditChanges = Record<
    string,
    PmoAuditScalar | readonly string[]
>;
export type PmoAuditInput = {
    entityType:
        | "work_area"
        | "external_contact"
        | "external_action"
        | "action_evidence"
        | "follow_up_event";
    entityId: string;
    action: string;
    actorId: string;
    taskId?: string;
    changes?: PmoAuditChanges;
};

const FORBIDDEN_METADATA_KEY_PARTS = [
    "email",
    "recipient",
    "body",
    "url",
    "prompt",
    "secret",
    "token",
    "password",
    "credential",
] as const;

export async function writePmoAudit(
    tx: Prisma.TransactionClient,
    input: PmoAuditInput,
): Promise<void> {
    for (const key of Object.keys(input.changes ?? {})) {
        const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (
            FORBIDDEN_METADATA_KEY_PARTS.some((part) =>
                normalizedKey.includes(part),
            )
        ) {
            throw new Error(`Unsafe PMO audit metadata key: ${key}`);
        }
    }

    await tx.auditLog.create({
        data: {
            entityType: input.entityType,
            entityId: input.entityId,
            action: input.action,
            actorId: input.actorId,
            taskId: input.taskId,
            metaJson: input.changes
                ? JSON.stringify(input.changes)
                : undefined,
        },
    });
}
