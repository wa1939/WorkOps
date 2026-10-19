import { describe, expect, it } from "vitest";
import { buildWorkAreaUpdate } from "./parent-work-area-picker";

describe("ParentWorkAreaPicker update payload", () => {
    it("includes the authoritative expectedUpdatedAt version for project and case-study PATCH requests", () => {
        expect(buildWorkAreaUpdate("area-1", "2026-08-31T12:00:00.000Z")).toEqual({
            workAreaId: "area-1",
            expectedUpdatedAt: "2026-08-31T12:00:00.000Z",
        });
        expect(buildWorkAreaUpdate("unclassified", "2026-08-31T12:00:00.000Z")).toEqual({
            workAreaId: null,
            expectedUpdatedAt: "2026-08-31T12:00:00.000Z",
        });
    });
});
