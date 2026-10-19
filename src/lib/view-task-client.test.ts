import { describe, expect, it } from "vitest";
import type { Block } from "@/components/view-blocks/block-editor";
import {
    applyViewQuickFilters,
    serializeViewTaskQuery,
} from "./view-task-client";

const baseBlock = (overrides: Partial<Block> = {}): Block => ({
    id: "view-task",
    type: "taskView",
    viewType: "table",
    assigneeIds: ["@me"],
    projectIds: ["project-1", "project-2"],
    tagIds: ["tag-1"],
    dueRange: "today",
    sortBy: "dueAt",
    sortDir: "asc",
    groupBy: "assignee",
    filters: {
        status: "TODO,DONE",
        priority: "HIGH",
        search: "release",
        includeArchived: "false",
        legacyFilter: "keep-in-persisted-json",
    },
    ...overrides,
});

describe("view task client serialization", () => {
    it("serializes deep fields and legacy filters without resolving @me in the browser", () => {
        const params = serializeViewTaskQuery(baseBlock(), 12);

        expect(params.getAll("assigneeIds")).toEqual(["@me"]);
        expect(params.getAll("projectIds")).toEqual(["project-1", "project-2"]);
        expect(params.getAll("tagIds")).toEqual(["tag-1"]);
        expect(params.getAll("status")).toEqual(["TODO", "DONE"]);
        expect(params.get("priority")).toBe("HIGH");
        expect(params.get("search")).toBe("release");
        expect(params.get("includeArchived")).toBe("false");
        expect(params.get("dueRange")).toBe("today");
        expect(params.get("sortBy")).toBe("dueAt");
        expect(params.get("sortDir")).toBe("asc");
        expect(params.get("groupBy")).toBe("assignee");
        expect(params.get("offset")).toBe("12");
        expect(params.toString()).not.toContain("legacyFilter");
    });

    it("intersects quick filters with persisted restrictions instead of broadening them", () => {
        const result = applyViewQuickFilters(
            baseBlock({ assigneeIds: ["@me", "user-1"], filters: { priority: "URGENT" } }),
            new Set(["me", "high-priority"]),
            new Date("2026-10-07T22:30:00.000Z"),
        );

        expect(result.conflict).toBeNull();
        expect(result.block.assigneeIds).toEqual(["@me"]);
        expect(result.block.filters?.priority).toEqual(["URGENT"]);
    });

    it("reports a no-match conflict when a chip cannot intersect a persisted filter", () => {
        const result = applyViewQuickFilters(
            baseBlock({ assigneeIds: ["user-2"], filters: { dueRange: "today" } }),
            new Set(["me", "overdue"]),
            new Date("2026-10-07T22:30:00.000Z"),
        );

        expect(result.conflict).toMatch(/cannot be combined|no tasks/i);
        expect(result.block.assigneeIds).toEqual(["user-2"]);
        expect(result.block.filters?.dueRange).toBe("today");
    });

    it("preserves the persisted open-task date semantics when the same chip is active", () => {
        const result = applyViewQuickFilters(
            baseBlock({ dueRange: "overdue", filters: {} }),
            new Set(["overdue"]),
            new Date("2026-10-07T22:30:00.000Z"),
        );

        expect(result.conflict).toBeNull();
        expect(result.block.dueRange).toBe("overdue");
    });

    it("encodes cross-range chip intersections as explicit bounds while preserving server date semantics", () => {
        const now = new Date("2026-10-07T22:30:00.000Z");
        const overdueOnThisWeek = applyViewQuickFilters(
            baseBlock({ dueRange: "this-week", filters: {} }),
            new Set(["overdue"]),
            now,
        );
        const thisWeekOnOverdue = applyViewQuickFilters(
            baseBlock({ dueRange: "overdue", filters: {} }),
            new Set(["this-week"]),
            now,
        );

        expect(overdueOnThisWeek.conflict).toBeNull();
        expect(overdueOnThisWeek.block.dueRange).toBe("this-week");
        expect(overdueOnThisWeek.block.dueAfter).toBe("2026-10-03T21:00:00.000Z");
        expect(overdueOnThisWeek.block.dueBefore).toBe("2026-10-07T20:59:59.999Z");
        expect(serializeViewTaskQuery(overdueOnThisWeek.block).get("dueAfter")).toBe("2026-10-03T21:00:00.000Z");
        expect(serializeViewTaskQuery(overdueOnThisWeek.block).get("dueBefore")).toBe("2026-10-07T20:59:59.999Z");

        expect(thisWeekOnOverdue.conflict).toBeNull();
        expect(thisWeekOnOverdue.block.dueRange).toBe("overdue");
        expect(thisWeekOnOverdue.block.dueAfter).toBe("2026-10-03T21:00:00.000Z");
        expect(thisWeekOnOverdue.block.dueBefore).toBe("2026-10-07T20:59:59.999Z");
    });

    it("keeps overdue and this-week chips mutually exclusive", () => {
        const result = applyViewQuickFilters(
            baseBlock({ dueRange: undefined }),
            new Set(["overdue", "this-week"]),
            new Date("2026-10-07T22:30:00.000Z"),
        );

        expect(result.conflict).toMatch(/choose one|mutually exclusive/i);
    });
});
