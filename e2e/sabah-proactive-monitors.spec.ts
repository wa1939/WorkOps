import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
const enabled = process.env.SABAH_PLAN10_E2E === "1";
const storageState = process.env.SABAH_PLAN10_STORAGE_STATE;
const secret = process.env.CRON_SECRET;
const suggestionUrl = process.env.SABAH_PLAN10_SUGGESTIONS_URL;
const casesJson = process.env.SABAH_PLAN10_SUGGESTION_CASES;
const snoozeUrl = process.env.SABAH_PLAN10_SNOOZE_URL;
const dismissUrl = process.env.SABAH_PLAN10_DISMISS_URL;
const materialChangeUrl = process.env.SABAH_PLAN10_MATERIAL_CHANGE_URL;
const cooldownUrl = process.env.SABAH_PLAN10_COOLDOWN_URL;

type Obj = Record<string, unknown>;
type Evidence = { sourceId: string; fingerprint: string; classification: "authorized"; freshness: string; checksum: string; authorization: "authorized" };
type Case = { monitorKey: string; caseId: string; fingerprint: string; sourceIds: string[]; authorizedSourceIds: string[] };
type Suggestion = { id: string; monitorKey: string; caseId: string; fingerprint: string; state: string; evidence: Evidence[]; sourceIds: string[]; authorizedSourceIds: string[]; cooldownUntil: string; snoozedUntil?: string; dismissedAt?: string; version?: number };
const MONITOR_KEYS = ["stale-work", "dependency-risk", "duplicate-initiatives", "kpi-gaps", "workload-conflict", "missing-updates", "deadlines"];
const fail = (m: string): Error => new Error(`Plan10 E2E provisioning error: ${m}`);
const obj = (v: unknown, label: string): Obj => { if (typeof v !== "object" || v === null || Array.isArray(v)) throw fail(`${label} is malformed`); return Object.fromEntries(Object.entries(v)); };
async function body(response: import("@playwright/test").APIResponse, label: string): Promise<unknown> { if (!response.ok()) throw fail(`${label} returned HTTP ${response.status()}`); try { return JSON.parse(await response.text()); } catch { throw fail(`${label} returned malformed JSON`); } }
function isCase(v: unknown): v is Case { if (typeof v !== "object" || v === null || Array.isArray(v)) return false; const r = Object.fromEntries(Object.entries(v)); return typeof r.monitorKey === "string" && MONITOR_KEYS.includes(r.monitorKey) && typeof r.caseId === "string" && typeof r.fingerprint === "string" && Array.isArray(r.sourceIds) && r.sourceIds.length > 0 && r.sourceIds.every((s) => typeof s === "string") && Array.isArray(r.authorizedSourceIds) && r.authorizedSourceIds.length > 0 && r.authorizedSourceIds.every((s) => typeof s === "string") && r.sourceIds.every((s) => r.authorizedSourceIds.includes(s)); }
function cases(): Case[] { if (!casesJson) throw fail("SABAH_PLAN10_SUGGESTION_CASES is missing"); let v: unknown; try { v = JSON.parse(casesJson); } catch { throw fail("suggestion cases are malformed"); } if (!Array.isArray(v) || v.length !== MONITOR_KEYS.length) throw fail("suggestion cases must describe exactly all seven monitor classes and source IDs"); const result: Case[] = []; for (const entry of v) { if (!isCase(entry)) throw fail("suggestion cases must describe exactly all seven monitor classes and source IDs"); result.push(entry); } if (new Set(result.map((c) => c.monitorKey)).size !== MONITOR_KEYS.length || !MONITOR_KEYS.every((key) => result.some((c) => c.monitorKey === key))) throw fail("suggestion cases must cover every monitor class exactly once"); return result; }
function isEvidence(v: unknown): v is Evidence { if (typeof v !== "object" || v === null || Array.isArray(v)) return false; const r = Object.fromEntries(Object.entries(v)); return typeof r.sourceId === "string" && typeof r.fingerprint === "string" && r.classification === "authorized" && typeof r.freshness === "string" && Number.isFinite(Date.parse(r.freshness)) && typeof r.checksum === "string" && r.checksum.length > 0 && r.authorization === "authorized"; }
function isSuggestion(v: unknown): v is Suggestion { if (typeof v !== "object" || v === null || Array.isArray(v)) return false; const r = Object.fromEntries(Object.entries(v)); return typeof r.id === "string" && typeof r.monitorKey === "string" && typeof r.caseId === "string" && typeof r.fingerprint === "string" && typeof r.state === "string" && Array.isArray(r.evidence) && r.evidence.length > 0 && r.evidence.every(isEvidence) && Array.isArray(r.sourceIds) && r.sourceIds.every((s) => typeof s === "string") && Array.isArray(r.authorizedSourceIds) && r.authorizedSourceIds.length > 0 && r.authorizedSourceIds.every((s) => typeof s === "string") && r.sourceIds.every((s) => r.authorizedSourceIds.includes(s)) && r.evidence.every((e) => r.authorizedSourceIds.includes(e.sourceId)) && typeof r.cooldownUntil === "string"; }
async function suggestions(page: import("@playwright/test").Page, url: string): Promise<Suggestion[]> { const v = await body(await page.request.get(url), "suggestions read"); if (!Array.isArray(v) || !v.every(isSuggestion)) throw fail("suggestions response is malformed or lacks governed evidence fields"); return v; }
function exactRecords(records: Suggestion[]): Map<string, Suggestion> { return new Map(records.map((record) => [`${record.monitorKey}:${record.fingerprint}`, record])); }

 test.describe("Sabah proactive monitor contract", () => {
  test.skip(!enabled, "SABAH_PLAN10_E2E is not enabled");
  test("proves all monitor classes, governed evidence, stable lifecycle, cooldown, snooze, and dismiss", async ({ page }) => {
    if (process.env.SABAH_PLAN10_LOCAL_RUNTIME !== "1" || !storageState || !existsSync(storageState) || !secret || !suggestionUrl || !snoozeUrl || !dismissUrl || !materialChangeUrl || !cooldownUrl) throw fail("runtime, authenticated state, cron credential, suggestions, lifecycle, material-change, and cooldown URLs are required");
    const expected = cases(); const headers = { authorization: `Bearer ${secret}` };
    const run = async (): Promise<Obj> => obj(await body(await page.request.get("/api/cron/sabah-monitors", { headers }), "authenticated monitor"), "monitor result");
    await run(); const before = await suggestions(page, suggestionUrl); expect(before.length).toBeGreaterThanOrEqual(7);
    for (const c of expected) { const matches = before.filter((s) => s.monitorKey === c.monitorKey && s.caseId === c.caseId && s.fingerprint === c.fingerprint && c.sourceIds.every((id) => s.sourceIds.includes(id)) && c.authorizedSourceIds.every((id) => s.authorizedSourceIds.includes(id))); expect(matches).toHaveLength(1); const record = matches[0]; expect(record.state).toBe("OPEN"); expect(record.evidence.every((e) => e.classification === "authorized" && e.authorization === "authorized" && c.authorizedSourceIds.includes(e.sourceId) && record.authorizedSourceIds.includes(e.sourceId) && e.checksum.length > 0 && Date.parse(e.freshness) > 0)).toBe(true); }
    const firstByKey = exactRecords(before); expect(new Set(before.map((s) => s.id)).size).toBe(before.length); expect(new Set(before.map((s) => `${s.monitorKey}:${s.fingerprint}`)).size).toBe(before.length);
    const second = await run(); const unchanged = await suggestions(page, suggestionUrl); expect(second).toEqual(await run()); expect(unchanged.map((s) => ({ id: s.id, monitorKey: s.monitorKey, fingerprint: s.fingerprint, state: s.state }))).toEqual(before.map((s) => ({ id: s.id, monitorKey: s.monitorKey, fingerprint: s.fingerprint, state: s.state })));
    const snoozedId = before[0]?.id; const dismissedId = before[1]?.id; if (!snoozedId || !dismissedId) throw fail("at least two suggestions are required for lifecycle checks");
    expect(obj(await body(await page.request.post(snoozeUrl, { data: { suggestionId: snoozedId } }), "snooze"), "snooze").status).toBe("SNOOZED");
    expect(obj(await body(await page.request.post(dismissUrl, { data: { suggestionId: dismissedId } }), "dismiss"), "dismiss").status).toBe("DISMISSED");
    await run(); const persisted = await suggestions(page, suggestionUrl); expect(persisted.find((s) => s.id === snoozedId)?.state).toBe("SNOOZED"); expect(persisted.find((s) => s.id === dismissedId)?.state).toBe("DISMISSED");
    const changed = obj(await body(await page.request.post(materialChangeUrl, { data: { sourceIds: expected[0].sourceIds } }), "material source change"), "material source change"); expect(typeof changed.version).toBe("number"); await run(); const cooldownSuppressed = await suggestions(page, suggestionUrl); expect(cooldownSuppressed.filter((s) => s.monitorKey === expected[0].monitorKey && s.fingerprint !== expected[0].fingerprint && s.state === "OPEN")).toHaveLength(0);
    await body(await page.request.post(cooldownUrl, { data: { monitorKey: expected[0].monitorKey } }), "cooldown elapsed"); await run(); const reappeared = await suggestions(page, suggestionUrl); expect(reappeared.some((s) => s.monitorKey === expected[0].monitorKey && s.fingerprint !== firstByKey.get(`${expected[0].monitorKey}:${expected[0].fingerprint}`)?.fingerprint && s.state === "OPEN")).toBe(true);
  });
});
