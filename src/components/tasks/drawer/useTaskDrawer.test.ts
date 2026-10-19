import { describe, expect, it } from "vitest";
import {
    createTaskDrawerUrlState,
    taskDrawerUrlReducer,
    type TaskDrawerUrlState,
} from "./useTaskDrawer";

describe("task drawer URL state", () => {
    it("opens, changes tabs, and closes without losing reducer state", () => {
        const initial = createTaskDrawerUrlState();
        const opened = taskDrawerUrlReducer(initial, { type: "open", taskId: "task-2" });
        expect(opened).toEqual({ taskId: "task-2", tab: "info", commentId: null });

        const activity = taskDrawerUrlReducer(opened, { type: "set-tab", tab: "activity" });
        expect(activity.tab).toBe("activity");
        expect(taskDrawerUrlReducer(activity, { type: "close" })).toEqual(createTaskDrawerUrlState());
    });

    it("moves to the previous and next task in the registered ordered IDs", () => {
        const state: TaskDrawerUrlState = { taskId: "task-2", tab: "time", commentId: "comment-1" };
        const ids = ["task-1", "task-2", "task-3"];
        expect(taskDrawerUrlReducer(state, { type: "previous", ids })).toEqual({
            taskId: "task-1",
            tab: "time",
            commentId: null,
        });
        expect(taskDrawerUrlReducer(state, { type: "next", ids })).toEqual({
            taskId: "task-3",
            tab: "time",
            commentId: null,
        });
    });

    it("keeps an unknown task navigable by moving to the first or last known ID", () => {
        const state: TaskDrawerUrlState = { taskId: "missing", tab: "info", commentId: null };
        expect(taskDrawerUrlReducer(state, { type: "previous", ids: ["task-1", "task-2"] }).taskId).toBe("task-2");
        expect(taskDrawerUrlReducer(state, { type: "next", ids: ["task-1", "task-2"] }).taskId).toBe("task-1");
    });
});
