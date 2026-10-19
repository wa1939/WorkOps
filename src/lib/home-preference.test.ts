import { describe, expect, it, vi } from "vitest";
import { clearHomePreference, getHomePath, getHomePreference, setHomePreference } from "./home-preference";

const actor = (id: string) => ({ id, role: "MEMBER" as const, departmentIds: [] });

function dbFor(configValue: string | null, views: Array<{ id: string; scope?: string | null; ownerId?: string | null }>) {
    return {
        appConfig: {
            findUnique: vi.fn(async ({ where }: { where: { key: string } }) => configValue === null ? null : { key: where.key, value: configValue }),
            upsert: vi.fn(async ({ create }: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }) => create),
            deleteMany: vi.fn(async () => ({ count: 1 })),
        },
        savedView: {
            findUnique: vi.fn(async ({ where }: { where: { id: string } }) => views.find((view) => view.id === where.id) ?? null),
        },
    };
}

describe("actor-owned custom view home preference", () => {
    it("isolates actor keys and accepts only an accessible saved view", async () => {
        const db = dbFor(null, [{ id: "view-1", scope: "PERSONAL", ownerId: "actor-1" }]);

        await expect(setHomePreference("view-1", actor("actor-1"), db)).resolves.toEqual({ viewId: "view-1" });
        expect(db.appConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: "custom-view-home:actor-1" },
            create: { key: "custom-view-home:actor-1", value: "view-1" },
        }));
        await expect(setHomePreference("view-1", actor("actor-2"), db)).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(db.appConfig.upsert).toHaveBeenCalledOnce();
    });

    it("ignores stale or inaccessible selections and falls back to the dashboard", async () => {
        const stale = dbFor("deleted-view", []);
        await expect(getHomePreference(actor("actor-1"), stale)).resolves.toBeNull();
        await expect(getHomePath(actor("actor-1"), stale)).resolves.toBe("/dashboard");
        expect(stale.appConfig.deleteMany).toHaveBeenCalledWith({ where: { key: "custom-view-home:actor-1", value: "deleted-view" } });

        const inaccessible = dbFor("private-view", [{ id: "private-view", scope: "PERSONAL", ownerId: "other" }]);
        await expect(getHomePreference(actor("actor-1"), inaccessible)).resolves.toBeNull();
        await expect(getHomePath(actor("actor-1"), inaccessible)).resolves.toBe("/dashboard");
    });

    it("clears the preference reversibly", async () => {
        const db = dbFor("view-1", []);
        await expect(clearHomePreference(actor("actor-1"), db)).resolves.toEqual({ viewId: null });
        expect(db.appConfig.deleteMany).toHaveBeenCalledWith({ where: { key: "custom-view-home:actor-1" } });
    });

    it("does not delete a newer preference when stale GET cleanup interleaves with a PUT", async () => {
        let currentValue: string | null = "deleted-view";
        const db = {
            appConfig: {
                findUnique: vi.fn(async () => ({ value: "deleted-view" })),
                upsert: vi.fn(async ({ update }: { update: { value: string } }) => {
                    currentValue = update.value;
                }),
                deleteMany: vi.fn(async ({ where }: { where: { key: string; value?: string } }) => {
                    if (!where.value || where.value === currentValue) currentValue = null;
                    return { count: 1 };
                }),
            },
            savedView: {
                findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
                    if (where.id === "deleted-view") {
                        await setHomePreference("new-view", actor("actor-1"), db);
                        return null;
                    }
                    if (where.id === "new-view") return { id: "new-view", scope: "PERSONAL", ownerId: "actor-1" };
                    return null;
                }),
            },
        };

        await expect(getHomePreference(actor("actor-1"), db)).resolves.toBeNull();
        expect(currentValue).toBe("new-view");
        expect(db.appConfig.deleteMany).toHaveBeenCalledWith({ where: { key: "custom-view-home:actor-1", value: "deleted-view" } });
    });
});
