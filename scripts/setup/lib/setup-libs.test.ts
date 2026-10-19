import { describe, expect, it } from "vitest";
import { checkRequiredEnv } from "./required-env";
import { shouldInitDatabaseOnBuild, shouldMigrateOnBuild } from "./build-gates";
import { maskDatabaseUrl, describeDatabaseTarget } from "./mask-url";

describe("checkRequiredEnv", () => {
    it("fails when DATABASE_URL or AUTH_SECRET are missing", () => {
        const report = checkRequiredEnv({});
        expect(report.ok).toBe(false);
        const missing = report.checks.filter((c) => c.required && !c.present).map((c) => c.name);
        expect(missing).toEqual(["DATABASE_URL", "AUTH_SECRET"]);
    });

    it("passes with the two required vars and reports optional ones", () => {
        const report = checkRequiredEnv({
            DATABASE_URL: "postgresql://localhost/db",
            AUTH_SECRET: "x".repeat(32),
        });
        expect(report.ok).toBe(true);
        const cron = report.checks.find((c) => c.name === "CRON_SECRET");
        expect(cron?.required).toBe(false);
        expect(cron?.present).toBe(false);
    });

    it("requires NEXTAUTH_URL in production mode", () => {
        const ok = checkRequiredEnv(
            { DATABASE_URL: "postgresql://localhost/db", AUTH_SECRET: "x".repeat(32) },
            { production: true },
        );
        expect(ok.ok).toBe(false);
        expect(ok.checks.find((c) => c.name === "NEXTAUTH_URL")?.required).toBe(true);
    });
});

describe("build gates", () => {
    it("default to off", () => {
        expect(shouldInitDatabaseOnBuild({})).toBe(false);
        expect(shouldMigrateOnBuild({})).toBe(false);
    });

    it("require the exact opt-in value 1", () => {
        expect(shouldInitDatabaseOnBuild({ WORKOPS_DB_INIT_ON_BUILD: "1" })).toBe(true);
        expect(shouldInitDatabaseOnBuild({ WORKOPS_DB_INIT_ON_BUILD: "true" })).toBe(false);
        expect(shouldMigrateOnBuild({ WORKOPS_DB_MIGRATE_ON_BUILD: "1" })).toBe(true);
        expect(shouldMigrateOnBuild({ WORKOPS_DB_MIGRATE_ON_BUILD: "yes" })).toBe(false);
    });
});

describe("maskDatabaseUrl", () => {
    it("masks the password but keeps host and database visible", () => {
        const masked = maskDatabaseUrl("postgresql://workops:s3cret@127.0.0.1:55479/workops_oss_test?schema=public");
        expect(masked).not.toContain("s3cret");
        expect(masked).toContain("127.0.0.1:55479");
        expect(masked).toContain("workops_oss_test");
    });

    it("describes the target without credentials", () => {
        const described = describeDatabaseTarget("postgresql://workops:s3cret@db.internal:5432/workops?schema=public");
        expect(described).toBe("db.internal:5432 database=workops");
        expect(described).not.toContain("s3cret");
    });
});
