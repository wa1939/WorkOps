import { describe, expect, it } from "vitest";
import { parseTaskGridSearchParams } from "./grid-search-params";

describe("parseTaskGridSearchParams", () => {
    it.each([
        "projectIds=,",
        "projectIds=project-1,",
        "projectIds=,project-1",
        "projectIds=project-1&projectIds=",
    ])("rejects blank projectIds elements (%s)", (query) => {
        expect(() => parseTaskGridSearchParams(new URLSearchParams(query))).toThrow();
    });

    it("preserves valid repeated and comma-separated project IDs", () => {
        expect(parseTaskGridSearchParams(new URLSearchParams(
            "projectIds=project-1,project-2&projectIds=project-3",
        )).filters.projectIds).toEqual(["project-1", "project-2", "project-3"]);
    });
});
