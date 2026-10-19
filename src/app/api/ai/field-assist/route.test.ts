import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const toSabahActor = vi.fn();
const getSabahFlags = vi.fn();
const callGLM = vi.fn();
const checkRateLimit = vi.fn();
const resolveRuntimeProviderCredentials = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/sabah/auth/actor", () => {
    class SabahForbiddenError extends Error {
        public readonly status = 403;
        public readonly code = "SABAH_FORBIDDEN";
    }
    return {
        toSabahActor: (...args: unknown[]) => toSabahActor(...args),
        SabahForbiddenError,
    };
});
vi.mock("@/lib/sabah/flags", () => ({ getSabahFlags: () => getSabahFlags() }));
vi.mock("@/lib/glm", () => ({ callGLM: (...args: unknown[]) => callGLM(...args) }));
vi.mock("@/lib/ai/rate-limit", () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimit(...args) }));
vi.mock("@/lib/sabah/providers/admin-service", () => ({ resolveRuntimeProviderCredentials: (...args: unknown[]) => resolveRuntimeProviderCredentials(...args) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { POST } from "./route";

function makeRequest(body: unknown): Request {
    return new Request("http://localhost/api/ai/field-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
}

const validBody = {
    entityType: "task",
    fieldName: "description",
    fieldLabel: "Description",
    currentValue: "",
    context: { title: "Prepare BSC review deck" },
};

beforeEach(() => {
    vi.clearAllMocks();
    process.env.GLM_API_KEY = "test-key";
    auth.mockResolvedValue({ user: { id: "u1", role: "ADMIN" } });
    getSabahFlags.mockReturnValue({ platform: true, writes: false, memory: false, multimodal: false, monitors: false });
    toSabahActor.mockResolvedValue({ id: "u1", role: "ADMIN", departmentIds: [] });
    checkRateLimit.mockReturnValue({ allowed: true, remaining: 10, resetAt: Date.now() + 60_000 });
    resolveRuntimeProviderCredentials.mockResolvedValue({});
});

describe("POST /api/ai/field-assist", () => {
    it("returns 401 when unauthenticated", async () => {
        auth.mockResolvedValue(null);
        const response = await POST(makeRequest(validBody));
        expect(response.status).toBe(401);
    });

    it("returns 404 when the Sabah platform flag is off", async () => {
        getSabahFlags.mockReturnValue({ platform: false, writes: false, memory: false, multimodal: false, monitors: false });
        const response = await POST(makeRequest(validBody));
        expect(response.status).toBe(404);
        expect(callGLM).not.toHaveBeenCalled();
    });

    it("returns 403 when the actor is forbidden", async () => {
        toSabahActor.mockRejectedValue(new SabahForbiddenError());
        const response = await POST(makeRequest(validBody));
        expect(response.status).toBe(403);
        expect(callGLM).not.toHaveBeenCalled();
    });

    it("returns 400 on invalid input", async () => {
        const response = await POST(makeRequest({ ...validBody, fieldName: "" }));
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBeTruthy();
        expect(callGLM).not.toHaveBeenCalled();
    });

    it("returns 400 when the context has too many keys", async () => {
        const context = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`field${i}`, "v"]));
        const response = await POST(makeRequest({ ...validBody, context }));
        expect(response.status).toBe(400);
    });

    it("returns 429 when rate limited", async () => {
        checkRateLimit.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });
        const response = await POST(makeRequest(validBody));
        expect(response.status).toBe(429);
    });

    it("returns the proposed draft and echoes the base on the happy path", async () => {
        callGLM.mockResolvedValue({ content: "```\nDraft the BSC review deck outline\n```", tool_calls: [], finish_reason: "stop" });
        const response = await POST(makeRequest({ ...validBody, currentValue: "old text" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ proposed: "Draft the BSC review deck outline", base: "old text" });
        const call = callGLM.mock.calls[0][0] as { messages: { role: string; content: string }[]; max_tokens: number };
        expect(call.max_tokens).toBeLessThanOrEqual(400);
        expect(call.messages[0].content).toContain("Sabah");
        expect(call.messages[1].content).toContain("Description");
        expect(call.messages[1].content).toContain("Prepare BSC review deck");
    });

    it("uses an enabled stored credential when the environment key is absent", async () => {
        delete process.env.GLM_API_KEY;
        const credentials = { zai: "synthetic-runtime-value" };
        resolveRuntimeProviderCredentials.mockResolvedValueOnce(credentials);
        callGLM.mockResolvedValue({ content: "Stored credential draft", tool_calls: [], finish_reason: "stop" });

        const response = await POST(makeRequest(validBody));

        expect(response.status).toBe(200);
        expect(callGLM).toHaveBeenCalledWith(expect.objectContaining({ credentials }));
    });

    it("returns 502 when generation fails", async () => {
        callGLM.mockRejectedValue(new Error("GLM API error 500"));
        const response = await POST(makeRequest(validBody));
        expect(response.status).toBe(502);
        expect((await response.json()).error).toBe("Sabah could not draft this field");
    });

    it("returns 502 when the model returns an empty draft", async () => {
        callGLM.mockResolvedValue({ content: "   ", tool_calls: [], finish_reason: "stop" });
        const response = await POST(makeRequest(validBody));
        expect(response.status).toBe(502);
    });
});
