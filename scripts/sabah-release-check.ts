import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ReleaseEvidence = {
    requiredFilesClean: boolean;
    additiveMigration: { present: boolean; additiveOnly: boolean };
    databaseTarget: { confirmed: boolean; hostClass: "local" | "cloud" | string };
    backup: { verified: boolean; evidenceRef: string };
    eval: { status: "pass" | "fail" | string; generatedAt: string; maxAgeHours: number };
    writesEnabled: boolean;
    config: { cronSecretConfigured: boolean; configPresent: boolean };
    modelManifest: { path: string; sha256: string; reviewedSha256: string };
};

type Gate = { id: string; status: "PASS" | "FAIL"; reason: string };
export type ReleaseCheckResult = { ok: boolean; gates: Gate[]; output: string };

type Options = { evidencePath: string; artifactsDir: string; now?: string };

const GATE_IDS = ["SRC_CLEAN", "MIGRATION_ADDITIVE", "DB_TARGET_LOCAL", "BACKUP_VERIFIED", "EVAL_FRESH_PASS", "WRITES_DISABLED", "CONFIG_SAFE", "MODEL_MANIFEST"] as const;
const safe = (value: unknown): string => typeof value === "string" && value.length > 0 ? value : "missing or invalid evidence";

function gate(id: string, passed: boolean, reason: string): Gate {
    return { id, status: passed ? "PASS" : "FAIL", reason: passed ? "confirmed" : reason };
}

function loadEvidence(path: string): Partial<ReleaseEvidence> {
    if (!existsSync(path)) return {};
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        return parsed !== null && typeof parsed === "object" ? parsed as Partial<ReleaseEvidence> : {};
    } catch { return {}; }
}

export function evaluateRelease({ evidencePath, artifactsDir, now = new Date().toISOString() }: Options): ReleaseCheckResult {
    const evidence = loadEvidence(evidencePath);
    const additive = evidence.additiveMigration;
    const db = evidence.databaseTarget;
    const backup = evidence.backup;
    const evaluation = evidence.eval;
    const config = evidence.config;
    const manifest = evidence.modelManifest;
    const manifestPath = manifest?.path ? resolve(artifactsDir, manifest.path) : "";
    let manifestMatches = false;
    if (manifestPath && existsSync(manifestPath) && manifest?.sha256 && manifest.reviewedSha256) {
        const actual = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
        manifestMatches = actual === manifest.sha256 && manifest.sha256 === manifest.reviewedSha256;
    }
    let evalFresh = false;
    if (evaluation?.status === "pass" && typeof evaluation.generatedAt === "string" && Number.isFinite(evaluation.maxAgeHours)) {
        const ageMs = Date.parse(now) - Date.parse(evaluation.generatedAt);
        evalFresh = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= evaluation.maxAgeHours * 60 * 60 * 1000;
    }
    const gates: Gate[] = [
        gate("SRC_CLEAN", evidence.requiredFilesClean === true, "required files are dirty or unconfirmed"),
        gate("MIGRATION_ADDITIVE", additive?.present === true && additive.additiveOnly === true, "additive migration evidence is missing or unsafe"),
        gate("DB_TARGET_LOCAL", db?.confirmed === true && db.hostClass === "local", "database target is not explicitly confirmed local"),
        gate("BACKUP_VERIFIED", backup?.verified === true && typeof backup.evidenceRef === "string" && backup.evidenceRef.length > 0, "backup evidence is missing"),
        gate("EVAL_FRESH_PASS", evalFresh, "evaluation report is stale, failing, or missing"),
        gate("WRITES_DISABLED", evidence.writesEnabled === false, "writes are enabled"),
        gate("CONFIG_SAFE", config?.cronSecretConfigured === true && config.configPresent === true, "required cron authentication/configuration is missing"),
        gate("MODEL_MANIFEST", manifestMatches, "model manifest is missing or does not match reviewed evidence"),
    ];
    const ok = gates.every((entry) => entry.status === "PASS");
    const output = gates.map((entry) => `[${entry.status}] ${entry.id}: ${entry.reason}`).join("\n");
    return { ok, gates, output };
}

function main(): void {
    const args = process.argv.slice(2);
    if (!args.includes("--dry-run")) throw new Error("Refusing release check without explicit --dry-run");
    const value = (name: string): string | undefined => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
    const evidencePath = value("--evidence");
    const artifactsDir = value("--artifacts-dir");
    if (!evidencePath || !artifactsDir) throw new Error("Safe dry-run requires --evidence and --artifacts-dir");
    const result = evaluateRelease({ evidencePath: resolve(evidencePath), artifactsDir: resolve(artifactsDir) });
    process.stdout.write(`${result.output}\n`);
    process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (error: unknown) {
        process.stderr.write(`${error instanceof Error ? error.message : "Release check refused"}\n`);
        process.exitCode = 1;
    }
}

export { GATE_IDS, safe };
