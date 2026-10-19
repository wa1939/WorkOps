import { describe, expect, it } from "vitest";
import { toGanttTasks, type GanttStageInput, type GanttTaskInput } from "./gantt-transformers";

const stages: GanttStageInput[] = [
    { id: "stage-a", name: "Discovery", order: 1, color: "#2563eb" },
    { id: "stage-b", name: "Delivery", order: 2, color: "#16a34a" },
];

function task(input: Partial<GanttTaskInput> & Pick<GanttTaskInput, "id" | "title">): GanttTaskInput {
    return {
        status: "TODO",
        manualProgress: null,
        plannedStartAt: null,
        plannedEndAt: null,
        startAt: null,
        dueAt: null,
        stageId: null,
        dependencies: [],
        ...input,
    };
}

describe("toGanttTasks", () => {
    it("maps planned dates, fallback dates, progress, and dependency ids", () => {
        const result = toGanttTasks(
            [
                task({
                    id: "task-1",
                    title: "Plan the work",
                    stageId: "stage-a",
                    plannedStartAt: "2026-09-01T00:00:00.000Z",
                    plannedEndAt: "2026-09-04T00:00:00.000Z",
                    startAt: "2026-08-01T00:00:00.000Z",
                    dueAt: "2026-08-02T00:00:00.000Z",
                    manualProgress: 35,
                    dependencies: [{ dependsOnId: "task-0" }],
                }),
                task({
                    id: "task-2",
                    title: "Ship the work",
                    stageId: "stage-a",
                    startAt: "2026-09-05T00:00:00.000Z",
                    dueAt: "2026-09-06T00:00:00.000Z",
                    status: "DONE",
                }),
            ],
            stages,
        );

        const firstTask = result.tasks.find((item) => item.id === "task-1");
        const doneTask = result.tasks.find((item) => item.id === "task-2");

        expect(result.undatedCount).toBe(0);
        expect(firstTask).toMatchObject({
            type: "task",
            name: "Plan the work",
            project: "stage-a",
            progress: 35,
            dependencies: ["task-0"],
        });
        expect(firstTask?.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
        expect(firstTask?.end.toISOString()).toBe("2026-09-04T00:00:00.000Z");
        expect(doneTask?.progress).toBe(100);
    });

    it("filters tasks missing either gantt date and reports their count", () => {
        const result = toGanttTasks(
            [
                task({ id: "missing-start", title: "Needs a start", dueAt: "2026-09-04T00:00:00.000Z" }),
                task({ id: "missing-end", title: "Needs an end", startAt: "2026-09-04T00:00:00.000Z" }),
                task({
                    id: "dated",
                    title: "Ready",
                    startAt: "2026-09-04T00:00:00.000Z",
                    dueAt: "2026-09-05T00:00:00.000Z",
                    stageId: "stage-b",
                }),
            ],
            stages,
        );

        expect(result.undatedCount).toBe(2);
        expect(result.tasks.map((item) => item.id)).toEqual(["stage-b", "dated"]);
    });

    it("groups dated tasks under ordered project-stage rows", () => {
        const result = toGanttTasks(
            [
                task({
                    id: "delivery-task",
                    title: "Deliver",
                    stageId: "stage-b",
                    startAt: "2026-09-10T00:00:00.000Z",
                    dueAt: "2026-09-12T00:00:00.000Z",
                }),
                task({
                    id: "discovery-task",
                    title: "Discover",
                    stageId: "stage-a",
                    startAt: "2026-09-01T00:00:00.000Z",
                    dueAt: "2026-09-03T00:00:00.000Z",
                    manualProgress: 50,
                }),
            ],
            [stages[1], stages[0]],
        );

        expect(result.tasks.map((item) => item.id)).toEqual([
            "stage-a",
            "discovery-task",
            "stage-b",
            "delivery-task",
        ]);
        expect(result.tasks[0]).toMatchObject({ type: "project", name: "Discovery", progress: 50 });
        expect(result.tasks[0].start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
        expect(result.tasks[0].end.toISOString()).toBe("2026-09-03T00:00:00.000Z");
        expect(result.tasks[2]).toMatchObject({ type: "project", name: "Delivery", progress: 0 });
    });
});
