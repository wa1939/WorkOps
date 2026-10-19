import { describe, expect, it } from "vitest";
import { groupTasksByStatus } from "./board-grouping";

describe("groupTasksByStatus", () => {
    it("groups each task under its status without rebuilding columns", () => {
        const tasks = [
            { id: "todo-1", status: "TODO" },
            { id: "done-1", status: "DONE" },
            { id: "todo-2", status: "TODO" },
        ];

        const grouped = groupTasksByStatus(tasks, ["TODO", "DOING", "DONE"]);

        expect(grouped.get("TODO")).toEqual([tasks[0], tasks[2]]);
        expect(grouped.get("DOING")).toEqual([]);
        expect(grouped.get("DONE")).toEqual([tasks[1]]);
    });
});
