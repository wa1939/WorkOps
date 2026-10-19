import { describe, expect, it } from "vitest";
import { assertCanClearParentWorkArea, normalizeWorkAreaName, workAreaInputSchema } from "./work-areas";

describe("work areas", () => {
    it("normalizes whitespace and case", () => {
        expect(normalizeWorkAreaName("  Employee   Experience ")).toBe("employee experience");
    });

    it("accepts a managed area payload", () => {
        expect(workAreaInputSchema.parse({ name: "Employee Experience", displayOrder: 10 })).toEqual({
            name: "Employee Experience",
            description: null,
            displayOrder: 10,
        });
    });

    it("rejects unclassification while external actions exist", () => {
        expect(() => assertCanClearParentWorkArea(null, 1)).toThrow("Move or remove external actions before clearing the work area");
        expect(() => assertCanClearParentWorkArea(null, 0)).not.toThrow();
        expect(() => assertCanClearParentWorkArea("area-2", 1)).not.toThrow();
    });
});
