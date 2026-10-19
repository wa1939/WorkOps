import type { TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { canChangeStatus, type DependencyGuardDependency } from "./dependency-guard";

function task(status: TaskStatus) {
    return { id: "task-1", status };
}

function dependency(status: TaskStatus, taskKey = "DEP-1"): DependencyGuardDependency {
    return {
        dependsOn: {
            id: `${taskKey}-id`,
            taskKey,
            status,
        },
    };
}

describe("canChangeStatus", () => {
    it("blocks moving into DONE while a dependency is incomplete", () => {
        expect(canChangeStatus(task("DOING"), [dependency("TODO")], "DONE")).toBe(false);
    });

    it("blocks moving out of DONE while a dependency is incomplete", () => {
        expect(canChangeStatus(task("DONE"), [dependency("WAITING")], "DOING")).toBe(false);
    });

    it("allows moving into or out of DONE when every dependency is terminal", () => {
        const dependencies = [dependency("DONE", "DEP-DONE"), dependency("CANCELED", "DEP-CANCELED")];
        expect(canChangeStatus(task("DOING"), dependencies, "DONE")).toBe(true);
        expect(canChangeStatus(task("DONE"), dependencies, "TODO")).toBe(true);
    });

    it("allows a done-state transition when there are no dependencies", () => {
        expect(canChangeStatus(task("TODO"), [], "DONE")).toBe(true);
        expect(canChangeStatus(task("DONE"), [], "DOING")).toBe(true);
    });

    it("does not block transitions between non-DONE states", () => {
        expect(canChangeStatus(task("TODO"), [dependency("BLOCKED")], "DOING")).toBe(true);
    });

    it("treats a canceled dependency as non-blocking", () => {
        expect(canChangeStatus(task("DOING"), [dependency("CANCELED")], "DONE")).toBe(true);
    });
});
