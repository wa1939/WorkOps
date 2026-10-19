import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
    usePathname: () => "/",
}));

import { isNavItemActive } from "./sidebar";

describe("sidebar navigation matching", () => {
    it("matches Home only at the root and uses segment boundaries for siblings", () => {
        expect(isNavItemActive("/", "/")).toBe(true);
        expect(isNavItemActive("/tasks", "/")).toBe(false);
        expect(isNavItemActive("/views/view-1", "/")).toBe(false);
        expect(isNavItemActive("/tasks/view-1", "/tasks")).toBe(true);
        expect(isNavItemActive("/tasks-archive", "/tasks")).toBe(false);
    });
});
