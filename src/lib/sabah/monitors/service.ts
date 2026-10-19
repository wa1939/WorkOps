import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { MonitorActor, MonitorDefinition, MonitorEvidence, MonitorReader, MonitorRunContext, MonitorScope, MonitorSource, MonitorState, MonitorSuggestion, MonitorStore } from "./contracts";
export type { MonitorReader, MonitorStore } from "./contracts";
import { MONITOR_DEFINITIONS } from "./definitions";
import { fingerprintEvidence, readMonitorEvidence, type MonitorDatabase, type MonitorEvidenceItem, type MonitorRecord } from "./readers";

export const MAX_MONITORS = 7;
const MAX_ITEMS = 50;
const MAX_ID = 100;
const MAX_TEXT = 500;
const MAX_FINGERPRINT = 200;
const MAX_SKEW_MS = 5 * 60 * 1000;
const FRESHNESS_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_COOLDOWN_FUTURE_MS = 7 * 24 * 60 * 60 * 1000;
export class MonitorError extends Error { constructor(public readonly code: "SCOPE_UNAVAILABLE" | "FORBIDDEN" | "STALE_EVIDENCE" | "INVALID_INPUT" | "DATA_INVALID", message = code) { super(message); } }
const validText = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max && !/[\r\n\t]/.test(value);
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const parseDate = (value: unknown): number | null => { if (typeof value !== "string") return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : null; };
const validScope = (scope: unknown): scope is MonitorScope => typeof scope === "object" && scope !== null && (((scope as MonitorScope).type === "TEAM") || ((scope as MonitorScope).type === "WORKSPACE")) && validText((scope as MonitorScope).id, MAX_ID);
const sameScope = (a: MonitorScope, b: MonitorScope) => a.type === b.type && a.id === b.id;
const validateContext = (context: MonitorRunContext) => { if (!validText(context.actor.id, MAX_ID) || !validText(context.actor.teamId, MAX_ID) || !validScope(context.scope) || !validDate(context.now) || !context.store) throw new MonitorError("INVALID_INPUT"); if (context.scope.type === "TEAM" && context.scope.id !== context.actor.teamId) throw new MonitorError("INVALID_INPUT"); };
const validateSource = (source: unknown): source is MonitorSource => { if (typeof source !== "object" || source === null) return false; const item = source as MonitorSource; return validText(item.id, MAX_ID) && validText(item.kind, MAX_TEXT) && validText(item.label, MAX_TEXT) && validText(item.summary, MAX_TEXT) && validText(item.fingerprint, MAX_FINGERPRINT) && typeof item.authorized === "boolean" && parseDate(item.updatedAt) !== null; };
const validateEvidence = (evidence: unknown, source: MonitorSource, now: Date): evidence is MonitorEvidence => { if (typeof evidence !== "object" || evidence === null) return false; const item = evidence as MonitorEvidence; const observed = parseDate(item.observedAt); return item.sourceId === source.id && validText(item.snippet, MAX_TEXT) && validText(item.fingerprint, MAX_FINGERPRINT) && item.fingerprint === source.fingerprint && observed !== null && observed >= now.getTime() - FRESHNESS_MS && observed <= now.getTime() + MAX_SKEW_MS; };
const validateSuggestion = (value: unknown, actor: MonitorActor, scope: MonitorScope, monitorKey?: string, now = new Date(), fingerprint?: string, currentEvidence?: readonly MonitorEvidence[]): value is MonitorSuggestion => { if (typeof value !== "object" || value === null) return false; const suggestion = value as MonitorSuggestion; const cooldown = parseDate(suggestion.cooldownUntil); const snoozed = suggestion.snoozedUntil === undefined ? null : parseDate(suggestion.snoozedUntil); const dismissed = suggestion.dismissedAt === undefined ? null : parseDate(suggestion.dismissedAt); const validOptionalDate = (parsed: number | null, present: boolean) => !present || (parsed !== null && parsed <= now.getTime() + MAX_COOLDOWN_FUTURE_MS); const validStoredEvidence = (item: unknown) => { try { if (typeof item !== "object" || item === null) return false; const stored = item as MonitorEvidence; const observed = parseDate(stored.observedAt); return validText(stored.sourceId, MAX_ID) && validText(stored.snippet, MAX_TEXT) && validText(stored.fingerprint, MAX_FINGERPRINT) && observed !== null && observed >= now.getTime() - FRESHNESS_MS && observed <= now.getTime() + MAX_SKEW_MS; } catch { return false; } }; const hasEvidenceArray = Array.isArray(suggestion.evidence); const validEvidenceArray = hasEvidenceArray && suggestion.evidence.length <= MAX_ITEMS && suggestion.evidence.every(validStoredEvidence); const linkedEvidence = !validEvidenceArray ? false : currentEvidence === undefined || (suggestion.evidence.length === new Set(suggestion.evidence.map((item) => `${item.sourceId}:${item.fingerprint}`)).size && suggestion.evidence.every((item) => currentEvidence.some((current) => current.sourceId === item.sourceId && current.fingerprint === item.fingerprint))); return validText(suggestion.id, MAX_TEXT) && (monitorKey === undefined || suggestion.monitorKey === monitorKey) && suggestion.actorId === actor.id && validScope(suggestion.scope) && sameScope(suggestion.scope, scope) && validText(suggestion.fingerprint, MAX_FINGERPRINT) && (fingerprint === undefined || suggestion.fingerprint === fingerprint) && ["OPEN", "SNOOZED", "DISMISSED"].includes(suggestion.state) && ["INFO", "WARNING", "CRITICAL"].includes(suggestion.severity) && validText(suggestion.title, 80) && validText(suggestion.summary, 300) && validEvidenceArray && linkedEvidence && cooldown !== null && cooldown >= now.getTime() - FRESHNESS_MS && validOptionalDate(cooldown, true) && validOptionalDate(snoozed, suggestion.snoozedUntil !== undefined) && validOptionalDate(dismissed, suggestion.dismissedAt !== undefined) && (suggestion.state !== "SNOOZED" || snoozed !== null) && (suggestion.state !== "DISMISSED" || dismissed !== null); };

export async function evaluateMonitor(definition: MonitorDefinition, context: MonitorRunContext): Promise<{ suggestion: MonitorSuggestion | null; evidence: MonitorEvidence[]; fingerprint: string; created: boolean }> {
    validateContext(context);
    const { actor, scope, reader, store, now } = context;
    if (!reader || definition.query.scope !== "TEAM/WORKSPACE" || !(await reader.authorize(actor, scope))) throw new MonitorError("SCOPE_UNAVAILABLE");
    const sources = await reader.read(scope, definition.query.maxItems);
    if (!Array.isArray(sources) || sources.length > MAX_ITEMS) throw new MonitorError("DATA_INVALID");
    const seen = new Set<string>();
    const freshnessCutoff = now.getTime() - FRESHNESS_MS;
    const usable = sources.filter((source) => { if (!validateSource(source) || seen.has(source.id) || !source.authorized) return false; seen.add(source.id); const updated = Date.parse(source.updatedAt); return updated >= freshnessCutoff && updated <= now.getTime() + MAX_SKEW_MS; });
    if (seen.size !== sources.length) throw new MonitorError("DATA_INVALID");
    const evidence = usable.slice(0, definition.query.maxItems).map((source) => { const built = definition.evidenceBuilder(source, now, definition.query.maxSnippetLength); if (!validateEvidence(built, source, now)) throw new MonitorError("DATA_INVALID"); return built; });
    if (evidence.length === 0) { await store.saveState(definition.key, scope, { fingerprint: "", lastRunAt: now }); return { suggestion: null, evidence, fingerprint: "", created: false }; }
    const stableFingerprint = definition.fingerprint(evidence);
    if (!validText(stableFingerprint, MAX_FINGERPRINT)) throw new MonitorError("DATA_INVALID");
    const prior = await store.getState(definition.key, scope);
    if (prior && (!validText(prior.fingerprint, MAX_FINGERPRINT) || !validDate(prior.lastRunAt) || prior.lastRunAt.getTime() > now.getTime() + MAX_SKEW_MS)) throw new MonitorError("DATA_INVALID");
    await store.saveState(definition.key, scope, { fingerprint: stableFingerprint, lastRunAt: now });
    if (prior && prior.fingerprint !== stableFingerprint && now.getTime() - prior.lastRunAt.getTime() < definition.cooldownMs) return { suggestion: null, evidence, fingerprint: stableFingerprint, created: false };
    const suggestion: MonitorSuggestion = { id: `${definition.key}:${stableFingerprint}`, monitorKey: definition.key, fingerprint: stableFingerprint, state: "OPEN", severity: definition.severity, title: bounded(definition.name, 80), summary: bounded(`${definition.summary} Suggested review: ${definition.allowedSuggestions.join(", ")}`, 300), evidence, scope, actorId: actor.id, cooldownUntil: new Date(now.getTime() + definition.cooldownMs).toISOString() };
    const existing = await store.findSuggestion(definition.key, stableFingerprint, scope);
    if (existing !== undefined && !validateSuggestion(existing, actor, scope, definition.key, now, stableFingerprint, evidence)) throw new MonitorError("DATA_INVALID");
    if (existing) return { suggestion: existing, evidence, fingerprint: stableFingerprint, created: false };
    const saved = await store.saveSuggestion(suggestion);
    if (!validateSuggestion(saved, actor, scope, definition.key, now, stableFingerprint)) throw new MonitorError("DATA_INVALID");
    return { suggestion: saved, evidence, fingerprint: stableFingerprint, created: true };
}
const bounded = (value: string, max: number) => value.replace(/[\r\n\t]+/g, " ").slice(0, max);
export async function runMonitors(input: MonitorRunContext): Promise<{ evaluated: number; created: number; suppressed: number; errors: number }> {
    validateContext(input); const requested = input.maxMonitors ?? MAX_MONITORS;
    if (!Number.isInteger(requested) || requested < 0 || requested > MAX_MONITORS) throw new MonitorError("INVALID_INPUT");
    const definitions = MONITOR_DEFINITIONS.slice(0, requested);
    let evaluated = 0; let created = 0; let suppressed = 0; let errors = 0;
    for (const definition of definitions) { try { const result = await evaluateMonitor(definition, input); evaluated += 1; if (!result.suggestion || !result.created) suppressed += 1; else created += 1; } catch { errors += 1; } }
    return { evaluated, created, suppressed, errors };
}
async function mutate(store: MonitorStore, id: string, state: "SNOOZED" | "DISMISSED", context: { actor: MonitorActor; scope: MonitorScope }): Promise<MonitorSuggestion> { if (!validText(id, MAX_TEXT) || !validText(context.actor.id, MAX_ID) || !validText(context.actor.teamId, MAX_ID) || !validScope(context.scope)) throw new MonitorError("INVALID_INPUT"); if (context.scope.type === "TEAM" && context.scope.id !== context.actor.teamId) throw new MonitorError("FORBIDDEN"); let target: unknown; try { target = await store.getSuggestion(id, context.scope); } catch { throw new MonitorError("FORBIDDEN"); } if (!validateSuggestion(target, context.actor, context.scope)) throw new MonitorError("FORBIDDEN"); let result: unknown; try { result = await store.updateSuggestionState(id, state, context.actor, context.scope); } catch { throw new MonitorError("FORBIDDEN"); } if (!validateSuggestion(result, context.actor, context.scope) || result.state !== state) throw new MonitorError("DATA_INVALID"); return result; }
export const snoozeSuggestion = (store: MonitorStore, id: string, context: { actor: MonitorActor; scope: MonitorScope }) => mutate(store, id, "SNOOZED", context);
export const dismissSuggestion = (store: MonitorStore, id: string, context: { actor: MonitorActor; scope: MonitorScope }) => mutate(store, id, "DISMISSED", context);
export { sameScope };

export type DurableMonitorRunOptions = {
    db?: MonitorDatabase;
    now?: Date;
};

export type DurableMonitorOutcome = {
    monitorId: string;
    key: string;
    status: "created" | "suppressed" | "error";
    created: boolean;
    suppressed: boolean;
    evidenceCount: number;
    fingerprint?: string;
};

export type DurableMonitorRunResult = {
    evaluated: number;
    created: number;
    suppressed: number;
    errors: number;
    outcomes: DurableMonitorOutcome[];
};

const DURABLE_MONITOR_MAX_BATCH = 100;
const DURABLE_MONITOR_DEFAULT_BATCH = 10;
const MONITOR_JOB_WORKER = "sabah-monitor-runtime-v1";

type MonitorEnvelope = {
    workspaceId?: string;
    userId?: string;
};

type MonitorStateRow = {
    sourceFingerprint: string | null;
    nextRunAt: Date | null;
};

type StartedMonitorJob = {
    id: string;
    attemptId: string | null;
};

function monitorEnvelope(monitor: MonitorRecord): MonitorEnvelope {
    try {
        const parsed = JSON.parse(monitor.definitionJson) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const value = parsed as Record<string, unknown>;
        const id = (candidate: unknown) => typeof candidate === "string" && candidate.length > 0 && candidate.length <= 160 ? candidate : undefined;
        return {
            workspaceId: id(value.workspaceId ?? value.workspace),
            userId: id(value.userId ?? value.subjectUserId ?? value.actorId) ?? (typeof monitor.createdById === "string" ? monitor.createdById : undefined),
        };
    } catch {
        return { userId: typeof monitor.createdById === "string" ? monitor.createdById : undefined };
    }
}

function isValidDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

function monitorScope(monitor: MonitorRecord): "TEAM" | "WORKSPACE" {
    return monitor.scope === "WORKSPACE" ? "WORKSPACE" : "TEAM";
}

async function hasActiveMembership(db: MonitorDatabase, monitor: MonitorRecord, envelope: MonitorEnvelope): Promise<boolean> {
    if (monitorScope(monitor) !== "WORKSPACE" || !envelope.workspaceId || !envelope.userId) return monitorScope(monitor) !== "WORKSPACE";
    const membership = await db.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: envelope.workspaceId, userId: envelope.userId } },
        select: { active: true, workspace: { select: { archivedAt: true } } },
    });
    return membership?.active === true && membership.workspace.archivedAt === null;
}

function wireEvidence(evidence: readonly MonitorEvidenceItem[]): Array<Record<string, unknown>> {
    return evidence.map((item) => ({
        monitorId: item.monitorId,
        kind: item.kind,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        version: item.version,
        fingerprint: item.fingerprint,
        dueAt: item.dueAt?.toISOString() ?? null,
        observedAt: item.observedAt.toISOString(),
        details: item.details,
    }));
}

function resultJson(outcome: DurableMonitorOutcome): string {
    return JSON.stringify({
        monitorId: outcome.monitorId,
        monitorKey: outcome.key,
        status: outcome.status,
        created: outcome.created,
        suppressed: outcome.suppressed,
        evidenceCount: outcome.evidenceCount,
        fingerprint: outcome.fingerprint ?? null,
    });
}

async function startMonitorJob(
    db: MonitorDatabase,
    monitor: MonitorRecord,
    envelope: MonitorEnvelope,
    fingerprint: string,
    sourceIds: readonly string[],
    now: Date,
): Promise<StartedMonitorJob> {
    const idempotencyKey = `monitor:${monitor.id}:${fingerprint || "empty"}`;
    const payloadJson = JSON.stringify({
        monitorId: monitor.id,
        monitorKey: monitor.key,
        workspaceId: envelope.workspaceId ?? null,
        userId: envelope.userId ?? null,
        evidenceFingerprint: fingerprint || null,
        sourceIds: sourceIds.slice(0, MAX_ITEMS),
        observedAt: now.toISOString(),
    });
    let job = await db.aiJob.findUnique({ where: { idempotencyKey } });
    if (!job) {
        try {
            job = await db.aiJob.create({
                data: {
                    type: "MONITOR",
                    status: "RUNNING",
                    priority: "MEDIUM",
                    idempotencyKey,
                    actorId: envelope.userId ?? null,
                    workflowId: null,
                    stepId: null,
                    payloadJson,
                    checkpointJson: null,
                    leaseOwner: MONITOR_JOB_WORKER,
                    leaseToken: crypto.randomUUID(),
                    leaseUntil: new Date(now.getTime() + 60_000),
                    heartbeatAt: now,
                    retryCount: 1,
                    maxAttempts: 3,
                    nextAttemptAt: null,
                    canceledAt: null,
                    cancelRequestedAt: null,
                    resultJson: null,
                    errorJson: null,
                },
            });
        } catch (error) {
            const raced = await db.aiJob.findUnique({ where: { idempotencyKey } });
            if (!raced) throw error;
            job = raced;
        }
    }

    if (job.status === "SUCCEEDED") return { id: job.id, attemptId: null };

    const attemptNumber = Math.max(1, job.retryCount || 1);
    if (job.status !== "RUNNING") {
        job = await db.aiJob.update({
            where: { id: job.id },
            data: {
                status: "RUNNING",
                retryCount: { increment: 1 },
                payloadJson,
                errorJson: null,
                leaseOwner: MONITOR_JOB_WORKER,
                leaseToken: crypto.randomUUID(),
                leaseUntil: new Date(now.getTime() + 60_000),
                heartbeatAt: now,
            },
        });
    }
    const attempt = await db.aiJobAttempt.create({
        data: {
            jobId: job.id,
            attemptNumber,
            workerId: MONITOR_JOB_WORKER,
            leaseToken: job.leaseToken,
            leasedAt: now,
            startedAt: now,
            finishedAt: null,
            status: "RUNNING",
            checkpointJson: null,
            resultJson: null,
            errorJson: null,
        },
    });
    return { id: job.id, attemptId: attempt.id };
}

async function finishMonitorJob(db: MonitorDatabase, job: StartedMonitorJob, outcome: DurableMonitorOutcome, now: Date): Promise<void> {
    await db.aiJob.update({
        where: { id: job.id },
        data: {
            status: "SUCCEEDED",
            resultJson: resultJson(outcome),
            leaseOwner: null,
            leaseToken: null,
            leaseUntil: null,
            heartbeatAt: now,
        },
    });
    if (job.attemptId) {
        await db.aiJobAttempt.update({
            where: { id: job.attemptId },
            data: { status: "SUCCEEDED", finishedAt: now, resultJson: resultJson(outcome) },
        });
    }
}

async function failMonitorJob(db: MonitorDatabase, job: StartedMonitorJob, error: unknown, now: Date): Promise<void> {
    const message = error instanceof Error ? error.message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 512) : "monitor failed";
    await db.aiJob.update({
        where: { id: job.id },
        data: { status: "FAILED", errorJson: JSON.stringify(message), leaseOwner: null, leaseToken: null, leaseUntil: null, heartbeatAt: now },
    }).catch(() => undefined);
    if (job.attemptId) await db.aiJobAttempt.update({ where: { id: job.attemptId }, data: { status: "FAILED", finishedAt: now, errorJson: JSON.stringify(message) } }).catch(() => undefined);
}

function stateData(monitor: MonitorRecord, fingerprint: string, now: Date): { lastRunAt: Date; sourceFingerprint: string; nextRunAt: Date } {
    const definition = MONITOR_DEFINITIONS.find((candidate) => candidate.key === monitor.key);
    return {
        lastRunAt: now,
        sourceFingerprint: fingerprint,
        nextRunAt: new Date(now.getTime() + (definition?.cooldownMs ?? 60 * 60 * 1000)),
    };
}

async function saveMonitorState(db: MonitorDatabase, monitorId: string, data: ReturnType<typeof stateData>): Promise<void> {
    await db.aiMonitorState.upsert({
        where: { monitorId },
        create: { monitorId, ...data, lastError: null },
        update: { ...data, lastError: null },
    });
}

function suggestionEvidenceJson(monitor: MonitorRecord, envelope: MonitorEnvelope, fingerprint: string, evidence: readonly MonitorEvidenceItem[]): string {
    return JSON.stringify({
        monitorId: monitor.id,
        monitorKey: monitor.key,
        workspaceId: envelope.workspaceId ?? null,
        userId: envelope.userId ?? null,
        fingerprint,
        sourceIds: evidence.map((item) => item.sourceId),
        items: wireEvidence(evidence),
    });
}

export async function runMonitor(monitorId: string, options: DurableMonitorRunOptions = {}): Promise<DurableMonitorOutcome & { jobId?: string }> {
    const db = options.db ?? prisma;
    const now = options.now ?? new Date();
    if (!isValidDate(now) || typeof monitorId !== "string" || monitorId.length === 0) throw new Error("Invalid monitor run input");
    const monitor = await db.aiMonitor.findUnique({ where: { id: monitorId }, include: { state: true } });
    if (!monitor) return { monitorId, key: "unknown", status: "suppressed", created: false, suppressed: true, evidenceCount: 0 };
    const definition = MONITOR_DEFINITIONS.find((candidate) => candidate.key === monitor.key);
    if (!monitor.enabled || monitor.status !== "ACTIVE" || !definition) return { monitorId, key: monitor.key, status: "suppressed", created: false, suppressed: true, evidenceCount: 0 };
    const envelope = monitorEnvelope(monitor);
    if (!(await hasActiveMembership(db, monitor, envelope))) return { monitorId, key: monitor.key, status: "suppressed", created: false, suppressed: true, evidenceCount: 0 };

    let job: StartedMonitorJob | undefined;
    try {
        const evidence = await readMonitorEvidence(db, monitor, now);
        const fingerprint = evidence.length > 0 ? fingerprintEvidence(evidence) : "";
        job = await startMonitorJob(db, monitor, envelope, fingerprint, evidence.map((item) => item.sourceId), now);
        const prior = monitor.state as MonitorStateRow | null;
        const existing = fingerprint
            ? await db.aiSuggestion.findUnique({ where: { monitorId_fingerprint: { monitorId: monitor.id, fingerprint } } })
            : null;
        const unchanged = prior?.sourceFingerprint === fingerprint;
        if (evidence.length === 0 || unchanged || existing) {
            await saveMonitorState(db, monitor.id, stateData(monitor, fingerprint, now));
            const outcome: DurableMonitorOutcome = { monitorId: monitor.id, key: monitor.key, status: "suppressed", created: false, suppressed: true, evidenceCount: evidence.length, fingerprint: fingerprint || undefined };
            await finishMonitorJob(db, job, outcome, now);
            return { ...outcome, jobId: job.id };
        }

        if (!fingerprint) throw new Error("Monitor evidence fingerprint required");
        const suggestion = await db.aiSuggestion.create({
            data: {
                monitorId: monitor.id,
                fingerprint,
                severity: definition.severity,
                title: definition.name.slice(0, 255),
                summary: `${definition.summary} Suggested review: ${definition.allowedSuggestions.join(", ")}`.slice(0, 4_000),
                evidenceJson: suggestionEvidenceJson(monitor, envelope, fingerprint, evidence),
                state: "OPEN",
                snoozedUntil: null,
                dismissedAt: null,
                cooldownUntil: new Date(now.getTime() + definition.cooldownMs),
                actorId: envelope.userId ?? null,
                scope: monitorScope(monitor),
            },
        });
        await saveMonitorState(db, monitor.id, stateData(monitor, fingerprint, now));
        const outcome: DurableMonitorOutcome = { monitorId: monitor.id, key: monitor.key, status: "created", created: true, suppressed: false, evidenceCount: evidence.length, fingerprint };
        await finishMonitorJob(db, job, outcome, now);
        return { ...outcome, jobId: job.id };
    } catch (error) {
        if (job) await failMonitorJob(db, job, error, now);
        throw error;
    }
}

function durableBatchSize(value?: number): number {
    const configured = value ?? Number.parseInt(process.env.SABAH_MONITORS_BATCH_SIZE ?? process.env.SABAH_MONITOR_BATCH_SIZE ?? "", 10);
    if (!Number.isInteger(configured) || configured <= 0) return DURABLE_MONITOR_DEFAULT_BATCH;
    return Math.min(configured, DURABLE_MONITOR_MAX_BATCH);
}

export async function runDurableMonitorBatch(options: DurableMonitorRunOptions & { maxMonitors?: number } = {}): Promise<DurableMonitorRunResult> {
    const db = options.db ?? prisma;
    const now = options.now ?? new Date();
    if (!isValidDate(now)) throw new Error("Invalid monitor batch time");
    const candidates = await db.aiMonitor.findMany({
        where: { enabled: true, status: "ACTIVE" },
        include: { state: true },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: durableBatchSize(options.maxMonitors) * 2,
    });
    const due = candidates.filter((monitor) => !monitor.state?.nextRunAt || monitor.state.nextRunAt <= now).slice(0, durableBatchSize(options.maxMonitors));
    const outcomes: DurableMonitorOutcome[] = [];
    for (const monitor of due) {
        try {
            outcomes.push(await runMonitor(monitor.id, { db, now }));
        } catch {
            outcomes.push({ monitorId: monitor.id, key: monitor.key, status: "error", created: false, suppressed: false, evidenceCount: 0 });
        }
    }
    return {
        evaluated: outcomes.filter((outcome) => outcome.status !== "error").length,
        created: outcomes.filter((outcome) => outcome.created).length,
        suppressed: outcomes.filter((outcome) => outcome.suppressed).length,
        errors: outcomes.filter((outcome) => outcome.status === "error").length,
        outcomes,
    };
}