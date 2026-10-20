import { describe, expect, it } from "vitest";
import { buildBaseParams } from "./useTaskGrid";

describe("shared task filter transport", () => {
    it("removes the singular person alias when the workspace supplies people", () => {
        const params = buildBaseParams("assigneeId=old-person", "status", { scope: "assigned", assigneeIds: [] });
        expect(params.has("assigneeId")).toBe(false);
        expect(params.has("assigneeIds")).toBe(false);
    });

    it("uses the selected personal scope and person on every page", () => {
        const params = buildBaseParams("scope=all&cursor=stale&sortBy=dueDate&dir=asc", "status", { scope: "assigned", assigneeIds: ["person-two"] });
        expect(params.get("scope")).toBe("assigned");
        expect(params.getAll("assigneeIds")).toEqual(["person-two"]);
        expect(params.has("cursor")).toBe(false);
        expect(params.get("sortBy")).toBe("dueDate");
        expect(params.get("dir")).toBe("asc");
    });
});
