// Read-only install health report. Never writes to the database.

import { checkRequiredEnv, type EnvReport } from "./required-env";
import { readDatabaseState } from "./classify-database";

export type HealthClient = {
    $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
    $disconnect(): Promise<void>;
};

export type HealthReport = {
    env: EnvReport;
    database: {
        reachable: boolean;
        state: "empty" | "existing-workops" | "unknown-nonempty" | "unreachable";
        tableCount: number;
        userCount: number | null;
        appliedMigrations: number | null;
        adminCount: number | null;
        error?: string;
    };
    advice: string[];
};

const COUNT_USERS_SQL = 'SELECT count(*)::int AS count FROM "User"';
const COUNT_MIGRATIONS_SQL = "SELECT count(*)::int AS count FROM _prisma_migrations";
const COUNT_ADMINS_SQL = 'SELECT count(*)::int AS count FROM "User" WHERE role = \'ADMIN\'';

export async function gatherHealth(
    env: Record<string, string | undefined>,
    client: HealthClient,
): Promise<HealthReport> {
    const envReport = checkRequiredEnv(env, { production: env.NODE_ENV === "production" });
    const advice: string[] = [];
    const report: HealthReport = {
        env: envReport,
        database: {
            reachable: false,
            state: "unreachable",
            tableCount: 0,
            userCount: null,
            appliedMigrations: null,
            adminCount: null,
        },
        advice,
    };

    if (!envReport.ok) {
        advice.push(
            "Set the missing required environment variables (see docs/deployment/configuration.md).",
        );
        return report;
    }

    try {
        const state = await readDatabaseState(client);
        report.database.reachable = true;
        report.database.state = state.state;
        report.database.tableCount = state.tableCount;
        if (state.state === "empty") {
            advice.push("Database is empty. Run `npm run db:setup` to initialize the schema.");
        } else if (state.state === "existing-workops") {
            const migrationRows = await client.$queryRawUnsafe<Array<{ count: number }>>(
                COUNT_MIGRATIONS_SQL,
            );
            report.database.appliedMigrations = Number(migrationRows?.[0]?.count ?? 0);
            const userRows = await client.$queryRawUnsafe<Array<{ count: number }>>(COUNT_USERS_SQL);
            report.database.userCount = Number(userRows?.[0]?.count ?? 0);
            if (report.database.userCount > 0) {
                const adminRows = await client.$queryRawUnsafe<Array<{ count: number }>>(
                    COUNT_ADMINS_SQL,
                );
                report.database.adminCount = Number(adminRows?.[0]?.count ?? 0);
            }
            advice.push("Run `npm run db:deploy` after pulling schema updates.");
            if (report.database.adminCount === 0) {
                advice.push("No ADMIN user found. If this is a fresh install run `npm run setup:admin`.");
            }
        } else {
            advice.push(
                "Unknown non-empty schema: verify DATABASE_URL. This tool will not modify it.",
            );
        }
    } catch (error) {
        report.database.error = error instanceof Error ? error.message : String(error);
        advice.push("Database unreachable: is PostgreSQL running and is DATABASE_URL correct?");
    }
    return report;
}
