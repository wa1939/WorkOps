import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const runMonitors = vi.fn();
vi.mock("@/lib/sabah/monitors/service", () => ({ runMonitors }));

beforeEach(() => { vi.clearAllMocks(); runMonitors.mockResolvedValue({ evaluated: 7, created: 1, suppressed: 6, errors: 0 }); });
afterEach(() => { delete process.env.SABAH_PLAN10_LOCAL_RUNTIME; delete process.env.SABAH_PLAN10_CONTROL_PORT; delete process.env.SABAH_MONITORS_ENABLED; vi.unstubAllGlobals(); });

describe("Sabah monitors cron", () => {
    it("does not export the private monitor handler from the route module", async () => {
        const route = await import("./route");
        expect(route).not.toHaveProperty("handleSabahMonitors");
    });

    it("returns 401 for missing or invalid exact bearer credentials and does not read", async () => {
        const prior = process.env.CRON_SECRET;
        delete process.env.CRON_SECRET;
        const { GET } = await import("./route");
        expect((await GET(new NextRequest("http://localhost/api/cron/sabah-monitors"))).status).toBe(401);
        process.env.CRON_SECRET = "expected-secret";
        expect((await GET(new NextRequest("http://localhost/api/cron/sabah-monitors", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
        expect(runMonitors).not.toHaveBeenCalled();
        if (prior === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prior;
    });

    it("uses a typed bounded runner and returns only safe counts for identical GET and POST", async () => {
        process.env.CRON_SECRET = "expected-secret";
        const { GET, POST } = await import("./handler");
        const headers = { authorization: "Bearer expected-secret" };
        const run = async () => ({ evaluated: 7, created: 1, suppressed: 6, errors: 0 });
        const get = await GET(new NextRequest("http://localhost/api/cron/sabah-monitors", { headers }), { secret: "expected-secret", run });
        const post = await POST(new NextRequest("http://localhost/api/cron/sabah-monitors", { method: "POST", headers }), { secret: "expected-secret", run });
        expect(get.status).toBe(200); expect(post.status).toBe(200);
        expect(await get.json()).toEqual({ ok: true, evaluated: 7, created: 1, suppressed: 6, errors: 0 });
        expect(await post.json()).toEqual({ ok: true, evaluated: 7, created: 1, suppressed: 6, errors: 0 });
        expect(runMonitors).not.toHaveBeenCalled();
        expect(JSON.stringify(await (await GET(new NextRequest("http://localhost/api/cron/sabah-monitors", { headers }), { secret: "expected-secret", run })).json())).not.toContain("expected-secret");
    });

    it("does not leak injected errors", async () => {
        process.env.CRON_SECRET = "expected-secret";
        runMonitors.mockRejectedValue(new Error("token=secret payload"));
        const { POST } = await import("./handler");
        const response = await POST(new NextRequest("http://localhost/api/cron/sabah-monitors", { method: "POST", headers: { authorization: "Bearer expected-secret" } }), { secret: "expected-secret", run: () => runMonitors() });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Monitor run failed" });
    });

    it("reports an honest skip while monitors are disabled instead of a permanent failure", async () => {
        process.env.CRON_SECRET = "expected-secret";
        const { GET } = await import("./route");
        const response = await GET(new NextRequest("http://localhost/api/cron/sabah-monitors", { headers: { authorization: "Bearer expected-secret" } }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, skipped: true, reason: "MONITORS_DISABLED" });
        expect(runMonitors).not.toHaveBeenCalled();
    });

    it("fails closed when monitors are enabled but no runtime exists", async () => {
        process.env.CRON_SECRET = "expected-secret";
        process.env.SABAH_MONITORS_ENABLED = "true";
        const { GET } = await import("./route");
        const response = await GET(new NextRequest("http://localhost/api/cron/sabah-monitors", { headers: { authorization: "Bearer expected-secret" } }));
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: "MONITOR_RUN_UNAVAILABLE" });
        expect(runMonitors).not.toHaveBeenCalled();
    });

    it("uses the fixed loopback control runtime only when explicitly enabled", async () => {
        process.env.CRON_SECRET = "expected-secret";
        process.env.SABAH_PLAN10_LOCAL_RUNTIME = "1";
        process.env.SABAH_PLAN10_CONTROL_PORT = "4010";
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ evaluated: 7, created: 7, suppressed: 0, errors: 0 }), { status: 200, headers: { "content-type": "application/json" } }));
        vi.stubGlobal("fetch", fetchMock);
        const { GET } = await import("./route");
        const response = await GET(new NextRequest("http://localhost/api/cron/sabah-monitors", { headers: { authorization: "Bearer expected-secret" } }));
        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4010/monitor/run", expect.objectContaining({ method: "POST" }));
    });

    it("rejects non-finite or oversized injected counts without serializing unsafe values", async () => {
        process.env.CRON_SECRET = "expected-secret";
        const { POST } = await import("./handler");
        const response = await POST(new NextRequest("http://localhost/api/cron/sabah-monitors", { method: "POST", headers: { authorization: "Bearer expected-secret" } }), { secret: "expected-secret", run: async () => ({ evaluated: Number.NaN, created: 1, suppressed: 0, errors: 0 }) });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Monitor run failed" });
    });

    it.each([
        { evaluated: -1, created: 0, suppressed: 1, errors: 0 },
        { evaluated: 7.5, created: 1, suppressed: 6.5, errors: 0 },
        { evaluated: 8, created: 1, suppressed: 7, errors: 0 },
        { evaluated: 7, created: 1, suppressed: 5, errors: 0 },
        { evaluated: 7, created: 1, suppressed: 6, errors: 1 },
    ])("rejects impossible injected result counts", async (result) => {
        process.env.CRON_SECRET = "expected-secret";
        const { POST } = await import("./handler");
        const response = await POST(new NextRequest("http://localhost/api/cron/sabah-monitors", { method: "POST", headers: { authorization: "Bearer expected-secret" } }), { secret: "expected-secret", run: async () => result });
        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({ error: "Monitor run failed" });
    });
});
