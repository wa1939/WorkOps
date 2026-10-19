import { describe, expect, it, vi } from "vitest";
import { SabahForbiddenError, toSabahActor } from "./actor";

describe("toSabahActor", () => {
    it("returns the active actor with deduplicated department ids", async () => {
        const findUnique = vi.fn().mockResolvedValue({
            id: "user-1",
            role: "LEAD",
            isActive: true,
            departments: [
                { departmentId: "dept-1" },
                { departmentId: "dept-1" },
                { departmentId: "dept-2" },
            ],
        });

        await expect(toSabahActor(
            { id: "user-1", role: "LEAD" },
            { user: { findUnique } } as never,
        )).resolves.toEqual({
            id: "user-1",
            role: "LEAD",
            departmentIds: ["dept-1", "dept-2"],
        });
        expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "user-1" } }));
    });

    it("maps the persisted MANAGER role to the Sabah LEAD role", async () => {
        const findUnique = vi.fn().mockResolvedValue({
            id: "user-1",
            role: "MANAGER",
            isActive: true,
            departments: [{ departmentId: "dept-1" }],
        });

        await expect(toSabahActor(
            { id: "user-1", role: "MANAGER" },
            { user: { findUnique } } as never,
        )).resolves.toEqual({
            id: "user-1",
            role: "LEAD",
            departmentIds: ["dept-1"],
        });
    });

    it("uses the database role, not the stale session role", async () => {
        const findUnique = vi.fn().mockResolvedValue({
            id: "user-1",
            role: "MEMBER",
            isActive: true,
            departments: [],
        });

        await expect(toSabahActor(
            { id: "user-1", role: "ADMIN" },
            { user: { findUnique } } as never,
        )).resolves.toMatchObject({ role: "MEMBER" });
    });

    it.each([
        null,
        { id: "user-1", role: "LEAD", isActive: false, departments: [] },
    ])("rejects missing or inactive users", async (record) => {
        const findUnique = vi.fn().mockResolvedValue(record);

        await expect(toSabahActor(
            { id: "user-1", role: "LEAD" },
            { user: { findUnique } } as never,
        )).rejects.toBeInstanceOf(SabahForbiddenError);
    });

    it("rejects a session without an id before querying", async () => {
        const findUnique = vi.fn();

        await expect(toSabahActor(
            { id: null, role: "ADMIN" },
            { user: { findUnique } } as never,
        )).rejects.toBeInstanceOf(SabahForbiddenError);
        expect(findUnique).not.toHaveBeenCalled();
    });

    it("rejects an unrecognized persisted role", async () => {
        const findUnique = vi.fn().mockResolvedValue({
            id: "user-1",
            role: "OWNER",
            isActive: true,
            departments: [],
        });

        await expect(toSabahActor(
            { id: "user-1", role: "OWNER" },
            { user: { findUnique } } as never,
        )).rejects.toBeInstanceOf(SabahForbiddenError);
    });
});

describe("SabahForbiddenError", () => {
    it("exposes only a safe status and code", () => {
        const error = new SabahForbiddenError();

        expect(error).toMatchObject({
            name: "SabahForbiddenError",
            status: 403,
            code: "SABAH_FORBIDDEN",
            message: "Forbidden",
        });
        expect("record" in error).toBe(false);
    });
});
