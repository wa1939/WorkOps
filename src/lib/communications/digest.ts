import { z } from "zod";
import { formatWeekLabel } from "@/lib/week";

const DEFAULT_INTERNAL_DOMAINS: readonly string[] = [];
const recipientSchema = z.string().email();

export type RecipientValidationOptions = {
    allowExternal: boolean;
    /** Domains that may be used without explicit external approval. */
    allowedExternalDomains?: readonly string[];
    /** Explicitly trusted deployment domains; empty by default. */
    internalDomains?: readonly string[];
};

export type RecipientValidationResult = {
    valid: string[];
    invalid: string[];
    duplicatesRemoved: string[];
    externalBlocked: string[];
};

function normalizeDomain(domain: string): string {
    return domain.trim().toLowerCase().replace(/^@/, "");
}

function recipientTokens(raw: string | string[]): string[] {
    const values = Array.isArray(raw) ? raw : [raw];
    return values.flatMap((value) => value.split(/[,;\s]+/));
}

/**
 * Normalize, validate, and classify recipients without touching application state.
 * The first occurrence of a case-insensitive address wins.
 */
export function parseAndValidateRecipients(
    raw: string | string[],
    opts: RecipientValidationOptions,
): RecipientValidationResult {
    const internalDomains = new Set(
        (opts.internalDomains ?? DEFAULT_INTERNAL_DOMAINS).map(normalizeDomain),
    );
    const allowedExternalDomains = new Set(
        (opts.allowedExternalDomains ?? []).map(normalizeDomain),
    );
    const seen = new Set<string>();
    const result: RecipientValidationResult = {
        valid: [],
        invalid: [],
        duplicatesRemoved: [],
        externalBlocked: [],
    };

    for (const token of recipientTokens(raw)) {
        const normalized = token.trim().toLowerCase();
        if (!normalized) continue;
        if (seen.has(normalized)) {
            result.duplicatesRemoved.push(normalized);
            continue;
        }
        seen.add(normalized);

        if (!recipientSchema.safeParse(normalized).success) {
            result.invalid.push(normalized);
            continue;
        }

        const domain = normalized.slice(normalized.lastIndexOf("@") + 1);
        const isExternal = !internalDomains.has(domain) && !allowedExternalDomains.has(domain);
        if (isExternal && !opts.allowExternal) {
            result.externalBlocked.push(normalized);
            continue;
        }
        result.valid.push(normalized);
    }

    return result;
}

type CountDelegate = {
    count: (args?: any) => Promise<number>;
};

type QueryDelegate = {
    findUnique: (args: any) => Promise<any>;
};

type CreateDelegate = {
    create: (args: any) => Promise<any>;
};

type DeliveryDelegate = {
    createMany: (args: any) => Promise<any>;
    findMany: (args: any) => Promise<any[]>;
};

/** A narrow injected database seam; the production Prisma client satisfies it. */
export type DigestDb = {
    task: CountDelegate;
    project: CountDelegate;
    kPI: CountDelegate;
    weeklyReport: CreateDelegate & QueryDelegate;
    appConfig: QueryDelegate;
    notificationEvent: CreateDelegate & QueryDelegate;
    delivery: DeliveryDelegate;
    $transaction?: <T>(fn: (tx: DigestDb) => Promise<T>) => Promise<T>;
};

export type DigestActorScopes = {
    id?: string;
    userId?: string;
    role?: string;
    departmentIds?: readonly string[];
    workspaceIds?: readonly string[];
};

export type DigestCounts = {
    completedCount: number;
    inProgressCount: number;
    overdueCount: number;
    upcomingCount: number;
    activeProjectCount: number;
    kpiRiskCount: number;
};

export type DigestPreview = {
    weekStart: Date;
    weekEnd: Date;
    weekLabel: string;
    title: string;
    bullets: string[];
    body: string;
    counts: DigestCounts;
    actorScopes: DigestActorScopes;
};

export type DigestDraft = {
    id: string;
    weekStart: Date;
    weekEnd: Date;
    title: string;
    body: string;
    type: string;
    finalBody: string | null;
    submittedAt: Date | null;
    createdAt?: Date;
};

function assertPeriod(weekStart: Date, weekEnd: Date): void {
    if (Number.isNaN(weekStart.getTime()) || Number.isNaN(weekEnd.getTime()) || weekStart >= weekEnd) {
        throw new Error("Invalid digest period");
    }
}

function actorId(scopes: DigestActorScopes): string {
    return scopes.id ?? scopes.userId ?? "";
}

function isAdmin(scopes: DigestActorScopes): boolean {
    return scopes.role === "ADMIN";
}

function authorizedTaskWhere(scopes: DigestActorScopes): Record<string, unknown> {
    if (isAdmin(scopes)) return {};
    const id = actorId(scopes);
    if (!id) return { id: "__unauthenticated_digest_actor__" };

    const access: Record<string, unknown>[] = [
        { OR: [{ isPrivate: false }, { assignments: { some: { userId: id } } }, { createdById: id }] },
    ];
    const departments = [...(scopes.departmentIds ?? [])];
    if (departments.length > 0) {
        access.push({
            OR: [
                { project: { responsibleDepartmentId: { in: departments } } },
                { projectId: null },
            ],
        });
    }
    return { AND: access };
}

function authorizedProjectWhere(scopes: DigestActorScopes): Record<string, unknown> {
    if (isAdmin(scopes)) return {};
    const id = actorId(scopes);
    if (!id) return { id: "__unauthenticated_digest_actor__" };

    const access: Record<string, unknown>[] = [
        { OR: [{ ownerId: id }, { members: { some: { userId: id } } }] },
    ];
    const departments = [...(scopes.departmentIds ?? [])];
    if (departments.length > 0) access.push({ responsibleDepartmentId: { in: departments } });
    return { AND: access };
}

function authorizedKpiWhere(scopes: DigestActorScopes): Record<string, unknown> {
    if (isAdmin(scopes)) return {};
    const id = actorId(scopes);
    if (!id) return { id: "__unauthenticated_digest_actor__" };
    return { OR: [{ ownerId: id }, { ownerId: null }] };
}

function digestBullets(counts: DigestCounts): string[] {
    return [
        `Completed: ${counts.completedCount}`,
        `In progress: ${counts.inProgressCount}`,
        `Overdue: ${counts.overdueCount}`,
        `Upcoming: ${counts.upcomingCount}`,
        `Active projects: ${counts.activeProjectCount}`,
        `KPIs at risk: ${counts.kpiRiskCount}`,
    ];
}

function digestBody(title: string, bullets: string[]): string {
    return [`# ${title}`, "", ...bullets.map((bullet) => `- ${bullet}`)].join("\n");
}

/**
 * Read the count-only digest projection for the actor's authorized scope.
 * This function intentionally has no persistence side effects.
 */
export async function buildDigestPreview(
    db: DigestDb,
    input: { weekStart: Date; weekEnd: Date; actorScopes: DigestActorScopes },
): Promise<DigestPreview> {
    const { weekStart, weekEnd, actorScopes } = input;
    assertPeriod(weekStart, weekEnd);
    const period = { gte: weekStart, lt: weekEnd };
    const now = weekEnd;
    const nextWeekEnd = new Date(weekEnd.getTime() + 7 * 24 * 60 * 60 * 1000);
    const taskScope = authorizedTaskWhere(actorScopes);
    const projectScope = authorizedProjectWhere(actorScopes);
    const kpiScope = authorizedKpiWhere(actorScopes);

    const [completedCount, inProgressCount, overdueCount, upcomingCount, activeProjectCount, kpiRiskCount] =
        await Promise.all([
            db.task.count({ where: { ...taskScope, status: "DONE", doneAt: period } }),
            db.task.count({ where: { ...taskScope, status: "DOING" } }),
            db.task.count({ where: { ...taskScope, status: { notIn: ["DONE", "CANCELED"] }, dueAt: { lt: now } } }),
            db.task.count({ where: { ...taskScope, status: { notIn: ["DONE", "CANCELED"] }, dueAt: { gte: now, lt: nextWeekEnd } } }),
            db.project.count({ where: { ...projectScope, status: { not: "Done" } } }),
            db.kPI.count({ where: { ...kpiScope, updatedAt: period, status: { in: ["AT_RISK", "OFF_TRACK"] } } }),
        ]);

    const counts: DigestCounts = {
        completedCount,
        inProgressCount,
        overdueCount,
        upcomingCount,
        activeProjectCount,
        kpiRiskCount,
    };
    const weekLabel = formatWeekLabel(weekStart, weekEnd);
    const title = `Sunday Digest — ${weekLabel}`;
    const bullets = digestBullets(counts);

    return {
        weekStart,
        weekEnd,
        weekLabel,
        title,
        bullets,
        body: digestBody(title, bullets),
        counts,
        actorScopes,
    };
}

/** Persist a count-only preview as an unsubmitted WeeklyReport draft. */
export async function saveDigestDraft(db: DigestDb, preview: DigestPreview): Promise<DigestDraft> {
    assertPeriod(preview.weekStart, preview.weekEnd);
    const row = await db.weeklyReport.create({
        data: {
            weekStart: preview.weekStart,
            weekEnd: preview.weekEnd,
            title: preview.title,
            body: preview.body,
            type: "SUNDAY_DIGEST",
            finalBody: null,
            submittedAt: null,
        },
    });
    const readBack = await db.weeklyReport.findUnique({ where: { id: row.id } });
    if (!readBack || readBack.finalBody !== null || readBack.submittedAt !== null) {
        throw new Error("Digest draft authoritative read-back failed");
    }
    return readBack as DigestDraft;
}

export type DigestEmailInput = {
    to: string;
    subject: string;
    body: string;
    draft: DigestDraft;
};

export type DigestEmailOutcome =
    | { outcome: "accepted"; providerId: string }
    | { outcome: "failed"; message: string; retryable?: boolean }
    | { outcome: "unknown"; message?: string };

export type DigestEmailSender = (input: DigestEmailInput) => Promise<DigestEmailOutcome>;

export type SendApprovedDigestOptions = {
    draftId: string;
    explicitExternalApproval?: boolean;
    internalDomains?: readonly string[];
    allowedExternalDomains?: readonly string[];
    /** Test/route seam; defaults to AppConfig then SUNDAY_DIGEST_TO. */
    recipients?: string | string[];
    workspaceId?: string;
    recipientUserId?: string;
};

export type DigestSendResult = {
    draft: DigestDraft;
    validation: RecipientValidationResult;
    outcomes: Array<{ recipient: string; outcome: DigestEmailOutcome }>;
    sent: string[];
    deliveryIds: string[];
};

function asDigestDraft(row: any): DigestDraft {
    return row as DigestDraft;
}

async function loadRecipients(db: DigestDb, options: SendApprovedDigestOptions): Promise<string | string[]> {
    if (options.recipients !== undefined) return options.recipients;
    const config = await db.appConfig.findUnique({ where: { key: "SUNDAY_DIGEST_TO" } });
    return config?.value ?? process.env.SUNDAY_DIGEST_TO ?? "";
}

async function recordDigestDeliveries(
    db: DigestDb,
    draft: DigestDraft,
    outcomes: Array<{ recipient: string; outcome: DigestEmailOutcome }>,
    options: SendApprovedDigestOptions,
): Promise<string[]> {
    if (outcomes.length === 0) return [];

    const dedupeKey = `digest:${draft.id}`;
    const existing = await db.notificationEvent.findUnique({
        where: { dedupeKey },
        include: { deliveries: true },
    });
    if (existing) return (existing.deliveries ?? []).map((delivery: { id: string }) => delivery.id);

    const eventId = globalThis.crypto.randomUUID();
    const event = await db.notificationEvent.create({
        data: {
            id: eventId,
            workspaceId: options.workspaceId ?? `digest:${draft.id}`,
            sourceType: "weekly_report",
            sourceId: draft.id,
            sourceVersion: draft.createdAt?.toISOString() ?? draft.id,
            category: "digest",
            recipientUserId: options.recipientUserId ?? "digest",
            dedupeKey,
        },
    });
    const deliveries = outcomes.map(({ recipient, outcome }) => ({
        eventId: event.id,
        channel: "email",
        destinationKey: recipient,
        state: outcome.outcome === "accepted" ? "ACCEPTED" : "FAILED",
        providerId: outcome.outcome === "accepted" ? outcome.providerId : null,
        lastError: outcome.outcome === "accepted" ? null : outcome.message ?? "Email delivery failed",
        acceptedAt: outcome.outcome === "accepted" ? new Date() : null,
    }));
    if (deliveries.length > 0) {
        await db.delivery.createMany({ data: deliveries, skipDuplicates: true });
    }
    return (await db.delivery.findMany({ where: { eventId }, select: { id: true } })).map(
        (delivery: { id: string }) => delivery.id,
    );
}

/**
 * Send an existing, still-editable digest draft. Recipients are read and
 * validated again at this boundary; external addresses require explicit approval.
 */
export async function sendApprovedDigest(
    db: DigestDb,
    options: SendApprovedDigestOptions,
    emailSender: DigestEmailSender,
): Promise<DigestSendResult> {
    const stored = await db.weeklyReport.findUnique({ where: { id: options.draftId } });
    if (!stored) throw new Error("Digest draft not found");
    if (stored.type !== "SUNDAY_DIGEST" || stored.finalBody !== null || stored.submittedAt !== null) {
        throw new Error("Digest draft is not sendable");
    }
    const draft = asDigestDraft(stored);
    const rawRecipients = await loadRecipients(db, options);
    const validation = parseAndValidateRecipients(rawRecipients, {
        allowExternal: options.explicitExternalApproval === true,
        internalDomains: options.internalDomains,
        allowedExternalDomains: options.allowedExternalDomains,
    });

    const outcomes: Array<{ recipient: string; outcome: DigestEmailOutcome }> = [];
    for (const recipient of validation.valid) {
        let outcome: DigestEmailOutcome;
        try {
            outcome = await emailSender({
                to: recipient,
                subject: draft.title,
                body: draft.body,
                draft,
            });
        } catch (error) {
            outcome = {
                outcome: "unknown",
                message: error instanceof Error ? error.message : String(error),
            };
        }
        outcomes.push({ recipient, outcome });
    }

    const deliveryIds = await recordDigestDeliveries(db, draft, outcomes, options);
    return {
        draft,
        validation,
        outcomes,
        sent: outcomes
            .filter(({ outcome }) => outcome.outcome === "accepted")
            .map(({ recipient }) => recipient),
        deliveryIds,
    };
}
