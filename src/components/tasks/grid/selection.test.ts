import { describe, expect, it } from "vitest";
import { computeSelectionRange } from "./selection";

describe("computeSelectionRange", () => {
    const ids = ["task-a", "task-b", "task-c", "task-d"];

    it("returns the inclusive range from the anchor to the target", () => {
        expect(computeSelectionRange(ids, "task-a", "task-c")).toEqual([
            "task-a",
            "task-b",
            "task-c",
        ]);
    });

    it("works when the target is before the anchor", () => {
        expect(computeSelectionRange(ids, "task-d", "task-b")).toEqual([
            "task-b",
            "task-c",
            "task-d",
        ]);
    });

    it("selects only the target when the anchor is no longer visible", () => {
        expect(computeSelectionRange(ids, "missing", "task-c")).toEqual(["task-c"]);
    });

    it("returns no ids for an unknown target", () => {
        expect(computeSelectionRange(ids, "task-a", "missing")).toEqual([]);
    });
});
