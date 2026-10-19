import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, toSabahActor, getSabahFlags, checkRateLimit, parseIntakeBuffer, create, count, deleteMany, transaction } = vi.hoisted(() => ({
    auth: vi.fn(),
    toSabahActor: vi.fn(),
    getSabahFlags: vi.fn(),
    checkRateLimit: vi.fn(),
    parseIntakeBuffer: vi.fn(),
    create: vi.fn(),
    count: vi.fn(),
    deleteMany: vi.fn(),
    transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/sabah/auth/actor", () => {
    class SabahForbiddenError extends Error {}
    return { toSabahActor: (...args: unknown[]) => toSabahActor(...args), SabahForbiddenError };
});
vi.mock("@/lib/sabah/flags", () => ({ getSabahFlags: () => getSabahFlags() }));
vi.mock("@/lib/ai/rate-limit", () => ({ checkRateLimit: (...args: unknown[]) => checkRateLimit(...args) }));
vi.mock("@/lib/ai/intake-parse", () => ({
    INTAKE_MAX_BYTES: 2 * 1024 * 1024,
    INTAKE_EXTENSIONS: [".csv"],
    parseIntakeBuffer: (...args: unknown[]) => parseIntakeBuffer(...args),
}));
vi.mock("@/lib/prisma", () => ({
    prisma: {
        aiIntake: { create, count, deleteMany },
        $transaction: (...args: unknown[]) => transaction(...args),
    },
}));

import { POST } from "./route";

function request() {
    const form = new FormData();
    form.append("file", new File(["title\nA"], "tasks.csv", { type: "text/csv" }));
    return new Request("http://localhost/api/ai/intake", { method: "POST", body: form });
}

describe("POST /api/ai/intake", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        auth.mockResolvedValue({ user: { id: "user-1" } });
        toSabahActor.mockResolvedValue({ id: "user-1", role: "MEMBER", departmentIds: [] });
        getSabahFlags.mockReturnValue({ platform: true });
        checkRateLimit.mockReturnValue({ allowed: true });
        parseIntakeBuffer.mockResolvedValue({ kind: "rows", headers: ["title"], rows: [{ title: "A" }], rowCount: 1, truncated: false });
        create.mockResolvedValue({ id: "intake-1" });
        count.mockResolvedValue(0);
        deleteMany.mockResolvedValue({ count: 0 });
        transaction.mockImplementation(async (callback: (db: unknown) => unknown) => callback({ aiIntake: { create, count, deleteMany } }));
    });

    it("rejects an inactive or revoked persisted actor", async () => {
        const { SabahForbiddenError } = await import("@/lib/sabah/auth/actor");
        toSabahActor.mockRejectedValueOnce(new SabahForbiddenError());
        const response = await POST(request());
        expect(response.status).toBe(403);
        expect(parseIntakeBuffer).not.toHaveBeenCalled();
    });

    it("hides intake when the Sabah platform is disabled", async () => {
        getSabahFlags.mockReturnValueOnce({ platform: false });
        const response = await POST(request());
        expect(response.status).toBe(404);
        expect(parseIntakeBuffer).not.toHaveBeenCalled();
    });

    it("rate-limits uploads before parsing", async () => {
        checkRateLimit.mockReturnValueOnce({ allowed: false, resetAt: 123 });
        const response = await POST(request());
        expect(response.status).toBe(429);
        expect(parseIntakeBuffer).not.toHaveBeenCalled();
    });

    it("prunes expired intake and enforces a bounded per-user quota transactionally", async () => {
        count.mockResolvedValueOnce(20);
        const response = await POST(request());
        expect(response.status).toBe(429);
        expect(deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1" }) }));
        expect(create).not.toHaveBeenCalled();
    });
});
