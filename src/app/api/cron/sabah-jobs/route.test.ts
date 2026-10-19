import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requeueExpiredLeases = vi.fn();
const processJobTick = vi.fn();
const createPrismaJobDb = vi.fn(() => ({ database: "fake" }));
vi.mock("@/lib/sabah/jobs/queue", () => ({ requeueExpiredLeases, createPrismaJobDb }));
vi.mock("@/lib/sabah/jobs/worker", () => ({ processJobTick }));

beforeEach(() => {
    vi.clearAllMocks();
    requeueExpiredLeases.mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]);
    processJobTick.mockResolvedValue({ leased: 1, completed: 1, failed: 0, canceled: 0, skipped: 0 });
    process.env.SABAH_PLATFORM_ENABLED = "true";
});

afterEach(() => { delete process.env.SABAH_PLATFORM_ENABLED; });

describe("Sabah durable jobs cron", () => {
    it("reports an honest skip while the Sabah platform is disabled", async () => {
        process.env.CRON_SECRET = "expected-secret";
        delete process.env.SABAH_PLATFORM_ENABLED;
        const { POST } = await import("./route");
        const response = await POST(new NextRequest("http://localhost/api/cron/sabah-jobs", { method: "POST", headers: { authorization: "Bearer expected-secret" } }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, skipped: true, reason: "PLATFORM_DISABLED" });
        expect(requeueExpiredLeases).not.toHaveBeenCalled();
        expect(processJobTick).not.toHaveBeenCalled();
    });

    it("fails closed when CRON_SECRET is missing or bearer is wrong", async () => {
        const prior = process.env.CRON_SECRET;
        delete process.env.CRON_SECRET;
        const { POST } = await import("./route");
        expect((await POST(new NextRequest("http://localhost/api/cron/sabah-jobs", { method: "POST", headers: { authorization: "Bearer undefined" } }))).status).toBe(401);
        process.env.CRON_SECRET = "expected-secret";
        expect((await POST(new NextRequest("http://localhost/api/cron/sabah-jobs", { method: "POST", headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
        if (prior === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prior;
    });

    it("requeues leases and runs a bounded internal batch with safe counts only", async () => {
        process.env.CRON_SECRET = "expected-secret";
        const { POST } = await import("./route");
        const response = await POST(new NextRequest("http://localhost/api/cron/sabah-jobs", { method: "POST", headers: { authorization: "Bearer expected-secret" } }));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(requeueExpiredLeases).toHaveBeenCalledWith(expect.anything());
        expect(processJobTick).toHaveBeenCalledWith(expect.objectContaining({ db: expect.anything(), workerId: expect.any(String), limit: expect.any(Number), budgetMs: 45_000 }));
        expect(body).toEqual({ ok: true, requeued: 2, leased: 1, completed: 1, failed: 0, canceled: 0, skipped: 0 });
        expect(JSON.stringify(body)).not.toContain("expected-secret");
    });

    it("runs the same safe recovery flow for an authenticated scheduled GET", async () => {
        process.env.CRON_SECRET = "expected-secret";
        const { GET } = await import("./route");
        const response = await GET(new NextRequest("http://localhost/api/cron/sabah-jobs", { method: "GET", headers: { authorization: "Bearer expected-secret" } }));
        const body = await response.json();
        expect(response.status).toBe(200);
        expect(requeueExpiredLeases).toHaveBeenCalledWith(expect.anything());
        expect(processJobTick).toHaveBeenCalledWith(expect.objectContaining({ db: expect.anything(), workerId: expect.any(String), limit: 10, budgetMs: 45_000 }));
        expect(body).toEqual({ ok: true, requeued: 2, leased: 1, completed: 1, failed: 0, canceled: 0, skipped: 0 });
        expect(JSON.stringify(body)).not.toContain("expected-secret");
    });

    it("does not expose internal errors or raw job data", async () => {
        process.env.CRON_SECRET = "expected-secret";
        processJobTick.mockRejectedValue(new Error("token=super-secret payloadJson=credential"));
        const { POST } = await import("./route");
        const response = await POST(new NextRequest("http://localhost/api/cron/sabah-jobs", { method: "POST", headers: { authorization: "Bearer expected-secret" } }));
        const body = await response.json();
        expect(response.status).toBe(500);
        expect(body).toEqual({ error: "Job recovery failed" });
        expect(JSON.stringify(body)).not.toContain("super-secret");
    });
});
