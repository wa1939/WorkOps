import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import * as monitorService from "@/lib/sabah/monitors/service";
import type { DurableMonitorOutcome, DurableMonitorRunResult } from "@/lib/sabah/monitors/service";

export const maxDuration = 60;

type MonitorRunResult = Omit<DurableMonitorRunResult, "outcomes"> & { outcomes?: DurableMonitorOutcome[] };
export type SabahMonitorCronDeps = { secret?: string; run?: () => Promise<MonitorRunResult> };

const DEFAULT_BATCH = 10;
const MAX_BATCH = 100;
const unavailable = () => NextResponse.json({ error: "MONITOR_RUN_UNAVAILABLE" }, { status: 503 });

function sameSecret(expected: string, supplied: string | null): boolean {
    if (!supplied) return false;
    const expectedBytes = Buffer.from(expected, "utf8");
    const suppliedBytes = Buffer.from(supplied, "utf8");
    if (expectedBytes.length !== suppliedBytes.length) return false;
    return timingSafeEqual(expectedBytes, suppliedBytes);
}

function configuredBatch(): number {
    const parsed = Number.parseInt(process.env.SABAH_MONITORS_BATCH_SIZE ?? process.env.SABAH_MONITOR_BATCH_SIZE ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_BATCH) : DEFAULT_BATCH;
}

function durableBatchRunner(): ((options: { maxMonitors: number }) => Promise<DurableMonitorRunResult>) | undefined {
    try {
        const candidate = (monitorService as { runDurableMonitorBatch?: unknown }).runDurableMonitorBatch;
        return typeof candidate === "function" ? candidate as (options: { maxMonitors: number }) => Promise<DurableMonitorRunResult> : undefined;
    } catch {
        return undefined;
    }
}

function localRuntimeConfigured(): boolean {
    return process.env.SABAH_PLAN10_LOCAL_RUNTIME === "1";
}

async function localControlRun(): Promise<MonitorRunResult> {
    const portText = process.env.SABAH_PLAN10_CONTROL_PORT ?? "4010";
    if (!/^\d{1,5}$/.test(portText)) throw new Error("Invalid local control port");
    const port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Invalid local control port");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
        const response = await fetch(`http://127.0.0.1:${port}/monitor/run`, { method: "POST", headers: { accept: "application/json" }, signal: controller.signal });
        const text = await response.text();
        if (!response.ok || text.length > 8_192) throw new Error("Local monitor control failed");
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch { throw new Error("Local monitor control returned malformed JSON"); }
        if (!validResult(parsed)) throw new Error("Local monitor control returned invalid counts");
        return parsed;
    } finally { clearTimeout(timer); }
}

function validCount(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_BATCH;
}

function validOutcome(value: unknown): value is DurableMonitorOutcome {
    if (typeof value !== "object" || value === null) return false;
    const outcome = value as Partial<DurableMonitorOutcome>;
    return typeof outcome.monitorId === "string" && outcome.monitorId.length > 0 && outcome.monitorId.length <= 160
        && typeof outcome.key === "string" && outcome.key.length > 0 && outcome.key.length <= 128
        && (outcome.status === "created" || outcome.status === "suppressed" || outcome.status === "error")
        && typeof outcome.created === "boolean" && typeof outcome.suppressed === "boolean"
        && validCount(outcome.evidenceCount)
        && (outcome.fingerprint === undefined || (typeof outcome.fingerprint === "string" && outcome.fingerprint.length <= 255));
}

function validResult(result: unknown, limit = MAX_BATCH): result is MonitorRunResult {
    if (typeof result !== "object" || result === null) return false;
    const candidate = result as MonitorRunResult;
    if (!validCount(candidate.evaluated) || !validCount(candidate.created) || !validCount(candidate.suppressed) || !validCount(candidate.errors)) return false;
    if (candidate.created + candidate.suppressed !== candidate.evaluated || candidate.evaluated + candidate.errors > limit) return false;
    if (candidate.outcomes === undefined) return true;
    if (!Array.isArray(candidate.outcomes) || candidate.outcomes.length !== candidate.evaluated + candidate.errors || !candidate.outcomes.every(validOutcome)) return false;
    const created = candidate.outcomes.filter((outcome) => outcome.status === "created");
    const suppressed = candidate.outcomes.filter((outcome) => outcome.status === "suppressed");
    const errors = candidate.outcomes.filter((outcome) => outcome.status === "error");
    return created.length === candidate.created && suppressed.length === candidate.suppressed && errors.length === candidate.errors;
}

function safeResponse(result: MonitorRunResult): Record<string, unknown> {
    const response: Record<string, unknown> = { ok: true, evaluated: result.evaluated, created: result.created, suppressed: result.suppressed, errors: result.errors };
    if (result.outcomes) response.outcomes = result.outcomes;
    return response;
}

async function handleSabahMonitors(request: Request, deps: SabahMonitorCronDeps = {}) {
    const secret = deps.secret ?? process.env.CRON_SECRET;
    if (!secret || !sameSecret(`Bearer ${secret}`, request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const durableRun = durableBatchRunner();
    const run = deps.run
        ?? (localRuntimeConfigured()
            ? localControlRun
            : durableRun && process.env.DATABASE_URL
                ? () => durableRun({ maxMonitors: configuredBatch() })
                : undefined);
    if (!run) {
        // Production uses the durable AiJob/AiJobAttempt monitor envelope above;
        // the explicit loopback adapter is only a backwards-compatible local
        // harness. Missing database configuration is a deployment error, not a
        // reason to silently skip an authenticated durable invocation.
        if (process.env.SABAH_MONITORS_ENABLED === "true") return unavailable();
        return NextResponse.json({ ok: true, skipped: true, reason: "MONITORS_DISABLED" });
    }
    try {
        const result = await run();
        const validationLimit = result.outcomes ? configuredBatch() : deps.run ? 7 : configuredBatch();
        if (!validResult(result, validationLimit)) return NextResponse.json({ error: "Monitor run failed" }, { status: 500 });
        if (!deps.run && result.outcomes?.length === 0) {
            if (process.env.SABAH_MONITORS_ENABLED === "true") return unavailable();
            return NextResponse.json({ ok: true, skipped: true, reason: "MONITORS_DISABLED" });
        }
        return NextResponse.json(safeResponse(result));
    } catch {
        return NextResponse.json({ error: "Monitor run failed" }, { status: 500 });
    }
}

export function GET(request: Request, deps?: SabahMonitorCronDeps) { return handleSabahMonitors(request, deps); }
export function POST(request: Request, deps?: SabahMonitorCronDeps) { return handleSabahMonitors(request, deps); }
