"use client";

import { Gantt, ViewMode, type Task } from "gantt-task-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTaskDrawer } from "@/components/tasks/drawer/useTaskDrawer";
import {
    toGanttTasks,
    type GanttStageInput,
    type GanttTaskInput,
} from "@/lib/tasks/gantt-transformers";
import styles from "./TaskGantt.module.css";

interface RoadmapResponse {
    tasks: GanttTaskInput[];
    stages: GanttStageInput[];
}

interface TaskGanttProps {
    projectId: string;
}

const VIEW_MODES = [
    { value: ViewMode.Day, label: "Day" },
    { value: ViewMode.Week, label: "Week" },
    { value: ViewMode.Month, label: "Month" },
] as const;

function dateMatches(value: unknown, expected: Date): boolean {
    if (typeof value !== "string" && !(value instanceof Date)) return false;
    const actual = new Date(value);
    return !Number.isNaN(actual.getTime()) && actual.getTime() === expected.getTime();
}

export function TaskGantt({ projectId }: TaskGanttProps) {
    const { open } = useTaskDrawer();
    const [tasks, setTasks] = useState<Task[]>([]);
    const [undatedCount, setUndatedCount] = useState(0);
    const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Month);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
    const tasksRef = useRef<Task[]>([]);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;

        async function loadRoadmap() {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/roadmap`, {
                    cache: "no-store",
                    signal: controller.signal,
                });
                const body = await response.json().catch(() => null) as RoadmapResponse | { error?: string } | null;
                if (!response.ok) {
                    throw new Error(body && "error" in body && typeof body.error === "string" ? body.error : "Could not load roadmap");
                }
                if (!body || !("tasks" in body) || !Array.isArray(body.tasks) || !Array.isArray(body.stages)) {
                    throw new Error("Roadmap response was invalid");
                }
                const transformed = toGanttTasks(body.tasks, body.stages);
                if (!active) return;
                tasksRef.current = transformed.tasks;
                setTasks(transformed.tasks);
                setUndatedCount(transformed.undatedCount);
            } catch (loadError) {
                if (!active || (loadError instanceof DOMException && loadError.name === "AbortError")) return;
                setError(loadError instanceof Error ? loadError.message : "Could not load roadmap");
            } finally {
                if (active) setLoading(false);
            }
        }

        void loadRoadmap();
        return () => {
            active = false;
            controller.abort();
        };
    }, [projectId]);

    const handleTaskClick = useCallback((task: Task) => {
        if (task.type === "task") open(task.id);
    }, [open]);

    const handleDateChange = useCallback(async (changedTask: Task) => {
        if (changedTask.type !== "task") return;
        const previousTask = tasksRef.current.find((task) => task.id === changedTask.id);
        if (!previousTask) return;

        const nextTask = {
            ...changedTask,
            start: new Date(changedTask.start.getTime()),
            end: new Date(changedTask.end.getTime()),
        };
        const updateTasks = (current: Task[]) => current.map((task) => task.id === nextTask.id ? nextTask : task);
        tasksRef.current = updateTasks(tasksRef.current);
        setTasks(updateTasks);
        setSavingTaskId(nextTask.id);
        setError(null);

        try {
            const response = await fetch(`/api/tasks/${encodeURIComponent(nextTask.id)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    plannedStartAt: nextTask.start.toISOString(),
                    plannedEndAt: nextTask.end.toISOString(),
                }),
            });
            if (!response.ok) throw new Error("Could not save task dates");

            // The task endpoint returns the updated drawer payload; fetch it
            // again so the optimistic chart is confirmed by the persisted row.
            const verificationResponse = await fetch(`/api/tasks/${encodeURIComponent(nextTask.id)}`, {
                cache: "no-store",
            });
            const verification = await verificationResponse.json().catch(() => null) as {
                plannedStartAt?: string | null;
                plannedEndAt?: string | null;
            } | null;
            if (!verificationResponse.ok || !verification ||
                !dateMatches(verification.plannedStartAt, nextTask.start) ||
                !dateMatches(verification.plannedEndAt, nextTask.end)) {
                throw new Error("Task dates could not be verified");
            }
        } catch (saveError) {
            const rollback = (current: Task[]) => current.map((task) => task.id === previousTask.id ? previousTask : task);
            tasksRef.current = rollback(tasksRef.current);
            setTasks(rollback);
            setError(saveError instanceof Error ? saveError.message : "Could not save task dates");
        } finally {
            setSavingTaskId(null);
        }
    }, []);

    return (
        <section className={styles.root} aria-label="Project roadmap">
            <div className={styles.toolbar}>
                <div>
                    <h2 className="text-base font-semibold">Roadmap</h2>
                    <p className="text-xs text-muted-foreground">
                        Drag a task bar to reschedule it. Select a task to open its details.
                    </p>
                </div>
                <div className={styles.viewModes} aria-label="Roadmap view mode">
                    {VIEW_MODES.map((mode) => (
                        <button
                            key={mode.value}
                            type="button"
                            className={styles.viewButton}
                            aria-pressed={viewMode === mode.value}
                            onClick={() => setViewMode(mode.value)}
                        >
                            {mode.label}
                        </button>
                    ))}
                </div>
            </div>

            {undatedCount > 0 && (
                <div className={styles.banner} role="status">
                    {undatedCount} task{undatedCount === 1 ? " is" : "s are"} hidden because it{undatedCount === 1 ? " has" : "s have"} no complete date range.
                </div>
            )}
            {error && <div className={styles.error} role="alert">{error}</div>}

            <div className={styles.chart} data-saving-task={savingTaskId ?? undefined}>
                {loading ? (
                    <div className={styles.empty}>Loading roadmap…</div>
                ) : tasks.length === 0 ? (
                    <div className={styles.empty}>
                        {undatedCount > 0 ? "Add start and end dates to place tasks on the roadmap." : "No dated tasks in this project yet."}
                    </div>
                ) : (
                    <Gantt
                        tasks={tasks}
                        viewMode={viewMode}
                        onClick={handleTaskClick}
                        onDateChange={handleDateChange}
                        listCellWidth="0px"
                        rowHeight={42}
                        headerHeight={56}
                        ganttHeight={Math.min(640, Math.max(220, tasks.length * 42 + 56))}
                        fontFamily="inherit"
                        fontSize="12px"
                        barCornerRadius={5}
                        todayColor="hsl(var(--primary) / 0.08)"
                        arrowColor="hsl(var(--muted-foreground) / 0.6)"
                        barBackgroundColor="hsl(var(--primary) / 0.24)"
                        barBackgroundSelectedColor="hsl(var(--primary) / 0.36)"
                        barProgressColor="hsl(var(--primary))"
                        barProgressSelectedColor="hsl(var(--primary))"
                        projectBackgroundColor="hsl(var(--muted-foreground) / 0.28)"
                        projectBackgroundSelectedColor="hsl(var(--muted-foreground) / 0.4)"
                        projectProgressColor="hsl(var(--primary))"
                        projectProgressSelectedColor="hsl(var(--primary))"
                    />
                )}
            </div>
        </section>
    );
}
