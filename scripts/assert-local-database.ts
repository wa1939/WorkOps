import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type LocalDatabaseUrlOptions = {
    requireDatabaseSuffix?: string;
};

function unquote(value: string): string {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

export function readDatabaseUrl(cwd = process.cwd(), env = process.env): string {
    if (env.DATABASE_URL) return env.DATABASE_URL;
    for (const filename of [".env.local", ".env"]) {
        const path = resolve(cwd, filename);
        if (!existsSync(path)) continue;
        const line = readFileSync(path, "utf8").split(/\r?\n/).find((entry) => /^DATABASE_URL\s*=/.test(entry));
        if (line) return unquote(line.slice(line.indexOf("=") + 1));
    }
    return "";
}

export function assertLocalDatabaseUrl(rawUrl: string, options: LocalDatabaseUrlOptions = {}): URL {
    if (!rawUrl) throw new Error("DATABASE_URL is not configured");
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error("DATABASE_URL is invalid");
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        throw new Error("Refusing database write: DATABASE_URL must use PostgreSQL");
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
    if (!LOCAL_HOSTS.has(hostname)) {
        throw new Error(`Refusing database write: host ${hostname} is not local`);
    }
    if (options.requireDatabaseSuffix) {
        let databaseName: string;
        try {
            databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
        } catch {
            throw new Error("DATABASE_URL is invalid");
        }
        if (!databaseName.endsWith(options.requireDatabaseSuffix)) {
            throw new Error(`Refusing database write: database name must end with ${options.requireDatabaseSuffix}`);
        }
    }
    return parsed;
}

const invokedScript = process.argv[1]?.replaceAll("\\", "/") ?? "";
if (/(^|\/)assert-local-database\.(?:ts|js)$/.test(invokedScript)) {
    const rawUrl = readDatabaseUrl();
    const parsed = assertLocalDatabaseUrl(rawUrl, { requireDatabaseSuffix: "_test" });
    console.log(`[db-safety] confirmed local PostgreSQL host: ${parsed.hostname}`);

    const separatorIndex = process.argv.indexOf("--", 2);
    const [command, ...args] = separatorIndex === -1 ? [] : process.argv.slice(separatorIndex + 1);
    if (!command) throw new Error("No command supplied after --");

    const result = spawnSync(command, args, {
        env: { ...process.env, DATABASE_URL: rawUrl },
        stdio: "inherit",
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
}
