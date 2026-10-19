import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateRelease, type ReleaseEvidence } from "./sabah-release-check";

const NOW = "2026-08-29T10:00:00.000Z";

const MANIFEST_BYTES = '{"model":"reviewed"}\n';
const MANIFEST_HASH = createHash("sha256").update(MANIFEST_BYTES).digest("hex");

function validEvidence(manifestHash = MANIFEST_HASH): ReleaseEvidence {
    return {
        requiredFilesClean: true,
        additiveMigration: { present: true, additiveOnly: true },
        databaseTarget: { confirmed: true, hostClass: "local" },
        backup: { verified: true, evidenceRef: "local-backup-evidence" },
        eval: { status: "pass", generatedAt: NOW, maxAgeHours: 24 },
        writesEnabled: false,
        config: { cronSecretConfigured: true, configPresent: true },
        modelManifest: { path: "model-manifest.json", sha256: manifestHash, reviewedSha256: manifestHash },
    };
}

function fixture(evidence: ReleaseEvidence = validEvidence()): string {
    const dir = mkdtempSync(resolve(tmpdir(), "sabah-release-check-"));
    writeFileSync(resolve(dir, "model-manifest.json"), MANIFEST_BYTES);
    writeFileSync(resolve(dir, "evidence.json"), `${JSON.stringify(evidence)}\n`);
    return dir;
}

function gate(result: ReturnType<typeof evaluateRelease>, id: string) {
    return result.gates.find((entry) => entry.id === id);
}

describe("Sabah release check", () => {
    it("passes only when explicit safe local artifacts satisfy every gate", () => {
        const dir = fixture();
        try {
            const result = evaluateRelease({ evidencePath: resolve(dir, "evidence.json"), artifactsDir: dir, now: NOW });
            expect(result.ok).toBe(true);
            expect(result.gates.every((entry) => entry.status === "PASS")).toBe(true);
            expect(result.output).not.toMatch(/secret|token|password|api[_-]?key/i);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it.each([
        ["dirty required files", { requiredFilesClean: false }, "SRC_CLEAN"],
        ["missing additive migration", { additiveMigration: { present: false, additiveOnly: true } }, "MIGRATION_ADDITIVE"],
        ["database-target confirmation mismatch", { databaseTarget: { confirmed: false, hostClass: "production" } }, "DB_TARGET_LOCAL"],
        ["missing backup evidence", { backup: { verified: false, evidenceRef: "" } }, "BACKUP_VERIFIED"],
        ["stale eval report", { eval: { status: "pass", generatedAt: "2026-08-27T00:00:00.000Z", maxAgeHours: 24 } }, "EVAL_FRESH_PASS"],
        ["failing eval report", { eval: { status: "fail", generatedAt: NOW, maxAgeHours: 24 } }, "EVAL_FRESH_PASS"],
        ["writes already enabled", { writesEnabled: true }, "WRITES_DISABLED"],
        ["missing CRON_SECRET/config", { config: { cronSecretConfigured: false, configPresent: false } }, "CONFIG_SAFE"],
        ["missing model manifest", { modelManifest: { path: "missing.json", sha256: "x", reviewedSha256: "x" } }, "MODEL_MANIFEST"],
        ["mismatched model manifest", { modelManifest: { path: "model-manifest.json", sha256: "actual-but-unreviewed", reviewedSha256: "different-reviewed" } }, "MODEL_MANIFEST"],
    ])("fails closed for %s", (_label, change, gateId) => {
        const evidence = { ...validEvidence(), ...change } as ReleaseEvidence;
        const dir = fixture(evidence);
        try {
            const result = evaluateRelease({ evidencePath: resolve(dir, "evidence.json"), artifactsDir: dir, now: NOW });
            expect(result.ok).toBe(false);
            expect(gate(result, gateId)?.status).toBe("FAIL");
            expect(result.output).not.toMatch(/secret|token|password|api[_-]?key/i);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("fails closed when evidence or required configuration is absent", () => {
        const result = evaluateRelease({ evidencePath: resolve(tmpdir(), "does-not-exist-sabah-evidence.json"), artifactsDir: tmpdir(), now: NOW });
        expect(result.ok).toBe(false);
        expect(result.gates.every((entry) => entry.status === "FAIL")).toBe(true);
        expect(result.output).not.toMatch(/secret|token|password|api[_-]?key/i);
    });

    it("blocks a missing target declaration without revealing configuration", () => {
        const dir = mkdtempSync(resolve(tmpdir(), "sabah-preflight-missing-target-"));
        try {
            let error: unknown;
            try {
                execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/sabah-migration-preflight.ts")], {
                    cwd: dir,
                    env: { ...process.env, DATABASE_URL: "[REDACTED]", SABAH_TARGET_ENV: "" },
                    encoding: "utf8",
                });
            } catch (caught) { error = caught; }
            const output = String(error && typeof error === "object" && "stdout" in error ? (error as { stdout?: string }).stdout : "") + String(error && typeof error === "object" && "stderr" in error ? (error as { stderr?: string }).stderr : "");
            expect(error).toBeTruthy();
            expect(output).toContain("status=BLOCKED");
            expect(output).toContain("target=[REDACTED]");
            expect(output).not.toContain("synthetic_db");
            expect(output).not.toContain("127.0.0.1");
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

    it("blocks an unsafe target and redacts its host and database", () => {
        const dir = mkdtempSync(resolve(tmpdir(), "sabah-preflight-unsafe-target-"));
        try {
            let error: unknown;
            try {
                execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/sabah-migration-preflight.ts")], {
                    cwd: dir,
                    env: { ...process.env, DATABASE_URL: "[REDACTED]", SABAH_TARGET_ENV: "production" },
                    encoding: "utf8",
                });
            } catch (caught) { error = caught; }
            const output = String(error && typeof error === "object" && "stdout" in error ? (error as { stdout?: string }).stdout : "") + String(error && typeof error === "object" && "stderr" in error ? (error as { stderr?: string }).stderr : "");
            expect(error).toBeTruthy();
            expect(output).toContain("status=BLOCKED");
            expect(output).toContain("target=[REDACTED]");
            expect(output).not.toContain("neon.synthetic.invalid");
            expect(output).not.toContain("fixture_database");
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
