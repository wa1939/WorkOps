// npm run setup:verify — read-only install doctor.
//
// Reports required/optional environment variables, database reachability,
// schema state (empty / initialized / unknown), user + admin counts, and
// gives next-step advice. NEVER writes to the database.

import { PrismaClient } from "@prisma/client";
import { readDatabaseUrl } from "../assert-local-database";
import { gatherHealth } from "./lib/health-core";
import { loadSetupEnvironment } from "./lib/environment";

async function main(): Promise<number> {
    loadSetupEnvironment();
    const env = { ...process.env, DATABASE_URL: readDatabaseUrl() };
    const client = new PrismaClient({ log: ["error"], datasources: { db: { url: env.DATABASE_URL } } });
    try {
        const report = await gatherHealth(env, client);
        console.log("[setup:verify] Environment:");
        for (const check of report.env.checks) {
            const mark = check.required ? (check.present ? "OK  " : "MISS") : check.present ? "set " : "opt ";
            console.log(`  [${mark}] ${check.name}${check.note ? ` — ${check.note}` : ""}`);
        }
        const db = report.database;
        console.log("[setup:verify] Database:");
        if (!db.reachable) {
            console.log(`  unreachable: ${db.error ?? "unknown error"}`);
        } else {
            console.log(`  state=${db.state} publicTables=${db.tableCount}`);
            if (db.appliedMigrations !== null) console.log(`  appliedMigrations=${db.appliedMigrations}`);
            if (db.userCount !== null) console.log(`  users=${db.userCount} admins=${db.adminCount ?? 0}`);
        }
        if (report.advice.length > 0) {
            console.log("[setup:verify] Advice:");
            for (const line of report.advice) console.log(`  - ${line}`);
        }
        if (!report.env.ok) return 5;
        if (!db.reachable) return 6;
        if (db.state === "unknown-nonempty") return 3;
        return 0;
    } finally {
        await client.$disconnect();
    }
}

main()
    .then((code) => {
        process.exitCode = code;
        if (code === 0) console.log("[setup:verify] No blocking problems found.");
    })
    .catch((error: unknown) => {
        console.error(`[setup:verify] Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
