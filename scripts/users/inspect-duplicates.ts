import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";

const SAFE_USER_SELECT = {
    id: true,
    email: true,
    name: true,
    role: true,
    isActive: true,
} as const;

const SENSITIVE_TABLE_NAME = /(?:session|account|credential|secret|token|auth[_-]?identity)/i;
const SENSITIVE_KEY_NAME = /(?:password|secret|token|session)/i;

export type InspectionMode = "dry-run";

export type InspectionOptions = {
    emails: string[];
    mode: InspectionMode;
};

export type SafeUser = {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
};

export type ForeignKeyInventoryEntry = {
    schema: string;
    table: string;
    column: string;
    constraintName: string;
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
    ordinalPosition: number;
};

export type UserReferenceReport = ForeignKeyInventoryEntry & {
    count: number;
    checksum: string | null;
};

export type UserInspectionReport = {
    requestedEmail: string;
    user: SafeUser | null;
    collisions: {
        sameNormalizedEmail: SafeUser[];
        sameNameAcrossActiveUsers: SafeUser[];
    };
    references: UserReferenceReport[];
    counts: Record<string, number>;
    checksums: Record<string, string>;
};

export type InspectionReport = {
    mode: InspectionMode;
    requestedEmails: string[];
    foreignKeyInventory: ForeignKeyInventoryEntry[];
    users: UserInspectionReport[];
};

type CatalogForeignKeyRow = {
    schema: string;
    table: string;
    column: string;
    constraintName: string;
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
    ordinalPosition: number | string | bigint;
};

type PrimaryKeyRow = {
    schema: string;
    table: string;
    column: string;
    ordinalPosition: number | string | bigint;
};

type SafeUserRow = {
    id: string;
    email: string;
    name: string;
    role: string;
    isActive: boolean;
};

type TransactionClient = Prisma.TransactionClient;

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
}

function collectionKey(entry: Pick<ForeignKeyInventoryEntry, "schema" | "table" | "column">): string {
    return `${entry.schema}.${entry.table}.${entry.column}`;
}

function tableKey(schema: string, table: string): string {
    return `${schema}.${table}`;
}

function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function normalizeName(name: string): string {
    return name.trim().toLowerCase();
}

function sha256Sorted(values: string[]): string {
    const sorted = [...values].sort();
    return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex");
}

function canChecksum(entry: ForeignKeyInventoryEntry, primaryKeyColumns: string[]): boolean {
    if (SENSITIVE_TABLE_NAME.test(`${entry.schema}.${entry.table}`)) return false;
    if (primaryKeyColumns.length === 0) return false;
    return primaryKeyColumns.every((column) => !SENSITIVE_KEY_NAME.test(column));
}

export function parseOptions(argv: readonly string[]): InspectionOptions {
    const emails: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--dry-run") continue;
        if (argument === "--apply") {
            throw new Error("--apply is not supported by this read-only inventory packet");
        }
        if (argument === "--email") {
            const email = argv[index + 1];
            if (!email || email.startsWith("--")) throw new Error("--email requires a value");
            emails.push(email);
            index += 1;
            continue;
        }
        if (argument.startsWith("--email=")) {
            const email = argument.slice("--email=".length);
            if (!email) throw new Error("--email requires a value");
            emails.push(email);
            continue;
        }
        throw new Error(`Unknown option: ${argument}`);
    }

    if (emails.length === 0) throw new Error("At least one --email is required");
    return { emails, mode: "dry-run" };
}

async function loadForeignKeyInventory(tx: TransactionClient): Promise<ForeignKeyInventoryEntry[]> {
    const rows = await tx.$queryRaw<CatalogForeignKeyRow[]>`
        SELECT
            source_namespace.nspname AS "schema",
            source_relation.relname AS "table",
            source_column.attname AS "column",
            constraint_row.conname AS "constraintName",
            target_namespace.nspname AS "referencedSchema",
            target_relation.relname AS "referencedTable",
            target_column.attname AS "referencedColumn",
            source_columns.ordinality AS "ordinalPosition"
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS source_relation
            ON source_relation.oid = constraint_row.conrelid
        JOIN pg_namespace AS source_namespace
            ON source_namespace.oid = source_relation.relnamespace
        JOIN pg_class AS target_relation
            ON target_relation.oid = constraint_row.confrelid
        JOIN pg_namespace AS target_namespace
            ON target_namespace.oid = target_relation.relnamespace
        CROSS JOIN LATERAL unnest(constraint_row.conkey) WITH ORDINALITY
            AS source_columns(attnum, ordinality)
        JOIN pg_attribute AS source_column
            ON source_column.attrelid = constraint_row.conrelid
            AND source_column.attnum = source_columns.attnum
        JOIN LATERAL unnest(constraint_row.confkey) WITH ORDINALITY
            AS target_columns(attnum, ordinality)
            ON target_columns.ordinality = source_columns.ordinality
        JOIN pg_attribute AS target_column
            ON target_column.attrelid = constraint_row.confrelid
            AND target_column.attnum = target_columns.attnum
        WHERE constraint_row.contype = 'f'
          AND target_namespace.nspname = 'public'
          AND target_relation.relname = 'User'
          AND source_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY
            source_namespace.nspname,
            source_relation.relname,
            constraint_row.conname,
            source_columns.ordinality
    `;

    return rows
        .map((row) => ({ ...row, ordinalPosition: Number(row.ordinalPosition) }))
        .sort((left, right) =>
            `${left.schema}.${left.table}.${left.constraintName}.${left.ordinalPosition}`.localeCompare(
                `${right.schema}.${right.table}.${right.constraintName}.${right.ordinalPosition}`,
            ),
        );
}

async function loadPrimaryKeyColumns(tx: TransactionClient): Promise<Map<string, string[]>> {
    const rows = await tx.$queryRaw<PrimaryKeyRow[]>`
        SELECT
            table_namespace.nspname AS "schema",
            table_relation.relname AS "table",
            table_column.attname AS "column",
            primary_columns.ordinality AS "ordinalPosition"
        FROM pg_index AS primary_index
        JOIN pg_class AS table_relation
            ON table_relation.oid = primary_index.indrelid
        JOIN pg_namespace AS table_namespace
            ON table_namespace.oid = table_relation.relnamespace
        CROSS JOIN LATERAL unnest(primary_index.indkey) WITH ORDINALITY
            AS primary_columns(attnum, ordinality)
        JOIN pg_attribute AS table_column
            ON table_column.attrelid = primary_index.indrelid
            AND table_column.attnum = primary_columns.attnum
        WHERE primary_index.indisprimary
          AND table_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
        ORDER BY
            table_namespace.nspname,
            table_relation.relname,
            primary_columns.ordinality
    `;

    const columns = new Map<string, string[]>();
    for (const row of rows) {
        const key = tableKey(row.schema, row.table);
        const existing = columns.get(key) ?? [];
        existing.push(row.column);
        columns.set(key, existing);
    }
    return columns;
}

async function findSameNormalizedEmail(tx: TransactionClient, email: string): Promise<SafeUser[]> {
    return tx.$queryRaw<SafeUser[]>`
        SELECT "id", "email", "name", "role", "isActive"
        FROM "User"
        WHERE lower(btrim("email")) = ${normalizeEmail(email)}
        ORDER BY "id"
    `;
}

async function findSameActiveName(tx: TransactionClient, name: string): Promise<SafeUser[]> {
    const normalizedName = normalizeName(name);
    if (!normalizedName) return [];

    return tx.$queryRaw<SafeUser[]>`
        SELECT "id", "email", "name", "role", "isActive"
        FROM "User"
        WHERE "isActive" = true
          AND btrim("name") <> ''
          AND lower(btrim("name")) = ${normalizedName}
        ORDER BY "id"
    `;
}

async function readReference(
    tx: TransactionClient,
    entry: ForeignKeyInventoryEntry,
    userId: string,
    primaryKeyColumns: string[],
): Promise<Pick<UserReferenceReport, "count" | "checksum">> {
    const sourceTable = `${quoteIdentifier(entry.schema)}.${quoteIdentifier(entry.table)}`;
    const sourceColumn = quoteIdentifier(entry.column);

    if (canChecksum(entry, primaryKeyColumns)) {
        const selectedColumns = primaryKeyColumns.map(quoteIdentifier).join(", ");
        const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `SELECT ${selectedColumns} FROM ${sourceTable} WHERE ${sourceColumn} = $1`,
            userId,
        );
        const values = rows.map((row) => primaryKeyColumns.map((column) => String(row[column])).join("\u0000"));
        return { count: rows.length, checksum: sha256Sorted(values) };
    }

    const rows = await tx.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
        `SELECT COUNT(*)::bigint AS "count" FROM ${sourceTable} WHERE ${sourceColumn} = $1`,
        userId,
    );
    return { count: Number(rows[0]?.count ?? 0), checksum: null };
}

async function inspectUser(
    tx: TransactionClient,
    requestedEmail: string,
    foreignKeyInventory: ForeignKeyInventoryEntry[],
    primaryKeyColumns: Map<string, string[]>,
): Promise<UserInspectionReport> {
    const user = await tx.user.findUnique({ where: { email: requestedEmail }, select: SAFE_USER_SELECT });
    if (!user) {
        return {
            requestedEmail,
            user: null,
            collisions: { sameNormalizedEmail: [], sameNameAcrossActiveUsers: [] },
            references: [],
            counts: {},
            checksums: {},
        };
    }

    const sameNormalizedEmail = await findSameNormalizedEmail(tx, user.email);
    const sameNameAcrossActiveUsers = await findSameActiveName(tx, user.name);
    const references: UserReferenceReport[] = [];
    const counts: Record<string, number> = {};
    const checksums: Record<string, string> = {};

    for (const entry of foreignKeyInventory) {
        const result = await readReference(
            tx,
            entry,
            user.id,
            primaryKeyColumns.get(tableKey(entry.schema, entry.table)) ?? [],
        );
        const reference = { ...entry, ...result };
        references.push(reference);
        const key = collectionKey(entry);
        counts[key] = result.count;
        if (result.checksum) checksums[key] = result.checksum;
    }

    return {
        requestedEmail,
        user,
        collisions: {
            sameNormalizedEmail: sameNormalizedEmail.length > 1 ? sameNormalizedEmail : [],
            sameNameAcrossActiveUsers: sameNameAcrossActiveUsers.length > 1 ? sameNameAcrossActiveUsers : [],
        },
        references,
        counts,
        checksums,
    };
}

export async function runInspection(
    options: InspectionOptions,
    db: PrismaClient = new PrismaClient(),
): Promise<InspectionReport> {
    if (options.mode !== "dry-run") throw new Error("Only dry-run mode is supported by this packet");
    if (options.emails.length === 0) throw new Error("At least one --email is required");

    return db.$transaction(
        async (tx) => {
            await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
            const foreignKeyInventory = await loadForeignKeyInventory(tx);
            const primaryKeyColumns = await loadPrimaryKeyColumns(tx);
            const users: UserInspectionReport[] = [];
            for (const email of options.emails) {
                users.push(await inspectUser(tx, email, foreignKeyInventory, primaryKeyColumns));
            }
            return {
                mode: "dry-run",
                requestedEmails: [...options.emails],
                foreignKeyInventory,
                users,
            } satisfies InspectionReport;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    const options = parseOptions(argv);
    const db = new PrismaClient();
    try {
        const report = await runInspection(options, db);
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } finally {
        await db.$disconnect();
    }
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
    void main().catch((error: unknown) => {
        process.stderr.write(`${error instanceof Error ? error.message : "Inspection failed"}\n`);
        process.exitCode = 1;
    });
}
