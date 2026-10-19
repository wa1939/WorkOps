import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationPreflight = {
    databaseHost: string;
    databaseName: string;
    sslClass: "required" | "disabled" | "unspecified";
    migrationStatus: "not-checked-no-connection";
};

function databaseUrl(env = process.env): string {
    if (env.DATABASE_URL) return env.DATABASE_URL;
    for (const filename of [".env.local", ".env"]) {
        const path = resolve(filename);
        if (!existsSync(path)) continue;
        const line = readFileSync(path, "utf8").split(/\r?\n/).find((entry) => /^DATABASE_URL\s*=/.test(entry));
        if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");
    }
    return "";
}

export function inspectMigrationTarget(rawUrl = databaseUrl()): MigrationPreflight {
    if (!rawUrl) throw new Error("DATABASE_URL is not configured; no database was contacted");
    let url: URL;
    try { url = new URL(rawUrl); } catch { throw new Error("DATABASE_URL is invalid; no database was contacted"); }
    const ssl = (url.searchParams.get("sslmode") ?? "").toLowerCase();
    return {
        databaseHost: url.hostname || "redacted-host",
        databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")) || "redacted-database",
        sslClass: ssl === "disable" ? "disabled" : ssl ? "required" : "unspecified",
        migrationStatus: "not-checked-no-connection",
    };
}

function main(): void {
    const forbidden = /(?:db[\s_-]*push|migrate[\s_-]+reset|drop|truncate|delete|force)/i;
    if (process.argv.slice(2).some((arg) => forbidden.test(arg))) {
        process.stdout.write("[preflight] status=BLOCKED reason=destructive-command target=[REDACTED] database=[REDACTED] ssl=[REDACTED] migrations=not-checked-no-connection\n");
        process.exitCode = 1;
        return;
    }

    const target = process.env.SABAH_TARGET_ENV?.trim().toLowerCase();
    const rawUrl = databaseUrl();
    let metadata: MigrationPreflight;
    try {
        if (!target) throw new Error("target-missing");
        metadata = inspectMigrationTarget(rawUrl);
        const localHost = ["localhost", "127.0.0.1", "::1"].includes(new URL(rawUrl).hostname);
        if (target !== "local" || !localHost || metadata.sslClass === "disabled") throw new Error("target-unsafe");
    } catch {
        process.stdout.write("[preflight] status=BLOCKED reason=configuration-unsafe target=[REDACTED] database=[REDACTED] ssl=[REDACTED] migrations=not-checked-no-connection\n");
        process.exitCode = 1;
        return;
    }
    process.stdout.write(`[preflight] status=READY host=${metadata.databaseHost} database=${metadata.databaseName} ssl=${metadata.sslClass} migrations=${metadata.migrationStatus}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (error: unknown) {
        process.stderr.write(`${error instanceof Error ? error.message : "Migration preflight refused"}\n`);
        process.exitCode = 1;
    }
}
