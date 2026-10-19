import { describe, expect, it, vi } from "vitest";
import { PmoAuthenticationError, resolvePmoActor } from "./actor";

describe("resolvePmoActor", () => {
    it("uses the current database role instead of a session role", async () => {
        const findUnique = vi.fn().mockResolvedValue({ id: "user-1", role: "VIEWER", isActive: true });

        await expect(resolvePmoActor("user-1", { user: { findUnique } } as never)).resolves.toEqual({
            id: "user-1",
            role: "VIEWER",
        });
    });

    it("rejects inactive and missing users", async () => {
        for (const record of [null, { id: "user-1", role: "ADMIN", isActive: false }]) {
            const db = { user: { findUnique: vi.fn().mockResolvedValue(record) } };
            await expect(resolvePmoActor("user-1", db as never)).rejects.toBeInstanceOf(PmoAuthenticationError);
        }
    });
});
