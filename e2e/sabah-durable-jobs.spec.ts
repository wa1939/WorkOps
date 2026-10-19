import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
const enabled = process.env.SABAH_PLAN10_E2E === "1";
const storageState = process.env.SABAH_PLAN10_STORAGE_STATE;
const primaryJobId = process.env.SABAH_PLAN10_PRIMARY_JOB_ID;
const cancelJobId = process.env.SABAH_PLAN10_CANCEL_JOB_ID;
const localRuntime = process.env.SABAH_PLAN10_LOCAL_RUNTIME === "1";
const controls = process.env.SABAH_PLAN10_DURABLE_CONTROL_URLS;
const activityUrl = process.env.SABAH_PLAN10_ACTIVITY_URL;
const correlationId = process.env.SABAH_PLAN10_CORRELATION_ID;
if (storageState && existsSync(storageState)) test.use({ storageState });
type JsonRecord = Record<string, unknown>;
type Attempt = { id: string; attemptNumber: number; status: string; workflowKey: string; stepKey: string; entityKey: string; correlationId: string; checkpointed: boolean };
type JobProjection = { id: string; workflowId: string; stepId: string; status: string; leaseOwner: string | null; leaseUntil: string | null; checkpoint: JsonRecord | null; attempts: Attempt[] };
const provisioningError = (detail: string): Error => new Error(`Plan10 E2E provisioning error: ${detail}`);
function record(value: unknown, label: string): JsonRecord { if (typeof value !== "object" || value === null || Array.isArray(value)) throw provisioningError(`${label} response is not an object`); return Object.fromEntries(Object.entries(value)); }
function controlUrls(): Record<"checkpoint" | "leaseExpire" | "leaseRenew" | "tick" | "cancel", string> {
  if (!controls) throw provisioningError("SABAH_PLAN10_DURABLE_CONTROL_URLS is missing");
  let parsed: unknown; try { parsed = JSON.parse(controls); } catch { throw provisioningError("SABAH_PLAN10_DURABLE_CONTROL_URLS is malformed"); }
  const value = record(parsed, "durable controls"); const result: Record<"checkpoint" | "leaseExpire" | "leaseRenew" | "tick" | "cancel", string> = { checkpoint: "", leaseExpire: "", leaseRenew: "", tick: "", cancel: "" };
  for (const key of ["checkpoint", "leaseExpire", "leaseRenew", "tick", "cancel"] as const) { if (typeof value[key] !== "string" || !value[key]) throw provisioningError(`durable control ${key} is missing`); try { const url = new URL(value[key], "http://plan10.invalid"); if (!value[key].startsWith("/") && url.protocol !== "https:") throw new Error(); result[key] = value[key]; } catch { throw provisioningError(`durable control ${key} is malformed`); } }
  return result;
}
function isProjection(value: unknown): value is JobProjection { const r = record(value, "job"); return typeof r.id === "string" && typeof r.workflowId === "string" && typeof r.stepId === "string" && typeof r.status === "string" && (typeof r.leaseOwner === "string" || r.leaseOwner === null) && (typeof r.leaseUntil === "string" || r.leaseUntil === null) && (r.checkpoint === null || typeof r.checkpoint === "object") && Array.isArray(r.attempts) && r.attempts.every((a) => { if (typeof a !== "object" || a === null || Array.isArray(a)) return false; const x = Object.fromEntries(Object.entries(a)); return typeof x.id === "string" && Number.isInteger(x.attemptNumber) && typeof x.status === "string" && typeof x.workflowKey === "string" && typeof x.stepKey === "string" && typeof x.entityKey === "string" && typeof x.correlationId === "string" && typeof x.checkpointed === "boolean"; }); }
async function json(response: import("@playwright/test").APIResponse, label: string): Promise<unknown> { if (!response.ok()) throw provisioningError(`${label} returned HTTP ${response.status()}`); try { return JSON.parse(await response.text()); } catch { throw provisioningError(`${label} returned malformed JSON`); } }
async function readJob(page: Page, id: string): Promise<JobProjection> { const body = await json(await page.request.get(`/api/ai/jobs/${encodeURIComponent(id)}`), "job read"); if (!isProjection(body)) throw provisioningError("job projection is malformed or lacks durable identity fields"); return body; }

test.describe("Sabah durable interruption contract", () => {
  test.skip(!enabled, "SABAH_PLAN10_E2E is not enabled");
  test("proves checkpoint interruption, lease recovery, resume, correlation, uniqueness, and cancellation", async ({ page }) => {
    if (!localRuntime || !storageState || !existsSync(storageState) || !primaryJobId || !cancelJobId || !activityUrl || !correlationId) throw provisioningError("runtime, storage state, job IDs, activity URL, and correlation ID are required");
    const urls = controlUrls(); await page.goto("/sabah");
    const before = await readJob(page, primaryJobId); const beforeAttempts = before.attempts.length;
    const checkpoint = record(await json(await page.request.post(urls.checkpoint, { data: { jobId: primaryJobId } }), "checkpoint creation"), "checkpoint");
    expect(checkpoint.jobId).toBe(primaryJobId); expect(["INTERRUPTED", "CHECKPOINTED"]).toContain(checkpoint.status); expect(typeof checkpoint.checkpointId).toBe("string");
    const checkpointRead = record(await json(await page.request.get(urls.checkpoint), "checkpoint read-back"), "checkpoint read-back"); expect(checkpointRead.jobId).toBe(primaryJobId); expect(typeof checkpointRead.recoveryToken).toBe("string"); expect(checkpointRead.status).toBe("CHECKPOINTED");
    await page.reload(); const interrupted = await readJob(page, primaryJobId); expect(["INTERRUPTED", "CHECKPOINTED"]).toContain(interrupted.status); expect(interrupted.checkpoint).not.toBeNull();
    const expired = record(await json(await page.request.post(urls.leaseExpire, { data: { jobId: primaryJobId } }), "lease expiry"), "lease expiry"); expect(expired.jobId).toBe(primaryJobId); expect(expired.leaseOwner).toBeNull(); expect(expired.leaseUntil).toBeNull();
    const renewed = record(await json(await page.request.post(urls.leaseRenew, { data: { jobId: primaryJobId } }), "lease renewal"), "lease renewal"); expect(renewed.jobId).toBe(primaryJobId); expect(typeof renewed.leaseOwner).toBe("string"); expect(typeof renewed.leaseUntil).toBe("string");
    const tick = record(await json(await page.request.post(urls.tick, { data: { jobId: primaryJobId } }), "resume tick"), "resume tick"); expect(tick.jobId).toBe(primaryJobId); expect(["RUNNING", "SUCCEEDED", "RETRY_WAIT"]).toContain(tick.status); expect(tick.resumedFromCheckpoint).toBe(true);
    const after = await readJob(page, primaryJobId); expect(after.workflowId).toBe(before.workflowId); expect(after.stepId).toBe(before.stepId); expect(after.attempts.length).toBeGreaterThan(beforeAttempts); expect(after.attempts.some((attempt) => attempt.checkpointed)).toBe(true);
    const attemptIds = after.attempts.map((attempt) => attempt.id); expect(new Set(attemptIds).size).toBe(attemptIds.length); const attemptNumbers = after.attempts.map((attempt) => attempt.attemptNumber); expect(new Set(attemptNumbers).size).toBe(attemptNumbers.length); const keys = after.attempts.map((attempt) => `${attempt.workflowKey}:${attempt.stepKey}:${attempt.entityKey}`); expect(new Set(keys).size).toBe(keys.length); expect(after.attempts.every((attempt) => attempt.correlationId.length > 0)).toBe(true);
    const canceled = record(await json(await page.request.post(urls.cancel, { data: { jobId: cancelJobId } }), "cancellation"), "cancellation"); expect(canceled.jobId).toBe(cancelJobId); expect(["CANCELED", "CANCEL_REQUESTED"]).toContain(canceled.status);
    const canceledRead = await readJob(page, cancelJobId); expect(["CANCELED", "CANCEL_REQUESTED"]).toContain(canceledRead.status); expect(["CANCELED", "CANCEL_REQUESTED"]).toContain(canceledRead.attempts.at(-1)?.status);
    const activityValue = await json(await page.request.get(activityUrl), "activity log"); if (!Array.isArray(activityValue)) throw provisioningError("activity log must be an array of correlated records"); const activity = activityValue.map((item) => record(item, "activity record")); expect(activity.some((item) => item.jobId === primaryJobId && item.correlationId === correlationId && /recovery|checkpoint/i.test(String(item.event ?? item.type ?? "")))).toBe(true);
  });
});
