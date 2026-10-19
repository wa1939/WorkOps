"use client";

import { addDays, differenceInCalendarDays, isAfter, isBefore, startOfDay } from "date-fns";
import { AlertCircle, CalendarDays, Loader2, MoveHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { buildRuler, pxPerDay, type TimelineZoom } from "@/lib/timeline/ruler";
import { DateRuler } from "./DateRuler";
import { ProjectBar } from "./ProjectBar";
import type {
    InteractionMode,
    ProjectDates,
    TimelineProject,
    TimelineResponse,
} from "./types";

const LABEL_WIDTH = 240;
const INITIAL_RANGE_BEFORE_DAYS = 30;
const INITIAL_RANGE_AFTER_DAYS = 60;
const PLACEMENT_DURATION_DAYS = 30;

const ZOOM_OPTIONS: Array<{ value: TimelineZoom; label: string }> = [
    { value: "day", label: "Days" },
    { value: "week", label: "Weeks" },
    { value: "month", label: "Months" },
    { value: "quarter", label: "Quarters" },
    { value: "year", label: "Years" },
];

const EMPTY_RESPONSE: TimelineResponse = { projects: [], minDate: null, maxDate: null };

type Interaction = {
    project: TimelineProject;
    mode: InteractionMode;
    originX: number;
    origin: ProjectDates;
    current: ProjectDates;
};

type WeekendSegment = { left: number; width: number; key: string };

type PendingDrag = { projectId: string; dates: ProjectDates };

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function projectDates(project: TimelineProject): ProjectDates | null {
    const start = parseDate(project.startAt);
    const dueAt = parseDate(project.dueAt);
    const dueAtEnd = parseDate(project.dueAtEnd);
    if (!start || (!dueAt && !dueAtEnd)) return null;

    const effectiveDueAt = dueAt ?? dueAtEnd;
    if (!effectiveDueAt || isBefore(effectiveDueAt, start)) return null;
    const effectiveEnd = dueAtEnd ?? effectiveDueAt;
    if (isBefore(effectiveEnd, start)) return null;

    return {
        start,
        end: effectiveEnd,
        dueAt: effectiveDueAt,
        dueAtEnd,
    };
}

function withProjectDates(project: TimelineProject, dates: ProjectDates | null): TimelineProject {
    return {
        ...project,
        startAt: dates?.start.toISOString() ?? null,
        dueAt: dates?.dueAt.toISOString() ?? null,
        dueAtEnd: dates?.dueAtEnd?.toISOString() ?? null,
    };
}

function updateProjectDates(
    projects: TimelineProject[],
    projectId: string,
    dates: ProjectDates | null,
): TimelineProject[] {
    return projects.map((project) =>
        project.id === projectId ? withProjectDates(project, dates) : project,
    );
}

function sameDate(left: Date, right: Date): boolean {
    return left.getTime() === right.getTime();
}

function sameProjectDates(left: ProjectDates, right: ProjectDates): boolean {
    return (
        sameDate(left.start, right.start) &&
        sameDate(left.dueAt, right.dueAt) &&
        (left.dueAtEnd === null || right.dueAtEnd === null
            ? left.dueAtEnd === right.dueAtEnd
            : sameDate(left.dueAtEnd, right.dueAtEnd))
    );
}

function shiftDates(dates: ProjectDates, days: number): ProjectDates {
    return {
        start: addDays(dates.start, days),
        end: addDays(dates.end, days),
        dueAt: addDays(dates.dueAt, days),
        dueAtEnd: dates.dueAtEnd ? addDays(dates.dueAtEnd, days) : null,
    };
}

function resizeDates(dates: ProjectDates, mode: InteractionMode, days: number): ProjectDates {
    if (mode === "move") return shiftDates(dates, days);

    if (mode === "resize-start") {
        const latestStart = dates.dueAt;
        const candidate = addDays(dates.start, days);
        return { ...dates, start: isAfter(candidate, latestStart) ? latestStart : candidate };
    }

    const candidate = addDays(dates.end, days);
    if (dates.dueAtEnd) {
        const nextEnd = isBefore(candidate, dates.dueAt) ? dates.dueAt : candidate;
        return { ...dates, end: nextEnd, dueAtEnd: nextEnd };
    }
    const nextDueAt = isBefore(candidate, dates.start) ? dates.start : candidate;
    return { ...dates, end: nextDueAt, dueAt: nextDueAt };
}

function timelineRange(
    projects: TimelineProject[],
    minDate: string | null,
    maxDate: string | null,
    today: Date,
): { from: Date; to: Date } {
    let from = addDays(today, -INITIAL_RANGE_BEFORE_DAYS);
    let to = addDays(today, INITIAL_RANGE_AFTER_DAYS);
    const candidates: Date[] = [];

    const apiMin = parseDate(minDate);
    const apiMax = parseDate(maxDate);
    if (apiMin) candidates.push(apiMin);
    if (apiMax) candidates.push(apiMax);
    for (const project of projects) {
        const dates = projectDates(project);
        if (!dates) continue;
        candidates.push(dates.start, dates.end);
    }

    for (const candidate of candidates) {
        if (isBefore(candidate, from)) from = addDays(candidate, -INITIAL_RANGE_BEFORE_DAYS);
        if (isAfter(candidate, to)) to = addDays(candidate, INITIAL_RANGE_AFTER_DAYS);
    }
    return { from, to };
}

function weekendSegments(from: Date, to: Date, zoom: TimelineZoom): WeekendSegment[] {
    if (zoom !== "day" && zoom !== "week") return [];
    const dayWidth = pxPerDay(zoom);
    const result: WeekendSegment[] = [];
    let cursor = from;
    let index = 0;
    while (!isAfter(cursor, to)) {
        const day = cursor.getDay();
        if (day === 0 || day === 6) {
            result.push({ left: index * dayWidth, width: dayWidth, key: cursor.toISOString() });
        }
        cursor = addDays(cursor, 1);
        index += 1;
    }
    return result;
}

function readableHealth(value: string): string {
    return value === "NOT_SET" ? "Health not set" : value.replaceAll("_", " ");
}

export function Timeline() {
    const today = useMemo(() => startOfDay(new Date()), []);
    const [response, setResponse] = useState<TimelineResponse>(EMPTY_RESPONSE);
    const [zoom, setZoom] = useState<TimelineZoom>("month");
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [previewIds, setPreviewIds] = useState<Set<string>>(() => new Set());
    const [draggingProjectId, setDraggingProjectId] = useState<string | null>(null);
    const interactionRef = useRef<Interaction | null>(null);
    const pendingDragRef = useRef<PendingDrag | null>(null);
    const dragFrameRef = useRef<number | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        async function loadTimeline() {
            try {
                const result = await fetch("/api/pmo/timeline", { signal: controller.signal });
                const body = (await result.json()) as TimelineResponse & { error?: string };
                if (!result.ok) throw new Error(body.error ?? "Unable to load the timeline");
                if (!Array.isArray(body.projects)) throw new Error("Timeline response was invalid");
                setResponse({
                    projects: body.projects,
                    minDate: body.minDate ?? null,
                    maxDate: body.maxDate ?? null,
                });
                setLoadError(null);
            } catch (error) {
                if (!controller.signal.aborted) {
                    setLoadError(error instanceof Error ? error.message : "Unable to load the timeline");
                }
            } finally {
                if (!controller.signal.aborted) setIsLoading(false);
            }
        }
        void loadTimeline();
        return () => controller.abort();
    }, []);

    const persistDates = useCallback(
        async (
            project: TimelineProject,
            dates: ProjectDates,
            previous: ProjectDates | null,
            keepPreview = false,
        ) => {
            try {
                const result = await fetch(`/api/projects/${project.id}`, {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                        expectedUpdatedAt: project.updatedAt,
                        dates: {
                            startAt: dates.start.toISOString(),
                            dueAt: dates.dueAt.toISOString(),
                            dueAtEnd: dates.dueAtEnd?.toISOString() ?? null,
                        },
                    }),
                });
                const body = (await result.json().catch(() => ({}))) as Partial<TimelineProject> & { error?: string };
                if (!result.ok) throw new Error(body.error ?? "Unable to save project dates");

                setResponse((current) => ({
                    ...current,
                    projects: current.projects.map((item) =>
                        item.id === project.id
                            ? {
                                  ...item,
                                  startAt: typeof body.startAt === "string" ? body.startAt : dates.start.toISOString(),
                                  dueAt: typeof body.dueAt === "string" ? body.dueAt : dates.dueAt.toISOString(),
                                  dueAtEnd:
                                      body.dueAtEnd === null || typeof body.dueAtEnd === "string"
                                          ? body.dueAtEnd
                                          : dates.dueAtEnd?.toISOString() ?? null,
                                  updatedAt: typeof body.updatedAt === "string" ? body.updatedAt : item.updatedAt,
                              }
                            : item,
                    ),
                }));
                if (!keepPreview) {
                    setPreviewIds((current) => {
                        const next = new Set(current);
                        next.delete(project.id);
                        return next;
                    });
                }
                setNotice(null);
            } catch (error) {
                setResponse((current) => ({
                    ...current,
                    projects: updateProjectDates(current.projects, project.id, previous),
                }));
                setPreviewIds((current) => {
                    const next = new Set(current);
                    next.delete(project.id);
                    return next;
                });
                setNotice(error instanceof Error ? error.message : "Unable to save project dates");
            }
        },
        [],
    );

    const commitProjectDates = useCallback(
        (project: TimelineProject, dates: ProjectDates, previous: ProjectDates) => {
            if (sameProjectDates(dates, previous)) return;
            void persistDates(project, dates, previous);
        },
        [persistDates],
    );

    const beginInteraction = useCallback(
        (project: TimelineProject, mode: InteractionMode, event: ReactPointerEvent<HTMLDivElement>) => {
            const dates = projectDates(project);
            if (!dates) return;
            event.preventDefault();
            interactionRef.current = {
                project,
                mode,
                originX: event.clientX,
                origin: dates,
                current: dates,
            };
            setDraggingProjectId(project.id);
        },
        [],
    );

    const moveProjectByDays = useCallback(
        (project: TimelineProject, days: number) => {
            const dates = projectDates(project);
            if (!dates || days === 0) return;
            const next = shiftDates(dates, days);
            setResponse((current) => ({
                ...current,
                projects: updateProjectDates(current.projects, project.id, next),
            }));
            commitProjectDates(project, next, dates);
        },
        [commitProjectDates],
    );

    useEffect(() => {
        const cancelScheduledFrame = () => {
            if (dragFrameRef.current !== null) {
                window.cancelAnimationFrame(dragFrameRef.current);
                dragFrameRef.current = null;
            }
            pendingDragRef.current = null;
        };

        const handlePointerMove = (event: globalThis.PointerEvent) => {
            const interaction = interactionRef.current;
            if (!interaction) return;
            const days = Math.round((event.clientX - interaction.originX) / pxPerDay(zoom));
            const current = resizeDates(interaction.origin, interaction.mode, days);
            interaction.current = current;
            pendingDragRef.current = { projectId: interaction.project.id, dates: current };
            if (dragFrameRef.current !== null) return;
            dragFrameRef.current = window.requestAnimationFrame(() => {
                dragFrameRef.current = null;
                const pendingDrag = pendingDragRef.current;
                pendingDragRef.current = null;
                if (!pendingDrag) return;
                setResponse((currentResponse) => ({
                    ...currentResponse,
                    projects: updateProjectDates(currentResponse.projects, pendingDrag.projectId, pendingDrag.dates),
                }));
            });
        };

        const handlePointerUp = () => {
            cancelScheduledFrame();
            const interaction = interactionRef.current;
            if (!interaction) return;
            interactionRef.current = null;
            setDraggingProjectId(null);
            if (!sameProjectDates(interaction.origin, interaction.current)) {
                commitProjectDates(interaction.project, interaction.current, interaction.origin);
            }
        };

        document.addEventListener("pointermove", handlePointerMove);
        document.addEventListener("pointerup", handlePointerUp);
        document.addEventListener("pointercancel", handlePointerUp);
        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
            document.removeEventListener("pointerup", handlePointerUp);
            document.removeEventListener("pointercancel", handlePointerUp);
            cancelScheduledFrame();
        };
    }, [commitProjectDates, zoom]);

    const placeUndatedProject = useCallback(
        (project: TimelineProject) => {
            if (projectDates(project)) return;
            const dates: ProjectDates = {
                start: today,
                end: addDays(today, PLACEMENT_DURATION_DAYS),
                dueAt: addDays(today, PLACEMENT_DURATION_DAYS),
                dueAtEnd: null,
            };
            setResponse((current) => ({
                ...current,
                projects: updateProjectDates(current.projects, project.id, dates),
            }));
            setPreviewIds((current) => {
                const next = new Set(current);
                next.add(project.id);
                return next;
            });
            void persistDates(project, dates, null, true);
        },
        [persistDates, today],
    );

    const range = useMemo(
        () => timelineRange(response.projects, response.minDate, response.maxDate, today),
        [response.projects, response.minDate, response.maxDate, today],
    );
    const ruler = useMemo(() => buildRuler(range.from, range.to, zoom), [range.from, range.to, zoom]);
    const dayWidth = pxPerDay(zoom);
    const weekendColumns = useMemo(
        () => weekendSegments(range.from, range.to, zoom),
        [range.from, range.to, zoom],
    );
    const datedRows = useMemo(() => {
        const rows: Array<{ project: TimelineProject; dates: ProjectDates }> = [];
        for (const project of response.projects) {
            const dates = projectDates(project);
            if (dates) rows.push({ project, dates });
        }
        return rows;
    }, [response.projects]);
    const undatedProjects = useMemo(
        () => response.projects.filter((project) => !projectDates(project)),
        [response.projects],
    );
    const todayOffset = differenceInCalendarDays(today, range.from) * dayWidth;

    if (isLoading) {
        return (
            <div className="flex min-h-64 items-center justify-center rounded-xl border bg-card text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading portfolio timeline…
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-card p-6 text-center">
                <AlertCircle className="h-6 w-6 text-destructive" />
                <p className="text-sm text-destructive">{loadError}</p>
                <Button variant="outline" onClick={() => window.location.reload()}>
                    Try again
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-sm text-muted-foreground">Projects as rows</p>
                    <h1 className="text-3xl font-bold">Portfolio timeline</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Drag a bar to move it. Use either edge to resize its dates.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <MoveHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <Select value={zoom} onValueChange={(value) => setZoom(value as TimelineZoom)}>
                        <SelectTrigger className="w-32" aria-label="Timeline zoom">
                            <SelectValue placeholder="Zoom" />
                        </SelectTrigger>
                        <SelectContent>
                            {ZOOM_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {notice && (
                <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    {notice}
                </div>
            )}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
                <section className="min-w-0 rounded-xl border bg-card" aria-label="Project timeline chart">
                    <div className="overflow-x-auto">
                        <div className="min-w-max">
                            <DateRuler from={range.from} to={range.to} zoom={zoom} labelWidth={LABEL_WIDTH} />
                            <div className="flex">
                                <div
                                    className="sticky left-0 z-20 shrink-0 border-r bg-card"
                                    style={{ width: LABEL_WIDTH }}
                                >
                                    {datedRows.length === 0 ? (
                                        <div className="flex h-14 items-center px-3 text-sm text-muted-foreground">
                                            No dated projects
                                        </div>
                                    ) : (
                                        datedRows.map(({ project }) => (
                                            <div
                                                key={project.id}
                                                className="flex h-14 items-center border-b px-3"
                                            >
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-medium" title={project.name}>
                                                        {project.name}
                                                    </div>
                                                    <div className="truncate text-xs text-muted-foreground">
                                                        {readableHealth(project.health)}
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                                <div
                                    className="relative shrink-0"
                                    style={{ width: ruler.totalWidth }}
                                >
                                    <div className="pointer-events-none absolute inset-0 z-0">
                                        {weekendColumns.map((column) => (
                                            <div
                                                key={column.key}
                                                className="absolute inset-y-0 bg-muted/35"
                                                style={{ left: column.left, width: column.width }}
                                            />
                                        ))}
                                    </div>
                                    <div className="relative z-10">
                                        {datedRows.length === 0 ? (
                                            <div className="h-14 border-b" />
                                        ) : (
                                            datedRows.map(({ project, dates }) => {
                                                const left = differenceInCalendarDays(dates.start, range.from) * dayWidth;
                                                const width =
                                                    (differenceInCalendarDays(dates.end, dates.start) + 1) * dayWidth;
                                                return (
                                                    <div key={project.id} className="relative h-14 border-b">
                                                        <ProjectBar
                                                            project={project}
                                                            left={left}
                                                            width={width}
                                                            preview={previewIds.has(project.id)}
                                                            isDragging={draggingProjectId === project.id}
                                                            onPointerDown={(mode, event) =>
                                                                beginInteraction(project, mode, event)
                                                            }
                                                            onKeyboardMove={(days) => moveProjectByDays(project, days)}
                                                        />
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                    <div
                                        className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-destructive"
                                        style={{ left: todayOffset }}
                                        aria-hidden="true"
                                    >
                                        <span className="absolute left-1 top-1 whitespace-nowrap rounded bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground">
                                            Today
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                            <span className="h-3 w-px bg-destructive" aria-hidden="true" />
                            Today
                        </span>
                        {(zoom === "day" || zoom === "week") && (
                            <span>Weekends are shaded</span>
                        )}
                        <span className="ml-auto">{datedRows.length} dated project{datedRows.length === 1 ? "" : "s"}</span>
                    </div>
                </section>

                <aside className="h-fit rounded-xl border bg-card p-4" aria-label="Undated projects">
                    <div className="flex items-start gap-2">
                        <CalendarDays className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <div>
                            <h2 className="font-semibold">Undated projects</h2>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Click a project to preview it from today through 30 days from now.
                            </p>
                        </div>
                    </div>
                    <div className="mt-4 space-y-2">
                        {undatedProjects.length === 0 ? (
                            <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                                All projects have dates.
                            </p>
                        ) : (
                            undatedProjects.map((project) => (
                                <button
                                    key={project.id}
                                    type="button"
                                    className={cn(
                                        "w-full rounded-md border border-dashed px-3 py-2 text-left text-sm transition-colors",
                                        "hover:border-primary hover:bg-primary/5",
                                    )}
                                    onClick={() => placeUndatedProject(project)}
                                >
                                    <span className="block truncate font-medium">{project.name}</span>
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                        Click to place preview
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </aside>
            </div>
        </div>
    );
}
