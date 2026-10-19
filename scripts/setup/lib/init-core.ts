// Core fresh-install database initialization. Explicit, empty-only,
// non-destructive: it refuses to touch any database that already has
// tables, and it never drops anything. The actual schema creation is the
// standard, CI-verified `prisma migrate deploy` on the untouched historical
// migration chain (verified: empty postgres:16 + migrate deploy => exit 0,
// all 40 migrations applied).
//
// All side effects are injected so unit tests run fully mocked.

import {
    readDatabaseState,
    type DatabaseState,
    type PrismaLikeClient,
} from "./classify-database";
import { describeDatabaseTarget, maskDatabaseUrl } from "./mask-url";

export class SetupRefused extends Error {
    readonly reason:
        | "existing-workops"
        | "unknown-nonempty"
        | "aborted";
    constructor(reason: "existing-workops" | "unknown-nonempty" | "aborted", message: string) {
        super(message);
        this.name = "SetupRefused";
        this.reason = reason;
    }
}

export type MigrateDeployResult = { status: number };

export type InitDatabaseDeps = {
    client: PrismaLikeClient;
    databaseUrl: string;
    /** Runs `prisma migrate deploy`; returns the process exit status. */
    runMigrateDeploy: () => Promise<MigrateDeployResult> | MigrateDeployResult;
    /** Interactive confirmation; may be pre-approved via explicit env gates. */
    confirm: (message: string) => Promise<boolean>;
    log: (line: string) => void;
};

export type InitDatabaseResult = {
    state: DatabaseState;
    migrated: boolean;
};

export async function initDatabase(deps: InitDatabaseDeps): Promise<InitDatabaseResult> {
    const { client, databaseUrl, log } = deps;
    const report = await readDatabaseState(client);
    log(`Target database: ${describeDatabaseTarget(databaseUrl)} (${maskDatabaseUrl(databaseUrl)})`);

    if (report.state === "unknown-nonempty") {
        throw new SetupRefused(
            "unknown-nonempty",
            `Refusing to initialize: the target database contains ${report.tableCount} tables ` +
                "but no WorkOps migration history. This may be an existing application or " +
                "production database. Double-check DATABASE_URL. Nothing was written.",
        );
    }
    if (report.state === "existing-workops") {
        throw new SetupRefused(
            "existing-workops",
            "Refusing to initialize: this database already has WorkOps migration history " +
                "(_prisma_migrations found). To apply pending migrations use `npm run db:deploy`. " +
                "Nothing was written.",
        );
    }

    const approved = await deps.confirm(
        `Database is EMPTY (${report.tableCount} tables). Initialize WorkOps schema by running ` +
            "`prisma migrate deploy`? This creates tables but never drops existing data.",
    );
    if (!approved) {
        throw new SetupRefused("aborted", "Aborted by user. Nothing was written.");
    }

    log("Running `prisma migrate deploy` ...");
    const result = await deps.runMigrateDeploy();
    if (result.status !== 0) {
        throw new Error(
            `\`prisma migrate deploy\` exited with status ${result.status}. ` +
                "The database may be partially migrated; re-running `npm run db:setup` is safe " +
                "(migrate deploy only applies pending migrations and is non-destructive).",
        );
    }
    log("Schema initialized. Next: create the first admin with `npm run setup:admin`.");
    return { state: "empty", migrated: true };
}
