// Pure database-state classification shared by the setup tooling.
// No Prisma / network imports here so unit tests can run fully mocked.

export type DatabaseState =
    | "empty"
    | "existing-workops"
    | "unknown-nonempty";

/**
 * Counts base tables in the `public` schema. Prisma migrations bookkeeping
 * (`_prisma_migrations`) is itself a base table, so a count of 0 means a
 * truly untouched database (no app schema, no migration history).
 */
export const COUNT_PUBLIC_TABLES_SQL =
    "SELECT count(*)::int AS count FROM information_schema.tables " +
    "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'";

export const HAS_MIGRATIONS_TABLE_SQL =
    "SELECT count(*)::int AS count FROM information_schema.tables " +
    "WHERE table_schema = 'public' AND table_name = '_prisma_migrations'";

export function classifyDatabase(
    tableCount: number,
    hasMigrationsTable: boolean,
): DatabaseState {
    if (tableCount === 0) return "empty";
    if (hasMigrationsTable) return "existing-workops";
    return "unknown-nonempty";
}

export type PrismaLikeClient = {
    $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
    $disconnect(): Promise<void>;
};

export type DatabaseStateReport = {
    state: DatabaseState;
    tableCount: number;
};

/**
 * Reads the live state of the target database using the given Prisma client.
 * Connection failures propagate to the caller so CLIs can report a clear
 * "database unreachable" error without retrying or mutating anything.
 */
export async function readDatabaseState(
    client: PrismaLikeClient,
): Promise<DatabaseStateReport> {
    const tableRows = await client.$queryRawUnsafe<Array<{ count: number }>>(
        COUNT_PUBLIC_TABLES_SQL,
    );
    const tableCount = Number(tableRows?.[0]?.count ?? 0);
    let hasMigrationsTable = false;
    if (tableCount > 0) {
        const migrationRows = await client.$queryRawUnsafe<
            Array<{ count: number }>
        >(HAS_MIGRATIONS_TABLE_SQL);
        hasMigrationsTable = Number(migrationRows?.[0]?.count ?? 0) > 0;
    }
    return { state: classifyDatabase(tableCount, hasMigrationsTable), tableCount };
}
