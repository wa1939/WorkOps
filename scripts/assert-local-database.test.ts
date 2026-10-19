import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl } from "./assert-local-database";

describe("assertLocalDatabaseUrl", () => {
    it.each(["localhost", "127.0.0.1", "::1"])("accepts %s", (host) => {
        const formattedHost = host === "::1" ? `[${host}]` : host;
        expect(() => assertLocalDatabaseUrl(`postgresql://u:***@${formattedHost}:5432/test`)).not.toThrow();
    });

    it("accepts any local PostgreSQL port when the database is a test database", () => {
        expect(() =>
            assertLocalDatabaseUrl("postgresql://u:***@localhost:6543/departmenthub_verification_test", { requireDatabaseSuffix: "_test" }),
        ).not.toThrow();
    });

    it("rejects Neon and does not echo credentials", () => {
        expect(() =>
            assertLocalDatabaseUrl("postgresql://secret-user:secret-pass@ep-prod.neon.tech/prod"),
        ).toThrow(/^Refusing database write: host ep-prod\.neon\.tech is not local$/);
    });

    it("rejects a missing URL", () => {
        expect(() => assertLocalDatabaseUrl("")).toThrow(/^DATABASE_URL is not configured$/);
    });

    it("rejects a malformed URL without echoing credentials", () => {
        expect(() => assertLocalDatabaseUrl("postgresql://secret-user:secret-pass@[")).toThrow(
            /^DATABASE_URL is invalid$/,
        );
    });

    it("passes the exact validated URL to the wrapped child process", () => {
        const directory = mkdtempSync(resolve(tmpdir(), "database-guard-"));
        const outputPath = resolve(directory, "child-database-url.txt");
        const rawUrl = "postgresql://file-user:***@localhost:5432/departmenthub_verification_test?schema=validated";
        const guardPath = resolve("scripts/assert-local-database.ts");
        const tsxPath = resolve("node_modules/tsx/dist/cli.mjs");

        try {
            writeFileSync(resolve(directory, ".env.local"), `DATABASE_URL=${rawUrl}\n`);
            const result = spawnSync(
                process.execPath,
                [
                    tsxPath,
                    guardPath,
                    "--",
                    process.execPath,
                    "-e",
                    "require('node:fs').writeFileSync(process.argv[1], process.env.DATABASE_URL ?? '')",
                    outputPath,
                ],
                {
                    cwd: directory,
                    encoding: "utf8",
                    env: { ...process.env, DATABASE_URL: "" },
                },
            );

            expect(result.status).toBe(0);
            expect(existsSync(outputPath)).toBe(true);
            expect(readFileSync(outputPath, "utf8")).toBe(rawUrl);
        } finally {
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it.each([
        ["an unsafe local database name", "postgresql://probe-user:***@127.0.0.1:5437/departmenthub_verification", "database name must end with _test"],
        ["an empty URL", "", "DATABASE_URL is not configured"],
        ["an absent URL", undefined, "DATABASE_URL is not configured"],
    ])("refuses %s before spawning a child", (_label, databaseUrl, expectedError) => {
        const directory = mkdtempSync(resolve(tmpdir(), "database-guard-probe-"));
        const markerPath = resolve(directory, "child-must-not-run.txt");
        const guardPath = resolve("scripts/assert-local-database.ts");
        const tsxPath = resolve("node_modules/tsx/dist/cli.mjs");
        const env = { ...process.env };
        if (databaseUrl === undefined) delete env.DATABASE_URL;
        else env.DATABASE_URL = databaseUrl;

        try {
            const result = spawnSync(
                process.execPath,
                [
                    tsxPath,
                    guardPath,
                    "--",
                    process.execPath,
                    "-e",
                    "require('node:fs').writeFileSync(process.argv[1], 'unexpected-child-execution')",
                    markerPath,
                ],
                { cwd: directory, encoding: "utf8", env },
            );
            const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

            expect(result.status).not.toBe(0);
            expect(output).toContain(expectedError);
            expect(output).not.toContain("probe-user");
            expect(existsSync(markerPath)).toBe(false);
        } finally {
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it("rejects an unsafe local database before Playwright global setup can run", () => {
        const tsxPath = resolve("node_modules/tsx/dist/cli.mjs");
        const result = spawnSync(process.execPath, [tsxPath, "-e", "import('./playwright.config.ts')"], {
            cwd: resolve("."),
            encoding: "utf8",
            timeout: 45_000,
            env: {
                ...process.env,
                DATABASE_URL: "postgresql://probe-user:***@127.0.0.1:5437/departmenthub_verification",
            },
        });
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

        expect(result.status).not.toBe(0);
        expect(output).toContain("database name must end with _test");
        expect(output).not.toContain("probe-user");
    }, 60_000);

    it.each([
        ["a non-loopback URL", "postgresql://secret-user:***@192.0.2.1:5432/prod", "Refusing database write: host 192.0.2.1 is not local"],
        ["a malformed URL", "postgresql://secret-user:secret-pass@[", "DATABASE_URL is invalid"],
    ])("fails the lifecycle concurrency suite safely for %s", (_label, databaseUrl, expectedError) => {
        const vitestPath = resolve("node_modules/vitest/vitest.mjs");
        const testPath = resolve("src/lib/pmo/lifecycle-concurrency.test.ts");
        const result = spawnSync(process.execPath, [vitestPath, "run", testPath], {
            encoding: "utf8",
            env: { ...process.env, DATABASE_URL: databaseUrl },
            timeout: 30_000,
        });
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

        expect(result.status).not.toBe(0);
        expect(output).toContain(expectedError);
        expect(output).not.toContain("secret-user");
        expect(output).not.toContain("secret-pass");
    });

    it("fails the DATE persistence suite safely for a non-loopback URL", () => {
        const vitestPath = resolve("node_modules/vitest/vitest.mjs");
        const testPath = resolve("src/lib/pmo/date-persistence.test.ts");
        const result = spawnSync(process.execPath, [vitestPath, "run", testPath], {
            encoding: "utf8",
            env: { ...process.env, DATABASE_URL: "postgresql://secret-user:***@192.0.2.1:5432/prod" },
            timeout: 30_000,
        });
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

        expect(result.status).not.toBe(0);
        expect(output).toContain("Refusing database write: host 192.0.2.1 is not local");
        expect(output).not.toContain("secret-user");
    });
});
