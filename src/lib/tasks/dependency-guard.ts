import type { TaskStatus } from "@prisma/client";

export type DependencyGuardTask = {
    id?: string;
    status: TaskStatus;
};

export type DependencyGuardDependencyTask = {
    id?: string;
    taskKey?: string | null;
    status: TaskStatus;
};

export type DependencyGuardDependency =
    | DependencyGuardDependencyTask
    | { dependsOn: DependencyGuardDependencyTask };

function dependencyTask(dependency: DependencyGuardDependency): DependencyGuardDependencyTask {
    return "dependsOn" in dependency ? dependency.dependsOn : dependency;
}

function isIncomplete(status: TaskStatus): boolean {
    return status !== "DONE" && status !== "CANCELED";
}

/** Return the first dependency that prevents a done-state transition. */
export function findIncompleteDependency(
    dependencies: readonly DependencyGuardDependency[],
): DependencyGuardDependencyTask | null {
    return dependencies
        .map(dependencyTask)
        .find((dependency) => isIncomplete(dependency.status)) ?? null;
}

/**
 * Check whether a task can enter or leave DONE.
 *
 * Dependencies are the tasks this task depends on. DONE and CANCELED
 * dependencies are terminal; every other status is still a blocker. Moving
 * between non-DONE states is allowed because the dependency constraint only
 * protects completion and reopening.
 */
export function canChangeStatus(
    task: DependencyGuardTask,
    dependencies: readonly DependencyGuardDependency[],
    newStatus: TaskStatus,
): boolean {
    const changesDoneState = task.status !== newStatus
        && (task.status === "DONE" || newStatus === "DONE");
    return !changesDoneState || findIncompleteDependency(dependencies) === null;
}
