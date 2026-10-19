import { describe, expect, it } from "vitest";
import { VIEW_TEMPLATES } from "./view-templates";
import {
    normalizeViewTaskQuery,
    parseViewTaskSearchParams,
    riyadhDayWindow,
    type ViewTaskBlockConfig,
} from "./view-task-query";

const ACTOR_ID = "actor-1";
const NOW = new Date("2026-10-07T22:30:00.000Z");

function normalize(block: ViewTaskBlockConfig) {
    return normalizeViewTaskQuery(block, ACTOR_ID, NOW);
}

function taskBlocks() {
    return VIEW_TEMPLATES.flatMap((template) => template.blocks)
        .filter((block) => block.type === "taskView")
        .map((block) => block as unknown as ViewTaskBlockConfig);
}

describe("normalizeViewTaskQuery", () => {
    it("normalizes every current task-view template deterministically", () => {
        const blocks = taskBlocks();
        expect(blocks.length).toBeGreaterThan(0);

        for (const block of blocks) {
            const first = normalize(block);
            const second = normalize(block);
            expect(first).toEqual(second);
            expect(first.input.cursor).toBeUndefined();
            expect(first.offset).toBe(0);
        }
    });

    it("binds @me to the actor and maps dueAt/project grouping locally", () => {
        const result = normalize({
            assigneeIds: ["@me"],
            dueRange: "today",
            sortBy: "dueAt",
            sortDir: "asc",
            groupBy: "project",
        });

        expect(result.input.filters.assigneeIds).toEqual([ACTOR_ID]);
        expect(result.input.sortBy).toBe("dueDate");
        expect(result.input.dir).toBe("asc");
        expect(result.groupBy).toBe("project");
        expect(result.input.groupBy).toBe("none");
        expect(result.input.cursor).toBeUndefined();
        expect(result.input.filters.dueAfter).toBe("2026-10-07T21:00:00.000Z");
        expect(result.input.filters.dueBefore).toBe("2026-10-08T20:59:59.999Z");
        expect(result.input.filters.statusNotIn).toEqual(["DONE", "CANCELED"]);
    });

    it("preserves legacy filters and intersects singular and multiple projects", () => {
        const result = normalize({
            projectId: "project-1",
            projectIds: ["project-1", "project-2"],
            filters: {
                status: "TODO,DONE",
                priority: "HIGH",
                tagIds: "tag-1,tag-2",
            },
        });

        expect(result.input.filters.status).toEqual(["TODO", "DONE"]);
        expect(result.input.filters.priority).toEqual(["HIGH"]);
        expect(result.input.filters.projectId).toBe("project-1");
        expect(result.input.filters.projectIds).toEqual(["project-1", "project-2"]);
        expect(result.input.filters.tagIds).toEqual(["tag-1", "tag-2"]);
    });

    it("supports every reviewed date range with Riyadh calendar boundaries", () => {
        expect(normalize({ dueRange: "overdue" }).input.filters).toMatchObject({
            dueBefore: "2026-10-07T20:59:59.999Z",
            statusNotIn: ["DONE", "CANCELED"],
        });
        expect(normalize({ dueRange: "this-week" }).input.filters).toMatchObject({
            dueAfter: "2026-10-03T21:00:00.000Z",
            dueBefore: "2026-10-10T20:59:59.999Z",
            statusNotIn: ["DONE", "CANCELED"],
        });

        const explicitTerminal = normalize({ dueRange: "today", filters: { status: "DONE" } });
        expect(explicitTerminal.input.filters.status).toEqual(["DONE"]);
        expect(explicitTerminal.input.filters.statusNotIn).toEqual([]);
    });

    it("intersects explicit due bounds with a date range and rejects inverted results", () => {
        const result = normalize({
            dueRange: "today",
            dueAfter: "2026-10-07T22:00:00.000Z",
            dueBefore: "2026-10-08T20:00:00.000Z",
        });

        expect(result.input.filters.dueAfter).toBe("2026-10-07T22:00:00.000Z");
        expect(result.input.filters.dueBefore).toBe("2026-10-08T20:00:00.000Z");

        const clipped = normalize({
            dueRange: "today",
            dueAfter: "2026-10-07T20:00:00.000Z",
            dueBefore: "2026-10-09T00:00:00.000Z",
        });
        expect(clipped.input.filters.dueAfter).toBe("2026-10-07T21:00:00.000Z");
        expect(clipped.input.filters.dueBefore).toBe("2026-10-08T20:59:59.999Z");

        const crossRange = normalize({
            dueRange: "this-week",
            dueAfter: "2026-10-03T21:00:00.000Z",
            dueBefore: "2026-10-07T20:59:59.999Z",
        });
        expect(crossRange.input.filters.dueAfter).toBe("2026-10-03T21:00:00.000Z");
        expect(crossRange.input.filters.dueBefore).toBe("2026-10-07T20:59:59.999Z");

        expect(() => normalize({
            dueRange: "today",
            dueBefore: "2026-10-07T20:59:59.999Z",
        })).toThrow();
        expect(() => normalize({
            dueRange: "today",
            dueAfter: "2026-10-08T21:00:00.000Z",
        })).toThrow();
    });

    it("exposes explicit due bounds through endpoint query parsing", () => {
        const parsed = parseViewTaskSearchParams(new URLSearchParams(
            "dueAfter=2026-10-01T00:00:00.000Z&dueBefore=2026-10-10T00:00:00.000Z",
        ));

        expect(parsed.dueAfter).toBe("2026-10-01T00:00:00.000Z");
        expect(parsed.dueBefore).toBe("2026-10-10T00:00:00.000Z");
    });

    it("uses the Riyadh day boundary rather than the host timezone", () => {
        const atMidnight = normalizeViewTaskQuery(
            { dueRange: "today" },
            ACTOR_ID,
            new Date("2026-10-07T21:00:00.000Z"),
        );

        expect(riyadhDayWindow(new Date("2026-10-07T21:00:00.000Z"))).toEqual({
            start: new Date("2026-10-07T21:00:00.000Z"),
            end: new Date("2026-10-08T21:00:00.000Z"),
        });
        expect(atMidnight.input.filters.dueAfter).toBe("2026-10-07T21:00:00.000Z");
        expect(atMidnight.input.filters.dueBefore).toBe("2026-10-08T20:59:59.999Z");
    });

    it("supports each view-local grouping and both stable sort directions", () => {
        for (const groupBy of ["status", "priority", "assignee", "project", "none"] as const) {
            const result = normalize({ groupBy, sortBy: "priority", sortDir: "desc" });
            expect(result.groupBy).toBe(groupBy);
            expect(result.input.groupBy).toBe(groupBy === "project" ? "none" : groupBy);
            expect(result.input.sortBy).toBe("priority");
            expect(result.input.dir).toBe("desc");
        }

        expect(normalize({ sortBy: "dueDate", sortDir: "asc" }).input).toMatchObject({
            sortBy: "dueDate",
            dir: "asc",
        });
    });

    it("defaults missing fields without creating a cursor or losing the offset contract", () => {
        expect(normalize({})).toEqual({
            input: {
                filters: {
                    status: [],
                    priority: [],
                    assigneeIds: [],
                    tagIds: [],
                    projectIds: [],
                    includeArchived: false,
                    statusNotIn: [],
                },
                groupBy: "none",
                sortBy: "updatedAt",
                dir: "desc",
            },
            groupBy: "none",
            offset: 0,
        });
    });

    it("rejects unknown values, invalid offsets, and oversized lists", () => {
        expect(() => normalize({ dueRange: "tomorrow" })).toThrow();
        expect(() => normalize({ sortBy: "title;drop-table" })).toThrow();
        expect(() => normalize({ groupBy: "workspace" })).toThrow();
        expect(() => normalize({ filters: { status: "NOT_A_STATUS" } })).toThrow();
        expect(() => normalize({ offset: -1 })).toThrow();
        expect(() => normalize({ offset: 1.5 })).toThrow();
        expect(() => normalize({ offset: 10001 })).toThrow();
        expect(() => normalize({ assigneeIds: Array.from({ length: 101 }, (_, index) => `u-${index}`) })).toThrow();
    });
});
