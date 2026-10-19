// npm run db:setup — explicit fresh-install database initialization.
//
// Safety contract:
//   * Only proceeds when the target database is completely EMPTY.
//   * Refuses (exit 2) a database with WorkOps migration history -> use db:deploy.
//   * Refuses (exit 3) any unknown non-empty schema (possible production).
//   * Never drops or truncates anything; `prisma migrate deploy` only creates
//     missing schema by applying the untouched historical migration chain.
//   * Asks for interactive confirmation unless WORKOPS_DB_INIT_ON_BUILD=1
//     (the same explicit opt-in used by Vercel builds).

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { PrismaClient } from "@prisma/client";
import { readDatabaseUrl } from "../assert-local-database";
import { initDatabase, SetupRefused } from "./lib/init-core";
import { shouldInitDatabaseOnBuild } from "./lib/build-gates";
import { loadSetupEnvironment } from "./lib/environment";

async function confirm(message: string): Promise<boolean> {
    if (shouldInitDatabaseOnBuild(process.env)) {
        console.log("[db:setup] auto-confirmed by WORKOPS_DB_INIT_ON_BUILD=1");
        return true;
    }
    if (!process.stdin.isTTY) {
        console.error(
            "[db:setup] Refusing to proceed non-interactively without explicit opt-in. " +
                "Re-run in a terminal, or set WORKOPS_DB_INIT_ON_BUILD=1 to confirm explicitly.",
        );
        return false;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = (await rl.question(`\n${message}\nType "yes" to continue: `)).trim().toLowerCase();
        return answer === "yes" || answer === "y";
    } finally {
        rl.close();
    }
}

function runMigrateDeploy(): { status: number } {
    const prismaCli = resolve("node_modules", "prisma", "build", "index.js");
    const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
        stdio: "inherit",
    });
    return { status: result.status ?? 1 };
}

async function main(): Promise<number> {
    loadSetupEnvironment();
    const databaseUrl = readDatabaseUrl();
    if (!databaseUrl) {
        console.error("[db:setup] DATABASE_URL is not configured (env, .env.local, or .env).");
        return 5;
    }
    process.env.DATABASE_URL = databaseUrl;
    const client = new PrismaClient({ log: ["error"], datasources: { db: { url: databaseUrl } } });
    try {
        await initDatabase({
            client,
            databaseUrl,
            runMigrateDeploy,
            confirm,
            log: (line) => console.log(`[db:setup] ${line}`),
        });
        return 0;
    } finally {
        await client.$disconnect();
    }
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error: unknown) => {
        if (error instanceof SetupRefused) {
            console.error(`[db:setup] ${error.message}`);
            process.exitCode =
                error.reason === "existing-workops" ? 2 : error.reason === "unknown-nonempty" ? 3 : 1;
            return;
        }
        console.error(`[db:setup] Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
