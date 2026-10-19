import { describe, expect, it } from "vitest";
import {
    dueWindowFilter,
    parseDueWindow,
    parsePriority,
    parseTaskSort,
    taskOrderBy,
} from "./task-query";

// Fixed reference point so the window boundaries are deterministic.
const NOW = new Date("2026-07-26T10:00:00");

describe("query-string parsing", () => {
    it("accepts only supported due windows", () => {
        expect(parseDueWindow("overdue")).toBe("overdue");
        expect(parseDueWindow("week")).toBe("week");
        expect(parseDueWindow("bogus")).toBeUndefined();
        expect(parseDueWindow(undefined)).toBeUndefined();
    });

    it("falls back to priority for unknown sorts", () => {
        expect(parseTaskSort("due-asc")).toBe("due-asc");
        expect(parseTaskSort("; drop table")).toBe("priority");
        expect(parseTaskSort(undefined)).toBe("priority");
    });

    it("rejects priorities outside the enum", () => {
        expect(parsePriority("URGENT")).toBe("URGENT");
        expect(parsePriority("urgent")).toBeUndefined();
        expect(parsePriority("' OR 1=1")).toBeUndefined();
    });
});

describe("dueWindowFilter", () => {
    it("returns an empty fragment when no window is set", () => {
        expect(dueWindowFilter(undefined, NOW)).toEqual({});
    });

    it("matches only undated tasks for 'none'", () => {
        expect(dueWindowFilter("none", NOW)).toEqual({ dueAt: null });
    });

    it("treats overdue as strictly before now", () => {
        expect(dueWindowFilter("overdue", NOW)).toEqual({ dueAt: { lt: NOW } });
    });

    it("includes the whole of today, not just the current instant", () => {
        const filter = dueWindowFilter("today", NOW) as { dueAt: { lte: Date } };
        // A task due at 17:00 today must still count while it is 10:00.
        expect(filter.dueAt.lte.getHours()).toBe(23);
        expect(filter.dueAt.lte.getDate()).toBe(26);
    });

    it("spans seven days inclusive of today for 'week'", () => {
        const filter = dueWindowFilter("week", NOW) as { dueAt: { lte: Date } };
        expect(filter.dueAt.lte.getDate()).toBe(1); // 26 Jul + 6 days = 1 Aug
        expect(filter.dueAt.lte.getMonth()).toBe(7); // August (0-indexed)
    });
});

describe("taskOrderBy", () => {
    it("sorts undated tasks last so real deadlines lead", () => {
        expect(taskOrderBy("due-asc")[0]).toEqual({ dueAt: { sort: "asc", nulls: "last" } });
        expect(taskOrderBy("due-desc")[0]).toEqual({ dueAt: { sort: "desc", nulls: "last" } });
    });

    it("breaks priority ties by soonest due date", () => {
        expect(taskOrderBy("priority")).toEqual([
            { priority: "desc" },
            { dueAt: { sort: "asc", nulls: "last" } },
        ]);
    });

    it("supports creation and title ordering", () => {
        expect(taskOrderBy("created-desc")).toEqual([{ createdAt: "desc" }]);
        expect(taskOrderBy("created-asc")).toEqual([{ createdAt: "asc" }]);
        expect(taskOrderBy("title")).toEqual([{ title: "asc" }]);
    });
});
