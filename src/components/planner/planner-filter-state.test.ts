import { describe, expect, it } from "vitest";
import type { PlannerMember, PlannerTaskChip } from "@/lib/workload/planner-read-model";
import {
    EMPTY_PLANNER_FILTERS,
    memberMatchesPlannerFilters,
    mergePlannerFilterStateIntoUrl,
    parsePlannerFilterState,
    serializePlannerFilterState,
    type PlannerFilterState,
} from "./planner-filter-state";

function chip(overrides: Partial<PlannerTaskChip> = {}): PlannerTaskChip {
    return {
        taskId: "task-1",
        taskKey: "TASK-1",
        title: "Prepare brief",
        hours: 4,
        projectId: "project-a",
        projectName: "Project A",
        status: "TODO",
        priority: "HIGH",
        ...overrides,
    };
}

function member(overrides: Partial<PlannerMember> = {}): PlannerMember {
    return {
        id: "alice",
        name: "Alice",
        image: null,
        days: [{
            datePart: "2026-09-13",
            capacityHours: 7,
            allocatedHours: 4,
            availableHours: 3,
            utilizationPercent: 57.1,
            isTimeOff: false,
            isWeekend: false,
            taskChips: [chip()],
        }],
        periodUtilizationPercent: 57.1,
        state: "available",
        ...overrides,
    };
}

function filters(overrides: Partial<PlannerFilterState> = {}): PlannerFilterState {
    return {
        ...EMPTY_PLANNER_FILTERS,
        ...overrides,
    };
}

describe("memberMatchesPlannerFilters", () => {
    it("passes a member when every selected row and task filter matches", () => {
        expect(memberMatchesPlannerFilters(member({ state: "booked" }), filters({
            memberIds: ["alice"],
            projectIds: ["project-a"],
            statuses: ["TODO"],
            priorities: ["HIGH"],
            utilizationBuckets: ["booked"],
        }))).toBe(true);
    });

    it("fails a member when a selected task dimension has no matching chip", () => {
        expect(memberMatchesPlannerFilters(member({ state: "booked" }), filters({
            projectIds: ["project-a"],
            statuses: ["DOING"],
            priorities: ["HIGH"],
            utilizationBuckets: ["booked"],
        }))).toBe(false);
    });

    it("fails a member when its id or utilization bucket is excluded", () => {
        expect(memberMatchesPlannerFilters(member(), filters({ memberIds: ["bob"] }))).toBe(false);
        expect(memberMatchesPlannerFilters(member(), filters({ utilizationBuckets: ["overloaded"] }))).toBe(false);
    });

    it("passes an unfiltered member even when it has no task chips", () => {
        expect(memberMatchesPlannerFilters(member({ days: [] }), EMPTY_PLANNER_FILTERS)).toBe(true);
    });
});

describe("planner filter URL state", () => {
    it("round-trips all multi-select values and preserves unrelated URL parameters", () => {
        const expected = filters({
            memberIds: ["alice", "bob"],
            projectIds: ["project-a", "project-b"],
            statuses: ["TODO", "DOING"],
            priorities: ["HIGH", "URGENT"],
            utilizationBuckets: ["available", "overloaded"],
        });
        const serialized = serializePlannerFilterState(expected);

        expect(parsePlannerFilterState(new URLSearchParams(serialized))).toEqual(expected);
        expect(serializePlannerFilterState(parsePlannerFilterState(new URLSearchParams(serialized)))).toBe(serialized);

        const merged = mergePlannerFilterStateIntoUrl(
            new URLSearchParams("from=2026-09-13&to=2026-09-19&view=week"),
            expected,
        );
        const mergedParams = new URLSearchParams(merged);
        expect(mergedParams.get("view")).toBe("week");
        expect(parsePlannerFilterState(mergedParams)).toEqual(expected);
    });
});
