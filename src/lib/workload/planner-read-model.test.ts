import { describe, expect, it } from "vitest";
import { summarizeWorkload } from "./summary";
import { buildPlannerModel, type PlannerTask, type PlannerUser } from "./planner-read-model";

const RANGE_START = "2026-01-04T00:00:00+03:00";
const RANGE_END = "2026-01-10T23:59:59+03:00";

const alice: PlannerUser = {
    id: "alice",
    name: "Alice",
    image: "https://example.test/alice.png",
    capacityPerWeekHours: 40,
};

const bob: PlannerUser = {
    id: "bob",
    name: "Bob",
    image: null,
    capacityPerWeekHours: 40,
};

function task(overrides: Partial<PlannerTask> = {}): PlannerTask {
    return {
        id: "task-1",
        taskKey: "TASK-1",
        title: "Prepare brief",
        status: "TODO",
        priority: "HIGH",
        estimateMinutes: 960,
        remainingEffortHours: 16,
        plannedStartAt: RANGE_START,
        plannedEndAt: RANGE_END,
        projectId: "project-1",
        projectName: "Project One",
        assignments: [{ userId: "alice" }],
        ...overrides,
    };
}

describe("buildPlannerModel", () => {
    it("spreads one assignee across working days while skipping leave and weekends", () => {
        const model = buildPlannerModel({
            rangeStart: RANGE_START,
            rangeEnd: RANGE_END,
            users: [alice],
            tasks: [task()],
            leavePeriods: [{
                userId: "alice",
                startAt: "2026-01-05T00:00:00+03:00",
                endAt: "2026-01-06T00:00:00+03:00",
            }],
        });

        const member = model.members[0];
        expect(member.days.map((day) => day.datePart)).toEqual([
            "2026-01-04",
            "2026-01-05",
            "2026-01-06",
            "2026-01-07",
            "2026-01-08",
            "2026-01-09",
            "2026-01-10",
        ]);
        expect(member.days.find((day) => day.datePart === "2026-01-05")).toMatchObject({
            capacityHours: 0,
            allocatedHours: 0,
            isTimeOff: true,
            isWeekend: false,
        });
        expect(member.days.find((day) => day.datePart === "2026-01-09")).toMatchObject({
            capacityHours: 0,
            allocatedHours: 0,
            isTimeOff: false,
            isWeekend: true,
        });
        expect(member.days.filter((day) => day.taskChips.length > 0).map((day) => day.datePart)).toEqual([
            "2026-01-04",
            "2026-01-06",
        ]);
        expect(member.days.filter((day) => day.taskChips.length > 0)
            .flatMap((day) => day.taskChips)
            .reduce((sum, chip) => sum + chip.hours, 0)).toBe(16);
    });

    it("splits task effort by plannedShare before scheduling each member", () => {
        const model = buildPlannerModel({
            rangeStart: RANGE_START,
            rangeEnd: RANGE_END,
            users: [alice, bob],
            tasks: [task({
                remainingEffortHours: 10,
                assignments: [
                    { userId: "alice", plannedShare: 0.75 },
                    { userId: "bob", plannedShare: 0.25 },
                ],
            })],
            leavePeriods: [],
        });

        const aliceHours = model.members.find((member) => member.id === "alice")?.days
            .flatMap((day) => day.taskChips)
            .reduce((sum, chip) => sum + chip.hours, 0);
        const bobHours = model.members.find((member) => member.id === "bob")?.days
            .flatMap((day) => day.taskChips)
            .reduce((sum, chip) => sum + chip.hours, 0);

        expect(aliceHours).toBe(7.5);
        expect(bobHours).toBe(2.5);
    });

    it("marks a member overloaded and reports a capacity backlog when work cannot fit", () => {
        const model = buildPlannerModel({
            rangeStart: "2026-01-04T00:00:00+03:00",
            rangeEnd: "2026-01-04T23:59:59+03:00",
            users: [alice],
            tasks: [task({ remainingEffortHours: 10 })],
            leavePeriods: [],
        });

        expect(model.backlog).toEqual([{ taskId: "task-1", reason: "capacity" }]);
        expect(model.members[0].state).toBe("overloaded");
        expect(model.members[0].days[0]).toMatchObject({
            allocatedHours: 8,
            availableHours: 0,
            utilizationPercent: 100,
        });
    });

    it("matches summarizeWorkload percentage math for the member period", () => {
        const model = buildPlannerModel({
            rangeStart: RANGE_START,
            rangeEnd: RANGE_END,
            users: [alice],
            tasks: [task({ remainingEffortHours: 14 })],
            leavePeriods: [],
        });
        const member = model.members[0];
        const allocated = member.days.map((day) => day.allocatedHours);
        const capacity = member.days.reduce((sum, day) => sum + day.capacityHours, 0);

        expect(member.periodUtilizationPercent).toBe(
            summarizeWorkload(allocated, capacity).percent,
        );
    });

    it("aggregates scheduled hours by project on the project axis", () => {
        const model = buildPlannerModel({
            rangeStart: "2026-01-04T00:00:00+03:00",
            rangeEnd: "2026-01-06T23:59:59+03:00",
            users: [alice],
            tasks: [
                task({
                    id: "task-a",
                    taskKey: "TASK-A",
                    projectId: "project-1",
                    projectName: "Project One",
                    remainingEffortHours: 4,
                }),
                task({
                    id: "task-b",
                    taskKey: "TASK-B",
                    projectId: "project-2",
                    projectName: "Project Two",
                    remainingEffortHours: 2,
                }),
            ],
            leavePeriods: [],
        });

        expect(model.projectAxis).toHaveLength(2);
        expect(model.projectAxis.find((project) => project.projectId === "project-1")).toMatchObject({
            name: "Project One",
            days: [
                { datePart: "2026-01-04", allocatedHours: 4 },
                { datePart: "2026-01-05", allocatedHours: 0 },
                { datePart: "2026-01-06", allocatedHours: 0 },
            ],
            loadMeter: { allocatedHours: 4 },
        });
        expect(model.projectAxis.find((project) => project.projectId === "project-2")?.days[0].allocatedHours).toBe(2);
    });

    it("accounts for committed time and earlier allocations when filling a day", () => {
        const model = buildPlannerModel({
            rangeStart: "2026-01-04T00:00:00+03:00",
            rangeEnd: "2026-01-04T23:59:59+03:00",
            users: [alice],
            tasks: [
                task({ id: "task-first", remainingEffortHours: 3 }),
                task({ id: "task-second", remainingEffortHours: 3 }),
            ],
            leavePeriods: [],
            existingTimeLogs: [{ userId: "alice", datePart: "2026-01-04", minutes: 240 }],
        });

        expect(model.members[0].days[0]).toMatchObject({
            capacityHours: 4,
            allocatedHours: 4,
            availableHours: 0,
        });
        expect(model.backlog).toContainEqual({ taskId: "task-second", reason: "capacity" });
        expect(model.members[0].state).toBe("overloaded");
    });
});
