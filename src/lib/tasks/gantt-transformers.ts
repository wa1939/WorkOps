import type { Task } from "gantt-task-react";

export type GanttDateInput = Date | string | null | undefined;

export interface GanttTaskInput {
    id: string;
    title: string;
    status: string;
    manualProgress?: number | null;
    plannedStartAt?: GanttDateInput;
    plannedEndAt?: GanttDateInput;
    startAt?: GanttDateInput;
    dueAt?: GanttDateInput;
    stageId?: string | null;
    dependencies?: ReadonlyArray<{ dependsOnId: string } | string>;
}

export interface GanttStageInput {
    id: string;
    name: string;
    order?: number | null;
    color?: string | null;
}

export interface GanttTransformResult {
    tasks: Task[];
    undatedCount: number;
}

interface DatedTask {
    source: GanttTaskInput;
    start: Date;
    end: Date;
}

const UNSTAGED_ID = "stage:unassigned";
const DAY_IN_MS = 24 * 60 * 60 * 1000;

function toDate(value: GanttDateInput): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
    }
    if (typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function taskDates(task: GanttTaskInput): { start: Date; end: Date } | null {
    const start = toDate(task.plannedStartAt ?? task.startAt);
    const end = toDate(task.plannedEndAt ?? task.dueAt);
    if (!start || !end) return null;

    // gantt-task-react expects a non-negative task duration. Keep malformed
    // records visible without mutating the source dates.
    return end.getTime() < start.getTime()
        ? { start, end: new Date(start.getTime() + DAY_IN_MS) }
        : { start, end };
}

function progressFor(task: GanttTaskInput): number {
    if (task.manualProgress !== null && task.manualProgress !== undefined) {
        return Math.max(0, Math.min(100, task.manualProgress));
    }
    return task.status === "DONE" ? 100 : 0;
}

function dependencyIds(task: GanttTaskInput): string[] | undefined {
    if (!task.dependencies?.length) return undefined;
    const ids = task.dependencies
        .map((dependency) => typeof dependency === "string" ? dependency : dependency.dependsOnId)
        .filter((id) => id.length > 0);
    return ids.length > 0 ? ids : undefined;
}

function stageOrder(stage: GanttStageInput): number {
    return stage.order ?? Number.MAX_SAFE_INTEGER;
}

function stageStyles(stage: GanttStageInput | undefined): NonNullable<Task["styles"]> {
    const color = stage?.color ?? "hsl(var(--primary))";
    return {
        backgroundColor: color,
        backgroundSelectedColor: "hsl(var(--accent))",
        progressColor: color,
        progressSelectedColor: color,
    };
}

/** Convert project tasks and stages into the gantt-task-react task contract. */
export function toGanttTasks(
    tasks: readonly GanttTaskInput[],
    stages: readonly GanttStageInput[],
): GanttTransformResult {
    const stageById = new Map(stages.map((stage) => [stage.id, stage]));
    const datedByStage = new Map<string, DatedTask[]>();
    let undatedCount = 0;

    for (const source of tasks) {
        const dates = taskDates(source);
        if (!dates) {
            undatedCount += 1;
            continue;
        }

        const stageId = source.stageId && stageById.has(source.stageId)
            ? source.stageId
            : UNSTAGED_ID;
        const group = datedByStage.get(stageId) ?? [];
        group.push({ source, ...dates });
        datedByStage.set(stageId, group);
    }

    const orderedStages = Array.from(stages)
        .sort((left, right) => stageOrder(left) - stageOrder(right));
    const orderedGroupIds = orderedStages
        .map((stage) => stage.id)
        .filter((stageId) => datedByStage.has(stageId));
    if (datedByStage.has(UNSTAGED_ID)) orderedGroupIds.push(UNSTAGED_ID);

    const ganttTasks: Task[] = [];
    for (const groupId of orderedGroupIds) {
        const group = datedByStage.get(groupId);
        if (!group || group.length === 0) continue;

        const stage = stageById.get(groupId);
        const start = new Date(Math.min(...group.map((item) => item.start.getTime())));
        const end = new Date(Math.max(...group.map((item) => item.end.getTime())));
        const progress = Math.round(
            group.reduce((total, item) => total + progressFor(item.source), 0) / group.length,
        );

        ganttTasks.push({
            id: groupId,
            name: stage?.name ?? "Unstaged",
            start,
            end,
            progress,
            type: "project",
            hideChildren: false,
            styles: stageStyles(stage),
        });

        for (const { source, start: taskStart, end: taskEnd } of group) {
            ganttTasks.push({
                id: source.id,
                name: source.title,
                start: taskStart,
                end: taskEnd,
                progress: progressFor(source),
                type: "task",
                project: groupId,
                dependencies: dependencyIds(source),
                styles: stageStyles(stage),
            });
        }
    }

    return { tasks: ganttTasks, undatedCount };
}
