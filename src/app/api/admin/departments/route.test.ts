import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => auth(...args) }));
vi.mock("@/lib/prisma", () => ({ prisma: { department: { findMany: (...args: unknown[]) => findMany(...args) } } }));

import { GET } from "./route";

describe("GET /api/admin/departments", () => {
    beforeEach(() => vi.clearAllMocks());

    it("requires authentication", async () => {
        auth.mockResolvedValue(null);

        const response = await GET();

        expect(response.status).toBe(401);
        expect(findMany).not.toHaveBeenCalled();
    });

    it("returns department id/name options ordered by name", async () => {
        auth.mockResolvedValue({ user: { id: "user-1", role: "MEMBER" } });
        findMany.mockResolvedValue([
            { id: "dept-2", name: "Zeta" },
            { id: "dept-1", name: "Alpha" },
        ]);

        const response = await GET();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual([
            { id: "dept-2", name: "Zeta" },
            { id: "dept-1", name: "Alpha" },
        ]);
        expect(findMany).toHaveBeenCalledWith({
            select: { id: true, name: true },
            orderBy: { name: "asc" },
        });
    });
});
