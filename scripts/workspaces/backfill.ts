import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertLocalDatabaseUrl, readDatabaseUrl } from "../assert-local-database";

export const WORKSPACE_BACKFILL_TABLES = [
    "tasks",
    "projects",
    "kpis",
    "notePages",
    "caseStudies",
    "weeklyReports",
    "supportRequests",
    "announcements",
    "departments",
] as const;

export type WorkspaceBackfillTable = (typeof WORKSPACE_BACKFILL_TABLES)[number];

export const WORKSPACE_BACKFILL_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type WorkspaceBackfillRole = (typeof WORKSPACE_BACKFILL_ROLES)[number];

export type WorkspaceBackfillAssignments = {
    tasks: boolean;
    projects: boolean;
    kpis: boolean;
    notePages: boolean;
    caseStudies: boolean;
    weeklyReports: boolean;
    supportRequests: boolean;
    announcements: boolean;
    departments: boolean;
};

export type WorkspaceBackfillMembership = {
    userId: string;
    role: WorkspaceBackfillRole;
};

export type WorkspaceBackfillManifest = {
    defaultWorkspaceId: string;
    memberships: WorkspaceBackfillMembership[];
    assignments: WorkspaceBackfillAssignments;
};

export type WorkspaceBackfillBatchResult = {
    selected: number;
    updated: number;
    readBack: number;
};

export type WorkspaceBackfillTableResult = {
    table: WorkspaceBackfillTable;
    optedIn: boolean;
    planned: number;
    updated: number;
    readBack: number;
    remainingUnmapped: number;
    batches: WorkspaceBackfillBatchResult[];
};

export type WorkspaceBackfillMembershipResult = {
    requested: number;
    created: number;
    updated: number;
    unchanged: number;
    changes: number;
};

export type WorkspaceBackfillOptions = {
    apply: boolean;
    batchSize?: number;
    /** Test seam for inserting a row before the final fail-closed check. */
    onAfterPass?: (tx: Prisma.TransactionClient) => void | Promise<void>;
};

export type WorkspaceBackfillResult = {
    success: boolean;
    status: "dry-run" | "applied" | "no-op" | "failed";
    applied: boolean;
    noOp: boolean;
    defaultWorkspaceId: string;
    totalChanges: number;
    tables: Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>;
    memberships: WorkspaceBackfillMembershipResult;
    remainingUnmapped: Record<WorkspaceBackfillTable, number>;
    report: string[];
    error?: string;
};

export type BackfillCliOptions = {
    manifestPath: string;
    apply: boolean;
};

type RootRow = {
    id: string;
    workspaceId: string | null;
};

type RootDelegate = {
    findMany(args: Record<string, unknown>): Promise<RootRow[]>;
    count(args: Record<string, unknown>): Promise<number>;
    updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
};

type TableConfig = {
    key: WorkspaceBackfillTable;
    model: string;
    delegate: string;
};

const TABLE_CONFIGS: readonly TableConfig[] = [
    { key: "tasks", model: "Task", delegate: "task" },
    { key: "projects", model: "Project", delegate: "project" },
    { key: "kpis", model: "KPI", delegate: "kPI" },
    { key: "notePages", model: "NotePage", delegate: "notePage" },
    { key: "caseStudies", model: "CaseStudy", delegate: "caseStudy" },
    { key: "weeklyReports", model: "WeeklyReport", delegate: "weeklyReport" },
    { key: "supportRequests", model: "SupportRequest", delegate: "supportRequest" },
    { key: "announcements", model: "Announcement", delegate: "announcement" },
    { key: "departments", model: "Department", delegate: "department" },
];

const MANIFEST_KEYS = ["defaultWorkspaceId", "memberships", "assignments"] as const;
const ASSIGNMENT_KEYS = WORKSPACE_BACKFILL_TABLES;
const ALL_FALSE_ASSIGNMENTS: WorkspaceBackfillAssignments = {
    tasks: false,
    projects: false,
    kpis: false,
    notePages: false,
    caseStudies: false,
    weeklyReports: false,
    supportRequests: false,
    announcements: false,
    departments: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`${field} must be a non-empty string`);
    }
    return value;
}

function assertExactKeys(
    value: Record<string, unknown>,
    expected: readonly string[],
    field: string,
): void {
    const expectedSet = new Set(expected);
    for (const key of expected) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new Error(`${field}.${key} is required`);
        }
    }
    for (const key of Object.keys(value)) {
        if (!expectedSet.has(key)) throw new Error(`${field}.${key} is not allowed`);
    }
}

function isWorkspaceBackfillRole(value: unknown): value is WorkspaceBackfillRole {
    return typeof value === "string" && (WORKSPACE_BACKFILL_ROLES as readonly string[]).includes(value);
}

export function parseWorkspaceBackfillManifest(value: unknown): WorkspaceBackfillManifest {
    if (!isRecord(value)) throw new Error("Manifest must be a JSON object");
    assertExactKeys(value, MANIFEST_KEYS, "manifest");

    const defaultWorkspaceId = requireNonEmptyString(value.defaultWorkspaceId, "defaultWorkspaceId");
    if (!Array.isArray(value.memberships)) throw new Error("memberships must be an array");
    const memberships = value.memberships.map((rawMembership, index) => {
        if (!isRecord(rawMembership)) throw new Error(`memberships[${index}] must be an object`);
        assertExactKeys(rawMembership, ["userId", "role"], `memberships[${index}]`);
        const userId = requireNonEmptyString(rawMembership.userId, `memberships[${index}].userId`);
        if (!isWorkspaceBackfillRole(rawMembership.role)) {
            throw new Error(`memberships[${index}].role must be OWNER, ADMIN, MEMBER, or VIEWER`);
        }
        return { userId, role: rawMembership.role };
    });

    const membershipIds = new Set<string>();
    for (const membership of memberships) {
        if (membershipIds.has(membership.userId)) {
            throw new Error(`memberships contains duplicate userId ${membership.userId}`);
        }
        membershipIds.add(membership.userId);
    }

    if (!isRecord(value.assignments)) throw new Error("assignments must be an object");
    assertExactKeys(value.assignments, ASSIGNMENT_KEYS, "assignments");
    const assignments = {} as WorkspaceBackfillAssignments;
    for (const key of ASSIGNMENT_KEYS) {
        if (typeof value.assignments[key] !== "boolean") {
            throw new Error(`assignments.${key} must be a boolean`);
        }
        assignments[key] = value.assignments[key] as boolean;
    }

    return { defaultWorkspaceId, memberships, assignments };
}

function emptyMembershipResult(requested = 0): WorkspaceBackfillMembershipResult {
    return { requested, created: 0, updated: 0, unchanged: 0, changes: 0 };
}

function emptyTableResult(key: WorkspaceBackfillTable, optedIn: boolean): WorkspaceBackfillTableResult {
    return {
        table: key,
        optedIn,
        planned: 0,
        updated: 0,
        readBack: 0,
        remainingUnmapped: 0,
        batches: [],
    };
}

function emptyTables(assignments: WorkspaceBackfillAssignments): Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult> {
    const tables = {} as Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>;
    for (const key of WORKSPACE_BACKFILL_TABLES) {
        tables[key] = emptyTableResult(key, assignments[key]);
    }
    return tables;
}

function tableReport(table: WorkspaceBackfillTableResult): string {
    return `${table.table}: ${table.optedIn ? "opted-in" : "not opted-in"}; planned=${table.planned}; updated=${table.updated}; readBack=${table.readBack}; remainingUnmapped=${table.remainingUnmapped}; batches=${table.batches.length}`;
}

function membershipReport(memberships: WorkspaceBackfillMembershipResult): string {
    return `memberships: requested=${memberships.requested}; created=${memberships.created}; updated=${memberships.updated}; unchanged=${memberships.unchanged}; changes=${memberships.changes}`;
}

function makeReport(
    tables: Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>,
    memberships: WorkspaceBackfillMembershipResult,
    error?: string,
): string[] {
    const report = WORKSPACE_BACKFILL_TABLES.map((key) => tableReport(tables[key]));
    report.push(membershipReport(memberships));
    if (error) report.push(`error: ${error}`);
    return report;
}

function makeResult(
    defaultWorkspaceId: string,
    tables: Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>,
    memberships: WorkspaceBackfillMembershipResult,
    status: WorkspaceBackfillResult["status"],
    success: boolean,
    error?: string,
): WorkspaceBackfillResult {
    const totalChanges = success && status !== "dry-run"
        ? WORKSPACE_BACKFILL_TABLES.reduce((total, key) => total + tables[key].updated, 0) + memberships.changes
        : 0;
    return {
        success,
        status,
        applied: success && status === "applied",
        noOp: success && status === "no-op",
        defaultWorkspaceId,
        totalChanges,
        tables,
        memberships,
        remainingUnmapped: Object.fromEntries(
            WORKSPACE_BACKFILL_TABLES.map((key) => [key, tables[key].remainingUnmapped]),
        ) as Record<WorkspaceBackfillTable, number>,
        report: makeReport(tables, memberships, error),
        ...(error ? { error } : {}),
    };
}

class BackfillFailure extends Error {
    constructor(message: string) {
        super(message);
        this.name = "BackfillFailure";
    }
}

function isTransactionConflictError(error: unknown): boolean {
    if (!isRecord(error)) return false;
    return error.code === "P2034"
        || (typeof error.message === "string" && /write conflict|deadlock/i.test(error.message));
}

function getRootDelegate(db: PrismaClient | Prisma.TransactionClient, config: TableConfig): RootDelegate {
    const delegate = (db as unknown as Record<string, unknown>)[config.delegate];
    if (!delegate || typeof delegate !== "object") {
        throw new BackfillFailure(`${config.model} delegate is unavailable`);
    }
    return delegate as RootDelegate;
}

function assertOptions(options: WorkspaceBackfillOptions): number {
    if (typeof options.apply !== "boolean") throw new Error("options.apply must be a boolean");
    if (options.batchSize !== undefined && (!Number.isInteger(options.batchSize) || options.batchSize <= 0)) {
        throw new Error("options.batchSize must be a positive integer");
    }
    if (options.onAfterPass !== undefined && typeof options.onAfterPass !== "function") {
        throw new Error("options.onAfterPass must be a function");
    }
    return options.batchSize ?? 500;
}

async function validatePrerequisites(
    db: PrismaClient | Prisma.TransactionClient,
    manifest: WorkspaceBackfillManifest,
): Promise<void> {
    const workspace = await db.workspace.findUnique({
        where: { id: manifest.defaultWorkspaceId },
        select: { id: true, archivedAt: true },
    });
    if (!workspace) throw new BackfillFailure(`default workspace ${manifest.defaultWorkspaceId} does not exist`);
    if (workspace.archivedAt) throw new BackfillFailure(`default workspace ${manifest.defaultWorkspaceId} is archived`);

    if (manifest.memberships.length === 0) return;
    const users = await db.user.findMany({
        where: { id: { in: manifest.memberships.map(({ userId }) => userId) } },
        select: { id: true, isActive: true },
    });
    const usersById = new Map(users.map((user) => [user.id, user]));
    for (const membership of manifest.memberships) {
        const user = usersById.get(membership.userId);
        if (!user || !user.isActive) {
            throw new BackfillFailure(`manifest user ${membership.userId} must exist and be active`);
        }
    }
}

async function inspectMemberships(
    db: PrismaClient | Prisma.TransactionClient,
    manifest: WorkspaceBackfillManifest,
): Promise<WorkspaceBackfillMembershipResult> {
    const result = emptyMembershipResult(manifest.memberships.length);
    if (manifest.memberships.length === 0) return result;

    const existing = await db.workspaceMember.findMany({
        where: {
            workspaceId: manifest.defaultWorkspaceId,
            userId: { in: manifest.memberships.map(({ userId }) => userId) },
        },
        select: { userId: true, role: true, active: true },
    });
    const existingByUserId = new Map(existing.map((membership) => [membership.userId, membership]));
    for (const membership of manifest.memberships) {
        const current = existingByUserId.get(membership.userId);
        if (!current) result.created += 1;
        else if (current.active && current.role === membership.role) result.unchanged += 1;
        else result.updated += 1;
    }
    result.changes = result.created + result.updated;
    return result;
}

async function planDryRun(
    db: PrismaClient,
    manifest: WorkspaceBackfillManifest,
    tables: Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>,
): Promise<WorkspaceBackfillMembershipResult> {
    for (const config of TABLE_CONFIGS) {
        if (!manifest.assignments[config.key]) continue;
        const delegate = getRootDelegate(db, config);
        const planned = await delegate.count({ where: { workspaceId: null } });
        tables[config.key].planned = planned;
        tables[config.key].remainingUnmapped = planned;
    }
    return inspectMemberships(db, manifest);
}

async function applyRootTable(
    tx: Prisma.TransactionClient,
    config: TableConfig,
    defaultWorkspaceId: string,
    batchSize: number,
    table: WorkspaceBackfillTableResult,
): Promise<void> {
    const delegate = getRootDelegate(tx, config);

    while (true) {
        const candidates = await delegate.findMany({
            where: { workspaceId: null },
            select: { id: true },
            orderBy: { id: "asc" },
            take: batchSize,
        });
        if (candidates.length === 0) break;

        const ids = candidates.map(({ id }) => id);
        table.planned += ids.length;
        const write = await delegate.updateMany({
            where: { id: { in: ids }, workspaceId: null },
            data: { workspaceId: defaultWorkspaceId },
        });
        const readBackRows = await delegate.findMany({
            where: { id: { in: ids } },
            select: { id: true, workspaceId: true },
        });
        const readBack = readBackRows.filter((row) => row.workspaceId === defaultWorkspaceId).length;
        table.updated += write.count;
        table.readBack += readBack;
        table.batches.push({ selected: ids.length, updated: write.count, readBack });

        if (readBack !== ids.length) {
            const remaining = await delegate.count({ where: { workspaceId: null } });
            table.remainingUnmapped = remaining;
            throw new BackfillFailure(
                `${config.model} batch readback failed: ${readBack}/${ids.length} rows are assigned to the default workspace`,
            );
        }
    }
}

async function verifyNoRemainingUnmapped(
    tx: Prisma.TransactionClient,
    manifest: WorkspaceBackfillManifest,
    tables: Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>,
): Promise<void> {
    for (const config of TABLE_CONFIGS) {
        if (!manifest.assignments[config.key]) continue;
        const remaining = await getRootDelegate(tx, config).count({ where: { workspaceId: null } });
        tables[config.key].remainingUnmapped = remaining;
        if (remaining > 0) {
            throw new BackfillFailure(`${config.model} has ${remaining} unmapped records after the backfill pass`);
        }
    }
}

async function applyMemberships(
    tx: Prisma.TransactionClient,
    manifest: WorkspaceBackfillManifest,
): Promise<WorkspaceBackfillMembershipResult> {
    const result = emptyMembershipResult(manifest.memberships.length);
    if (manifest.memberships.length === 0) return result;

    const existing = await tx.workspaceMember.findMany({
        where: {
            workspaceId: manifest.defaultWorkspaceId,
            userId: { in: manifest.memberships.map(({ userId }) => userId) },
        },
        select: { userId: true, role: true, active: true },
    });
    const existingByUserId = new Map(existing.map((membership) => [membership.userId, membership]));

    for (const membership of manifest.memberships) {
        const current = existingByUserId.get(membership.userId);
        if (current && current.active && current.role === membership.role) {
            result.unchanged += 1;
            continue;
        }

        await tx.workspaceMember.upsert({
            where: {
                workspaceId_userId: {
                    workspaceId: manifest.defaultWorkspaceId,
                    userId: membership.userId,
                },
            },
            create: {
                workspaceId: manifest.defaultWorkspaceId,
                userId: membership.userId,
                role: membership.role,
                active: true,
            },
            update: { role: membership.role, active: true },
        });
        if (current) result.updated += 1;
        else result.created += 1;
    }
    result.changes = result.created + result.updated;
    return result;
}

async function refreshRemainingAfterFailure(
    db: PrismaClient,
    manifest: WorkspaceBackfillManifest,
    tables: Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>,
): Promise<void> {
    for (const config of TABLE_CONFIGS) {
        if (!manifest.assignments[config.key]) continue;
        try {
            tables[config.key].remainingUnmapped = await getRootDelegate(db, config).count({ where: { workspaceId: null } });
        } catch {
            // Preserve the failure that caused the rollback if the database is unavailable.
        }
        tables[config.key].updated = 0;
        tables[config.key].readBack = 0;
    }
}

export async function backfillWorkspaces(
    db: PrismaClient,
    manifest: WorkspaceBackfillManifest,
    options: WorkspaceBackfillOptions,
): Promise<WorkspaceBackfillResult> {
    let parsedManifest: WorkspaceBackfillManifest;
    try {
        parsedManifest = parseWorkspaceBackfillManifest(manifest);
    } catch (error) {
        const message = error instanceof Error ? error.message : "manifest is invalid";
        const defaultWorkspaceId = isRecord(manifest) && typeof manifest.defaultWorkspaceId === "string"
            ? manifest.defaultWorkspaceId
            : "";
        return makeResult(defaultWorkspaceId, emptyTables(ALL_FALSE_ASSIGNMENTS), emptyMembershipResult(), "failed", false, message);
    }

    const tables = emptyTables(parsedManifest.assignments);
    try {
        const batchSize = assertOptions(options);
        await validatePrerequisites(db, parsedManifest);

        if (!options.apply) {
            const memberships = await planDryRun(db, parsedManifest, tables);
            return makeResult(parsedManifest.defaultWorkspaceId, tables, memberships, "dry-run", true);
        }

        let memberships = emptyMembershipResult(parsedManifest.memberships.length);
        await db.$transaction(async (tx) => {
            await validatePrerequisites(tx, parsedManifest);
            for (const config of TABLE_CONFIGS) {
                if (!parsedManifest.assignments[config.key]) continue;
                await applyRootTable(tx, config, parsedManifest.defaultWorkspaceId, batchSize, tables[config.key]);
            }
            if (options.onAfterPass) await options.onAfterPass(tx);
            await verifyNoRemainingUnmapped(tx, parsedManifest, tables);
            memberships = await applyMemberships(tx, parsedManifest);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

        const status = tablesChanged(tables) || memberships.changes > 0 ? "applied" : "no-op";
        return makeResult(parsedManifest.defaultWorkspaceId, tables, memberships, status, true);
    } catch (error) {
        const originalMessage = error instanceof Error ? error.message : "workspace backfill failed";
        try {
            await refreshRemainingAfterFailure(db, parsedManifest, tables);
        } catch {
            // The original error is the useful report when the database is unavailable.
        }
        const unmappedTables = WORKSPACE_BACKFILL_TABLES.filter(
            (key) => parsedManifest.assignments[key] && tables[key].remainingUnmapped > 0,
        );
        const message = isTransactionConflictError(error) && unmappedTables.length > 0
            ? `${originalMessage}; ${unmappedTables.join(", ")} unmapped records remain after the failed transaction`
            : originalMessage;
        return makeResult(
            parsedManifest.defaultWorkspaceId,
            tables,
            emptyMembershipResult(parsedManifest.memberships.length),
            "failed",
            false,
            message,
        );
    }
}

function tablesChanged(
    tables: Record<WorkspaceBackfillTable, WorkspaceBackfillTableResult>,
): boolean {
    return WORKSPACE_BACKFILL_TABLES.some((key) => tables[key].updated > 0);
}

export function parseBackfillCliOptions(argv: readonly string[]): BackfillCliOptions {
    let manifestPath: string | undefined;
    let apply = false;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--apply") {
            if (apply) throw new Error("--apply may only be supplied once");
            apply = true;
            continue;
        }
        if (argument === "--dry-run") {
            if (apply) throw new Error("--dry-run cannot be combined with --apply");
            continue;
        }
        if (argument === "--manifest") {
            const value = argv[index + 1];
            if (!value || value.startsWith("--")) throw new Error("--manifest requires a path");
            if (manifestPath !== undefined) throw new Error("--manifest may only be supplied once");
            manifestPath = value;
            index += 1;
            continue;
        }
        if (argument.startsWith("--manifest=")) {
            const value = argument.slice("--manifest=".length);
            if (!value) throw new Error("--manifest requires a path");
            if (manifestPath !== undefined) throw new Error("--manifest may only be supplied once");
            manifestPath = value;
            continue;
        }
        throw new Error(`Unknown option: ${argument}`);
    }

    if (!manifestPath) throw new Error("--manifest is required");
    return { manifestPath, apply };
}

export function loadWorkspaceBackfillManifest(manifestPath: string): WorkspaceBackfillManifest {
    let parsed: unknown;
    try {
        parsed = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as unknown;
    } catch {
        throw new Error("manifest could not be resolved");
    }
    return parseWorkspaceBackfillManifest(parsed);
}

export function formatBackfillResult(result: WorkspaceBackfillResult): string {
    return JSON.stringify(result, null, 2);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<WorkspaceBackfillResult> {
    const options = parseBackfillCliOptions(argv);
    const manifest = loadWorkspaceBackfillManifest(options.manifestPath);
    const databaseUrl = readDatabaseUrl();
    assertLocalDatabaseUrl(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;

    const db = new PrismaClient();
    try {
        const result = await backfillWorkspaces(db, manifest, { apply: options.apply });
        process.stdout.write(`${formatBackfillResult(result)}\n`);
        if (!result.success) process.exitCode = 1;
        return result;
    } finally {
        await db.$disconnect();
    }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
    void main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : "Workspace backfill failed"}\n`);
        process.exitCode = 1;
    });
}
