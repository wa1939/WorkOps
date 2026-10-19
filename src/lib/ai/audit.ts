import { prisma } from "@/lib/prisma";

type LogOpts = {
    userId: string;
    tool: string;
    params: unknown;
    result: "ok" | "error";
    entityId?: string;
    entityType?: string;
    error?: string;
};

export async function logAiAction(opts: LogOpts): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                entityType: opts.entityType ?? "ai-chat",
                entityId: opts.entityId ?? `chat-${Date.now()}`,
                action: `ai:${opts.tool}`,
                actorId: opts.userId,
                metaJson: JSON.stringify({
                    source: "ai-chat",
                    tool: opts.tool,
                    params: opts.params,
                    result: opts.result,
                    error: opts.error,
                }),
            },
        });
    } catch (e) {
        console.error("Failed to write AI audit log:", e);
    }
}

type CapabilityAuditOpts = {
    userId: string;
    action: string;
    entity?: string;
    diff?: Record<string, unknown>;
    approval?: boolean;
    verification?: string;
    undo?: boolean;
    error?: string;
};

export async function logCapabilityAudit(opts: CapabilityAuditOpts): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                entityType: opts.entity ?? "capability",
                entityId: `capability-${opts.action}-${Date.now()}`,
                action: `capability:${opts.action}`,
                actorId: opts.userId,
                metaJson: JSON.stringify({
                    source: "sabah-capability",
                    action: opts.action,
                    entity: opts.entity,
                    diff: opts.diff,
                    approval: opts.approval,
                    verification: opts.verification,
                    undo: opts.undo,
                    error: opts.error,
                }),
            },
        });
    } catch (e) {
        console.error("Failed to write capability audit log:", e);
    }
}

type ReportFinalizationAuditOpts = {
    userId: string;
    reportId: string;
    outcome: "ACCEPTED" | "EDITED";
    draftHash: string;
    finalHash: string;
    memoKey: string;
    memoHash?: string;
    learnRequested?: boolean;
    learned: boolean;
};

/**
 * Record and verify the explicit approval attached to a report final edit.
 * Only bounded hashes and governance metadata are persisted, never report text.
 */
export async function logReportFinalizationApproval(opts: ReportFinalizationAuditOpts): Promise<string | null> {
    try {
        const row = await prisma.auditLog.create({
            data: {
                entityType: "weekly_report",
                entityId: opts.reportId,
                action: "capability:reports.finalize",
                actorId: opts.userId,
                metaJson: JSON.stringify({
                    source: "report-final-edit",
                    action: "FINALIZE",
                    approval: true,
                    scope: "PERSONAL",
                    ownerId: opts.userId,
                    reportId: opts.reportId,
                    memoKey: opts.memoKey,
                    outcome: opts.outcome,
                    draftHash: opts.draftHash,
                    finalHash: opts.finalHash,
                    memoHash: opts.memoHash,
                    learnRequested: opts.learnRequested,
                    learned: opts.learned,
                }),
            },
        });
        const readBack = await prisma.auditLog.findUnique({ where: { id: row.id } });
        if (!readBack || readBack.id !== row.id || readBack.entityType !== "weekly_report" || readBack.entityId !== opts.reportId || readBack.action !== "capability:reports.finalize" || readBack.actorId !== opts.userId) return null;
        return row.id;
    } catch {
        return null;
    }
}
