import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<typeof fetch>();
const authMock = vi.hoisted(() => vi.fn());
const actorMock = vi.hoisted(() => vi.fn());
vi.stubGlobal("fetch", fetchMock);

vi.mock("@/lib/auth", () => ({ auth: authMock }));
vi.mock("@/lib/sabah/auth/actor", () => ({
    toSabahActor: actorMock,
    SabahForbiddenError: class SabahForbiddenError extends Error {},
}));
import { GET } from "./route";

describe("local Plan10 control proxy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authMock.mockResolvedValue({ user: { id: "admin-1", role: "ADMIN" } });
        // Persisted-role authorization mirrors the session in these tests
        // unless a test overrides it to simulate demotion.
        actorMock.mockImplementation(async (user: { id: string; role: string }) => ({ id: user.id, role: user.role === "MANAGER" ? "LEAD" : user.role, departmentIds: [] }));
        process.env.SABAH_PLAN10_LOCAL_RUNTIME = "1";
        process.env.SABAH_PLAN10_CONTROL_PORT = "4010";
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ evaluated: 7, created: 7, suppressed: 0, errors: 0 }), { status: 200, headers: { "content-type": "application/json" } }));
    });

    it("forwards only an allowlisted path to the fixed loopback service", async () => {
        const response = await GET(new Request("http://localhost/api/sabah/plan10/monitor/run"), { params: Promise.resolve({ path: ["monitor", "run"] }) });
        expect(response.status).toBe(200);
        expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4010/monitor/run", expect.objectContaining({ method: "GET" }));
    });

    it("fails closed when local runtime is not explicitly enabled", async () => {
        delete process.env.SABAH_PLAN10_LOCAL_RUNTIME;
        const response = await GET(new Request("http://localhost/api/sabah/plan10/monitor/run"), { params: Promise.resolve({ path: ["monitor", "run"] }) });
        expect(response.status).toBe(503);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated callers before forwarding", async () => {
        authMock.mockResolvedValue(null);
        const response = await GET(new Request("http://localhost/api/sabah/plan10/monitor/run"), { params: Promise.resolve({ path: ["monitor", "run"] }) });
        expect(response.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects non-admin callers before forwarding", async () => {
        authMock.mockResolvedValue({ user: { id: "member-1", role: "MEMBER" } });
        const response = await GET(new Request("http://localhost/api/sabah/plan10/monitor/run"), { params: Promise.resolve({ path: ["monitor", "run"] }) });
        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a stale admin JWT when the persisted role was demoted", async () => {
        authMock.mockResolvedValue({ user: { id: "demoted", role: "ADMIN" } });
        actorMock.mockResolvedValue({ id: "demoted", role: "MEMBER", departmentIds: [] });
        const response = await GET(new Request("http://localhost/api/sabah/plan10/monitor/run"), { params: Promise.resolve({ path: ["monitor", "run"] }) });
        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
