import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { MONITOR_DEFINITIONS } from "./definitions";
import { taskScopeForActor, type TaskActor } from "@/lib/tasks/authorization";
import { composeScopes, workspaceScopeWhere } from "@/lib/workspaces/scope";

export type MonitorDatabase = PrismaClient;

export type MonitorRecord = {
    id: string;
    key: string;
    scope: string;
    definitionJson: string;
    createdById: string | null;
};

export type MonitorEvidenceItem = {
    monitorId: string;
    kind: string;
    sourceType: string;
    sourceId: string;
    version: number;
    fingerprint: string;
    dueAt: Date | null;
    observedAt: Date;
    details: Record<string, string | number | boolean | null | string[]>;
};

type MonitorConfig = {
    workspaceId?: string;
    userId?: string;
    windowDays?: number;
    staleDays?: number;
    thresholdPercent?: number;
};

type Subject = TaskActor & { isActive: boolean };
type ReaderContext = {
    workspaceId: string | undefined;
    subject: Subject;
};

type TaskEvidenceRow = {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: Date | null;
    updatedAt: Date;
};

type ProjectEvidenceRow = {
    id: string;
    name: string;
    status: string;
    dueAt: Date | null;
    updatedAt: Date;
};

const DEFAULT_DEADLINE_WINDOW_DAYS = 7;
const DEFAULT_STALE_DAYS = 7;
const DEFAULT_LOAD_THRESHOLD = 100;
const MAX_ITEMS = 50;
const MAX_TEXT = 240;
const MAX_CONFIG_ID = 160;

function validDate(value: Date): boolean {
    return value instanceof Date && Number.isFinite(value.getTime());
}

function boundedText(value: unknown, max = MAX_TEXT): string {
    return typeof value === "string"
        ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
        : "";
}

function boundedId(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 && value.length <= MAX_CONFIG_ID ? value : undefined;
}

function positiveNumber(value: unknown, fallback: number, maximum: number): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum ? value : fallback;
}

function parseConfig(monitor: MonitorRecord): MonitorConfig {
    let parsed: unknown;
    try {
        parsed = JSON.parse(monitor.definitionJson);
    } catch {
        return {};
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const value = parsed as Record<string, unknown>;
    return {
        workspaceId: boundedId(value.workspaceId ?? value.workspace),
        userId: boundedId(value.userId ?? value.subjectUserId ?? value.actorId),
        windowDays: positiveNumber(value.deadlineWindowDays ?? value.windowDays, DEFAULT_DEADLINE_WINDOW_DAYS, 31),
        staleDays: positiveNumber(value.staleDays ?? value.staleWorkDays, DEFAULT_STALE_DAYS, 90),
        thresholdPercent: positiveNumber(value.thresholdPercent ?? value.overloadPercent, DEFAULT_LOAD_THRESHOLD, 200),
    };
}

function stableJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
    const entries = Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
}

function digest(value: unknown): string {
    return createHash("sha256").update(stableJson(value)).digest("hex");
}

function iso(value: Date | null | undefined): string | null {
    return value && validDate(value) ? value.toISOString() : null;
}

function contextWorkspace(monitor: MonitorRecord, config: MonitorConfig): string | undefined {
    return monitor.scope === "WORKSPACE" ? config.workspaceId : undefined;
}

async function resolveContext(db: MonitorDatabase, monitor: MonitorRecord): Promise<ReaderContext | null> {
    const config = parseConfig(monitor);
    const userId = config.userId ?? boundedId(monitor.createdById);
    const workspaceId = contextWorkspace(monitor, config);
    if (!userId || (monitor.scope === "WORKSPACE" && !workspaceId)) return null;

    const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, isActive: true },
    });
    if (!user || !user.isActive || !["ADMIN", "LEAD", "MEMBER", "VIEWER"].includes(user.role)) return null;

    if (workspaceId) {
        const membership = await db.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } },
            select: { active: true, workspace: { select: { archivedAt: true } } },
        });
        if (!membership?.active || membership.workspace.archivedAt !== null) return null;
    }

    return {
        workspaceId,
        subject: { id: user.id, role: user.role as Subject["role"], isActive: user.isActive },
    };
}

function taskWhere(context: ReaderContext): Record<string, unknown> {
    // Keep monitor task reads on the exact task visibility policy used by task
    // commands. This is deliberately not replaced by a generic workspace OR.
    return taskScopeForActor(context.subject, context.workspaceId) as Record<string, unknown>;
}

function projectWhere(context: ReaderContext): Record<string, unknown> {
    const workspace = context.workspaceId ? workspaceScopeWhere(context.workspaceId) : undefined;
    if (context.subject.role === "ADMIN") return (workspace ?? {}) as Record<string, unknown>;
    return composeScopes(
        workspace,
        { OR: [{ ownerId: context.subject.id }, { members: { some: { userId: context.subject.id } } }] },
    ) as Record<string, unknown>;
}

function kpiWhere(context: ReaderContext): Record<string, unknown> {
    const workspace = context.workspaceId ? workspaceScopeWhere(context.workspaceId) : undefined;
    if (context.subject.role === "ADMIN") return (workspace ?? {}) as Record<string, unknown>;
    return composeScopes(workspace, { OR: [{ ownerId: context.subject.id }, { tasks: { some: { createdById: context.subject.id } } }] }) as Record<string, unknown>;
}

function makeEvidence(
    monitor: MonitorRecord,
    kind: string,
    sourceType: string,
    sourceId: string,
    version: number,
    dueAt: Date | null,
    observedAt: Date,
    details: MonitorEvidenceItem["details"],
    fingerprintValues: unknown = details,
): MonitorEvidenceItem {
    const normalizedDetails = Object.fromEntries(
        Object.entries(details).map(([key, value]) => [key, typeof value === "string" ? boundedText(value) : value]),
    ) as MonitorEvidenceItem["details"];
    const fingerprint = digest({ monitorId: monitor.id, kind, sourceType, sourceId, values: fingerprintValues });
    return { monitorId: monitor.id, kind, sourceType, sourceId, version, fingerprint, dueAt, observedAt, details: normalizedDetails };
}

function taskEvidence(monitor: MonitorRecord, kind: string, row: TaskEvidenceRow, now: Date): MonitorEvidenceItem {
    return makeEvidence(monitor, kind, "TASK", row.id, row.updatedAt.getTime(), row.dueAt, now, {
        title: row.title,
        status: row.status,
        priority: row.priority,
        updatedAt: row.updatedAt.toISOString(),
        dueAt: iso(row.dueAt),
    });
}

async function readDeadlines(db: MonitorDatabase, monitor: MonitorRecord, now: Date, context: ReaderContext): Promise<MonitorEvidenceItem[]> {
    const config = parseConfig(monitor);
    const windowEnd = new Date(now.getTime() + (config.windowDays ?? DEFAULT_DEADLINE_WINDOW_DAYS) * 24 * 60 * 60 * 1000);
    const rows = await db.task.findMany({
        where: {
            ...taskWhere(context),
            status: { notIn: ["DONE", "CANCELED"] },
            dueAt: { gte: now, lte: windowEnd },
        },
        select: { id: true, title: true, status: true, priority: true, dueAt: true, updatedAt: true },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: MAX_ITEMS,
    }) as TaskEvidenceRow[];
    return rows.map((row) => makeEvidence(monitor, "deadline-proximity", "TASK", row.id, row.updatedAt.getTime(), row.dueAt, now, {
        title: row.title,
        status: row.status,
        priority: row.priority,
        updatedAt: row.updatedAt.toISOString(),
        dueAt: iso(row.dueAt),
    }, { taskId: row.id, dueAt: iso(row.dueAt) }));
}

async function readStaleWork(db: MonitorDatabase, monitor: MonitorRecord, now: Date, context: ReaderContext): Promise<MonitorEvidenceItem[]> {
    const config = parseConfig(monitor);
    const cutoff = new Date(now.getTime() - (config.staleDays ?? DEFAULT_STALE_DAYS) * 24 * 60 * 60 * 1000);
    const rows = await db.task.findMany({
        where: {
            ...taskWhere(context),
            status: { notIn: ["DONE", "CANCELED"] },
            updatedAt: { lte: cutoff },
        },
        select: { id: true, title: true, status: true, priority: true, dueAt: true, updatedAt: true },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_ITEMS,
    }) as TaskEvidenceRow[];
    return rows.map((row) => taskEvidence(monitor, "stale-progress", row, now));
}

async function readDependencyRisk(db: MonitorDatabase, monitor: MonitorRecord, now: Date, context: ReaderContext): Promise<MonitorEvidenceItem[]> {
    const rows = await db.task.findMany({
        where: {
            ...taskWhere(context),
            status: { notIn: ["DONE", "CANCELED"] },
            dependencies: { some: { dependsOn: { status: { in: ["BLOCKED", "WAITING"] } } } },
        },
        select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueAt: true,
            updatedAt: true,
            dependencies: { where: { dependsOn: { status: { in: ["BLOCKED", "WAITING"] } } }, select: { dependsOnId: true } },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_ITEMS,
    }) as Array<TaskEvidenceRow & { dependencies: Array<{ dependsOnId: string }> }>;
    return rows.map((row) => makeEvidence(monitor, "blocked-dependency", "TASK", row.id, row.updatedAt.getTime(), row.dueAt, now, {
        title: row.title,
        status: row.status,
        priority: row.priority,
        blockerIds: row.dependencies.map((dependency) => dependency.dependsOnId).sort(),
        updatedAt: row.updatedAt.toISOString(),
    }));
}

async function readDuplicateInitiatives(db: MonitorDatabase, monitor: MonitorRecord, now: Date, context: ReaderContext): Promise<MonitorEvidenceItem[]> {
    const rows = await db.project.findMany({
        where: { ...projectWhere(context), status: { notIn: ["Completed", "Closed", "Archived"] } },
        select: { id: true, name: true, status: true, dueAt: true, updatedAt: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: MAX_ITEMS,
    }) as ProjectEvidenceRow[];
    const groups = new Map<string, ProjectEvidenceRow[]>();
    for (const row of rows) {
        const normalized = row.name.toLocaleLowerCase().replace(/\s+/g, " ").trim();
        if (!normalized) continue;
        groups.set(normalized, [...(groups.get(normalized) ?? []), row]);
    }
    const evidence: MonitorEvidenceItem[] = [];
    for (const group of Array.from(groups.values())) {
        if (group.length < 2) continue;
        const ids: string[] = group.map((row: ProjectEvidenceRow) => row.id).sort();
        for (const row of group) evidence.push(makeEvidence(monitor, "duplicate-initiative", "PROJECT", row.id, row.updatedAt.getTime(), row.dueAt, now, { name: row.name, status: row.status, duplicateIds: ids.filter((id: string) => id !== row.id), updatedAt: row.updatedAt.toISOString() }));
    }
    return evidence.slice(0, MAX_ITEMS);
}

async function readKpiGaps(db: MonitorDatabase, monitor: MonitorRecord, now: Date, context: ReaderContext): Promise<MonitorEvidenceItem[]> {
    const rows = await db.kPI.findMany({
        where: { ...kpiWhere(context), status: { in: ["AT_RISK", "OFF_TRACK"] } },
        select: { id: true, name: true, status: true, updatedAt: true, q1Target: true, q2Target: true, q3Target: true, q4Target: true },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_ITEMS,
    }) as Array<{ id: string; name: string; status: string; updatedAt: Date; q1Target: number | null; q2Target: number | null; q3Target: number | null; q4Target: number | null }>;
    return rows.map((row) => makeEvidence(monitor, "kpi-gap", "KPI", row.id, row.updatedAt.getTime(), null, now, {
        name: row.name,
        status: row.status,
        targetCount: [row.q1Target, row.q2Target, row.q3Target, row.q4Target].filter((value) => value !== null).length,
        updatedAt: row.updatedAt.toISOString(),
    }));
}

async function readWorkloadConflict(db: MonitorDatabase, monitor: MonitorRecord, now: Date, context: ReaderContext): Promise<MonitorEvidenceItem[]> {
    const config = parseConfig(monitor);
    const rows = await db.teamLoadSnapshot.findMany({
        where: {
            loadPercent: { gte: config.thresholdPercent ?? DEFAULT_LOAD_THRESHOLD },
            ...(context.subject.role === "ADMIN" ? {} : { userId: context.subject.id }),
            ...(context.workspaceId ? { user: { workspaceMemberships: { some: { workspaceId: context.workspaceId, active: true } } } } : {}),
        },
        select: { id: true, userId: true, weekStart: true, loadHours: true, loadPercent: true, driversJson: true, computedAt: true },
        orderBy: [{ computedAt: "desc" }, { userId: "asc" }, { weekStart: "asc" }],
        take: MAX_ITEMS,
    }) as Array<{ id: string; userId: string; weekStart: Date; loadHours: number; loadPercent: number; driversJson: string | null; computedAt: Date }>;
    return rows.map((row) => {
        let capacity: number | null = null;
        try {
            const parsed = row.driversJson ? JSON.parse(row.driversJson) as { capacity?: unknown } : null;
            capacity = typeof parsed?.capacity === "number" && Number.isFinite(parsed.capacity) ? parsed.capacity : null;
        } catch {
            capacity = null;
        }
        return makeEvidence(monitor, "workload-over-capacity", "USER_LOAD", row.userId, row.computedAt.getTime(), null, now, {
            userId: row.userId,
            weekStart: row.weekStart.toISOString(),
            loadHours: row.loadHours,
            loadPercent: row.loadPercent,
            capacity,
            computedAt: row.computedAt.toISOString(),
        });
    });
}

async function readMissingUpdates(db: MonitorDatabase, monitor: MonitorRecord, now: Date, context: ReaderContext): Promise<MonitorEvidenceItem[]> {
    const config = parseConfig(monitor);
    const cutoff = new Date(now.getTime() - (config.staleDays ?? DEFAULT_STALE_DAYS) * 24 * 60 * 60 * 1000);
    const rows = await db.project.findMany({
        where: { ...projectWhere(context), status: { notIn: ["Completed", "Closed", "Archived"] }, updatedAt: { lte: cutoff } },
        select: { id: true, name: true, status: true, dueAt: true, updatedAt: true },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: MAX_ITEMS,
    }) as ProjectEvidenceRow[];
    return rows.map((row) => makeEvidence(monitor, "missing-update", "PROJECT", row.id, row.updatedAt.getTime(), row.dueAt, now, {
        name: row.name,
        status: row.status,
        lastUpdatedAt: row.updatedAt.toISOString(),
    }));
}

export type MonitorEvidenceReader = (db: MonitorDatabase, monitor: MonitorRecord, now: Date) => Promise<MonitorEvidenceItem[]>;

export const MONITOR_READERS: Readonly<Record<string, MonitorEvidenceReader>> = {
    "stale-work": async (db, monitor, now) => {
        const context = await resolveContext(db, monitor);
        return context ? readStaleWork(db, monitor, now, context) : [];
    },
    "dependency-risk": async (db, monitor, now) => {
        const context = await resolveContext(db, monitor);
        return context ? readDependencyRisk(db, monitor, now, context) : [];
    },
    "duplicate-initiatives": async (db, monitor, now) => {
        const context = await resolveContext(db, monitor);
        return context ? readDuplicateInitiatives(db, monitor, now, context) : [];
    },
    "kpi-gaps": async (db, monitor, now) => {
        const context = await resolveContext(db, monitor);
        return context ? readKpiGaps(db, monitor, now, context) : [];
    },
    "workload-conflict": async (db, monitor, now) => {
        const context = await resolveContext(db, monitor);
        return context ? readWorkloadConflict(db, monitor, now, context) : [];
    },
    "missing-updates": async (db, monitor, now) => {
        const context = await resolveContext(db, monitor);
        return context ? readMissingUpdates(db, monitor, now, context) : [];
    },
    deadlines: async (db, monitor, now) => {
        const context = await resolveContext(db, monitor);
        return context ? readDeadlines(db, monitor, now, context) : [];
    },
};

export function readerForMonitor(key: string): MonitorEvidenceReader | undefined {
    return MONITOR_READERS[key];
}

export async function readMonitorEvidence(db: MonitorDatabase, monitor: MonitorRecord, now: Date): Promise<MonitorEvidenceItem[]> {
    if (!validDate(now)) throw new Error("Invalid monitor time");
    if (!MONITOR_DEFINITIONS.some((definition) => definition.key === monitor.key)) return [];
    const reader = readerForMonitor(monitor.key);
    if (!reader) return [];
    const evidence = await reader(db, monitor, now);
    return evidence.slice(0, MAX_ITEMS);
}

export function fingerprintEvidence(evidence: readonly MonitorEvidenceItem[]): string {
    return digest(evidence
        .map((item) => ({ sourceId: item.sourceId, fingerprint: item.fingerprint }))
        .sort((left, right) => `${left.sourceId}:${left.fingerprint}`.localeCompare(`${right.sourceId}:${right.fingerprint}`)));
}
