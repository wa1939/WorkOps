// npm run vercel-build — Vercel/CI build entry with explicit, opt-in
// database preparation.
//
// Defaults are OFF: without the WORKOPS_DB_* gates this is exactly
// `next build`. A build never touches a database implicitly.
//
//   WORKOPS_DB_INIT_ON_BUILD=1   Before building: initialize an EMPTY target
//                                database (guarded, empty-only, refuses any
//                                database that already has tables).
//   WORKOPS_DB_MIGRATE_ON_BUILD=1 Before building: run `prisma migrate deploy`
//                                (safe, pending-only). Only enable this for
//                                environments that OWN their database; never
//                                point a preview at a shared production DB.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { readDatabaseUrl } from "../assert-local-database";
import { initDatabase, SetupRefused } from "./lib/init-core";
import { shouldInitDatabaseOnBuild, shouldMigrateOnBuild, shouldBootstrapAdminOnBuild } from "./lib/build-gates";
import { loadSetupEnvironment } from "./lib/environment";

function spawnStep(command: string, args: string[]): number {
    console.log(`[vercel-build] > ${command} ${args.join(" ")}`);
    const result = spawnSync(process.execPath, [command, ...args], { stdio: "inherit" });
    return result.status ?? 1;
}

async function main(): Promise<number> {
    loadSetupEnvironment();
    const resolvedDatabaseUrl = readDatabaseUrl();
    if (resolvedDatabaseUrl) process.env.DATABASE_URL = resolvedDatabaseUrl;
    if (process.env.VERCEL_ENV === "preview" && (
        shouldInitDatabaseOnBuild(process.env) || shouldMigrateOnBuild(process.env) || shouldBootstrapAdminOnBuild(process.env)
    )) throw new Error("Preview builds refuse database setup flags. Use a separate, explicitly initialized preview database and disable setup flags.");
    if (shouldInitDatabaseOnBuild(process.env)) {
        const databaseUrl = readDatabaseUrl();
        if (!databaseUrl) {
            console.error("[vercel-build] WORKOPS_DB_INIT_ON_BUILD=1 but DATABASE_URL is not set.");
            return 5;
        }
        const client = new PrismaClient({ log: ["error"], datasources: { db: { url: databaseUrl } } });
        try {
            await initDatabase({
                client,
                databaseUrl,
                runMigrateDeploy: () => ({ status: spawnStep(resolve("node_modules", "prisma", "build", "index.js"), ["migrate", "deploy"]) }),
                // The env var above IS the explicit consent for this build.
                confirm: async () => true,
                log: (line) => console.log(`[vercel-build] ${line}`),
            });
        } catch (error) {
            if (error instanceof SetupRefused && error.reason === "existing-workops") {
                // Repeated builds may reuse a known installation, never an unknown schema.
                console.warn(`[vercel-build] Init skipped: ${error.message}`);
            } else {
                throw error;
            }
        } finally {
            await client.$disconnect();
        }
    } else {
        console.log("[vercel-build] WORKOPS_DB_INIT_ON_BUILD not set — skipping database init.");
    }

    if (shouldMigrateOnBuild(process.env)) {
        console.log("[vercel-build] WORKOPS_DB_MIGRATE_ON_BUILD=1 — applying pending migrations.");
        const status = spawnStep(resolve("node_modules", "prisma", "build", "index.js"), ["migrate", "deploy"]);
        if (status !== 0) {
            console.error("[vercel-build] migrate deploy failed; aborting build.");
            return status;
        }
    } else {
        console.log("[vercel-build] WORKOPS_DB_MIGRATE_ON_BUILD not set — skipping migrations.");
    }

    if (shouldBootstrapAdminOnBuild(process.env)) {
        const status = spawnStep(resolve("node_modules", "tsx", "dist", "cli.mjs"), ["scripts/setup/create-admin.ts"]);
        if (status === 4) console.log("[vercel-build] Existing users found; no account or password was changed.");
        else if (status !== 0) return status;
    }
    return spawnStep(resolve("node_modules", "next", "dist", "bin", "next"), ["build"]);
}

main()
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error: unknown) => {
        console.error(`[vercel-build] Failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
