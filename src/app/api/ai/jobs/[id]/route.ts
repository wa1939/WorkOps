import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSabahActor } from "@/lib/sabah/auth/actor";

export const dynamic = "force-dynamic";
const validId = (id: string) => /^[A-Za-z0-9:_./-]{1,160}$/.test(id);
const safeJsonSummary = (value: string | null): unknown => {
    if (!value) return null;
    try {
        const parsed: unknown = JSON.parse(value);
        if (typeof parsed === "string") return parsed.slice(0, 512);
        if (parsed === null || typeof parsed === "number" || typeof parsed === "boolean") return parsed;
        return { present: true };
    } catch { return { present: true }; }
};
const safeError = (value: string | null): string | null => value ? value.replace(/[\u0000-\u001f\u007f]/g, "_").replace(/(secret|token|password|key|credential)[^\s]*/gi, "$1=[REDACTED]").slice(0, 512) : null;
type JobIdentity = { workflowKey: string; stepKey: string; entityKey: string; correlationId: string };
const identityValue = (value: unknown, fallback: string): string => typeof value === "string" && /^[A-Za-z0-9:_./-]{1,160}$/.test(value) ? value : fallback;
function jobIdentity(payloadJson: string | null, workflowId: string | null, stepId: string | null, jobId: string): JobIdentity {
    let payload: Record<string, unknown> = {};
    if (payloadJson) {
        try {
            const parsed: unknown = JSON.parse(payloadJson);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) payload = Object.fromEntries(Object.entries(parsed));
        } catch { /* identity falls back to persisted IDs */ }
    }
    return {
        workflowKey: identityValue(payload.workflowKey, workflowId ?? jobId),
        stepKey: identityValue(payload.stepKey, stepId ?? "workflow-step"),
        entityKey: identityValue(payload.entityKey, jobId),
        correlationId: identityValue(payload.correlationId, workflowId ?? jobId),
    };
}

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let actor;
    try { actor = await toSabahActor(session.user); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
    if (!validId(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
        const row = await prisma.aiJob.findUnique({ where: { id: params.id, actorId: actor.id }, select: {
            id: true, type: true, status: true, priority: true, actorId: true, workflowId: true, stepId: true, payloadJson: true, checkpointJson: true, leaseOwner: true,
            retryCount: true, maxAttempts: true, nextAttemptAt: true, leaseUntil: true, canceledAt: true, cancelRequestedAt: true,
            createdAt: true, updatedAt: true, resultJson: true, errorJson: true,
            attempts: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, attemptNumber: true, status: true, workerId: true, leasedAt: true, startedAt: true, finishedAt: true, createdAt: true, checkpointJson: true, errorJson: true } },
        } });
        if (!row || row.actorId !== actor.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
        const resultJson = row.resultJson;
        const errorJson = row.errorJson;
        const identity = jobIdentity(row.payloadJson, row.workflowId, row.stepId, row.id);
        const projectedStatus = row.checkpointJson && ["LEASED", "RUNNING"].includes(row.status) ? "CHECKPOINTED" : row.status;
        return NextResponse.json({ id: row.id, type: row.type, status: projectedStatus, priority: row.priority, actorId: row.actorId, workflowId: row.workflowId, stepId: row.stepId, retryCount: row.retryCount, maxAttempts: row.maxAttempts, nextAttemptAt: row.nextAttemptAt, leaseOwner: row.leaseOwner, leaseUntil: row.leaseUntil, canceledAt: row.canceledAt, cancelRequestedAt: row.cancelRequestedAt, checkpoint: safeJsonSummary(row.checkpointJson), createdAt: row.createdAt, updatedAt: row.updatedAt, resultSummary: safeJsonSummary(resultJson), error: safeError(errorJson), attempts: row.attempts.map((attempt) => ({ id: attempt.id, attemptNumber: attempt.attemptNumber, status: attempt.status, workerId: attempt.workerId, leasedAt: attempt.leasedAt, startedAt: attempt.startedAt, finishedAt: attempt.finishedAt, createdAt: attempt.createdAt, workflowKey: identity.workflowKey, stepKey: identity.stepKey, entityKey: `${identity.entityKey}:${attempt.attemptNumber}`, correlationId: identity.correlationId, checkpointed: attempt.checkpointJson !== null, error: safeError(attempt.errorJson) })) });
    } catch { return NextResponse.json({ error: "Job unavailable" }, { status: 500 }); }
}
