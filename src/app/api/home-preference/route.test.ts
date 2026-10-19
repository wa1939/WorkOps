import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const getHomePreference = vi.fn();
const setHomePreference = vi.fn();
const clearHomePreference = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));
vi.mock("@/lib/home-preference", () => ({
    getHomePreference: (...args: unknown[]) => getHomePreference(...args),
    setHomePreference: (...args: unknown[]) => setHomePreference(...args),
    clearHomePreference: (...args: unknown[]) => clearHomePreference(...args),
    HomePreferenceError: class HomePreferenceError extends Error {
        constructor(message: string, public status: number, public code: string) { super(message); }
    },
}));

import { DELETE, GET, PUT } from "./route";

const session = { user: { id: "actor-1", role: "MEMBER", departmentIds: [] } };
const request = (method: string, body?: unknown) => new Request("http://localhost/api/home-preference", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("/api/home-preference", () => {
    beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue(session); });

    it("rejects unauthenticated reads and writes", async () => {
        auth.mockResolvedValue(null);
        expect((await GET()).status).toBe(401);
        expect((await PUT(request("PUT", { viewId: "view-1" }))).status).toBe(401);
        expect((await DELETE()).status).toBe(401);
    });

    it("passes only the authenticated actor and view id to the guarded service", async () => {
        setHomePreference.mockResolvedValue({ viewId: "view-1" });
        const response = await PUT(request("PUT", { viewId: "view-1" }));
        expect(response.status).toBe(200);
        expect(setHomePreference).toHaveBeenCalledWith("view-1", expect.objectContaining({ id: "actor-1" }));
        expect(await response.json()).toEqual({ viewId: "view-1" });
    });

    it("supports fallback reads and reversible deletion", async () => {
        getHomePreference.mockResolvedValue(null);
        clearHomePreference.mockResolvedValue({ viewId: null });
        await expect((await GET()).json()).resolves.toEqual({ viewId: null });
        await expect((await DELETE()).json()).resolves.toEqual({ viewId: null });
        expect(clearHomePreference).toHaveBeenCalledWith(expect.objectContaining({ id: "actor-1" }));
    });

    it("returns 400 for malformed JSON instead of treating it as a server failure", async () => {
        const malformed = new Request("http://localhost/api/home-preference", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: "{viewId:",
        });

        const response = await PUT(malformed);

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid saved view id", code: "INVALID_INPUT" });
        expect(setHomePreference).not.toHaveBeenCalled();
    });
});
