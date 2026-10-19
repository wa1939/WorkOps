"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock3, FolderKanban, Loader2, MoreHorizontal, Plus, UserRound, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import type { PlannerMember, PlannerMemberDay, PlannerTaskChip } from "@/lib/workload/planner-read-model";
import { PlannerFilters, type PlannerFilterOption } from "./PlannerFilters";
import { DEFAULT_PLANNER_SETTINGS, normalizePlannerSettings, PlannerSettingsDrawer, type PlannerSettings } from "./PlannerSettingsDrawer";
import { PlannerGrid as Grid } from "./Grid";
import { RangeNav } from "./RangeNav";
import {
    calendarDayDelta,
    datePartFromIso,
    dayBounds,
    datePartsForRange,
    formatDateLabel,
    formatWeekday,
    navigateAnchor,
    rangeWindow,
    todayDatePart,
    type PlannerRange,
} from "./range-utils";
import { clampEstimateHours, shiftPlannedDateRange, type PlannedDateRange } from "./interactions/planner-math";
import type {
    PlannerApiPayload,
    PlannerDateColumn,
    PlannerDropTarget,
    PlannerProjectDisplayRow,
    PlannerProjectTaskChip,
    PlannerResizeRequest,
    PlannerTaskDragData,
} from "./types";
import {
    hasPlannerFilters,
    memberMatchesPlannerFilters,
    mergePlannerFilterStateIntoUrl,
    parsePlannerFilterState,
    taskChipMatchesPlannerFilters,
    type PlannerFilterState,
} from "./planner-filter-state";

const EMPTY_RANGE: PlannedDateRange = { plannedStartAt: null, plannedEndAt: null };

type TaskOccurrence = {
    memberId: string;
    datePart: string;
    chip: PlannerTaskChip;
};

type ContextMenuState = {
    x: number;
    y: number;
    taskId: string;
    memberId: string;
    datePart: string;
};

type ActionState =
    | {
          kind: "reassign";
          x: number;
          y: number;
          taskId: string;
          memberId: string;
      }
    | {
          kind: "reschedule";
          x: number;
          y: number;
          taskId: string;
          memberId: string;
          datePart: string;
      };

type QuickAddState = {
    memberId: string;
    datePart: string;
    title: string;
    hours: string;
    projectId: string;
    saving: boolean;
};

type PlannerInsight = {
    headline: string;
    recommendations: string[];
    rebalance: string;
};

function roundHours(value: number): number {
    return Math.round(value * 10) / 10;
}

function emptyMemberDay(datePart: string): PlannerMemberDay {
    return {
        datePart,
        capacityHours: 0,
        allocatedHours: 0,
        availableHours: 0,
        utilizationPercent: null,
        isTimeOff: false,
        isWeekend: false,
        taskChips: [],
    };
}

function adjustDay(day: PlannerMemberDay, deltaHours: number): PlannerMemberDay {
    const allocatedHours = Math.max(0, roundHours(day.allocatedHours + deltaHours));
    return {
        ...day,
        allocatedHours,
        availableHours: Math.max(0, roundHours(day.capacityHours - allocatedHours)),
        utilizationPercent: day.capacityHours > 0
            ? roundHours((allocatedHours / day.capacityHours) * 100)
            : null,
    };
}

function clonePlannerData(data: PlannerApiPayload): PlannerApiPayload {
    return {
        ...data,
        members: data.members.map((member) => ({
            ...member,
            days: member.days.map((day) => ({
                ...day,
                taskChips: day.taskChips.map((chip) => ({ ...chip })),
            })),
        })),
        projectAxis: data.projectAxis.map((project) => ({
            ...project,
            days: project.days.map((day) => ({ ...day })),
        })),
        teamTotal: {
            ...data.teamTotal,
            days: data.teamTotal.days.map((day) => ({ ...day })),
        },
        backlog: data.backlog.map((task) => ({ ...task })),
    };
}

function taskOccurrences(data: PlannerApiPayload, taskId: string, memberId?: string): TaskOccurrence[] {
    const occurrences: TaskOccurrence[] = [];
    for (const member of data.members) {
        if (memberId && member.id !== memberId) continue;
        for (const day of member.days) {
            for (const chip of day.taskChips) {
                if (chip.taskId === taskId) occurrences.push({ memberId: member.id, datePart: day.datePart, chip });
            }
        }
    }
    return occurrences;
}

function removeTaskFromMembers(data: PlannerApiPayload, taskId: string, memberId?: string): number {
    let removedHours = 0;
    data.members = data.members.map((member) => {
        if (memberId && member.id !== memberId) return member;
        return {
            ...member,
            days: member.days.map((day) => {
                const removed = day.taskChips
                    .filter((chip) => chip.taskId === taskId)
                    .reduce((sum, chip) => sum + chip.hours, 0);
                if (removed === 0) return day;
                removedHours += removed;
                return {
                    ...adjustDay(day, -removed),
                    taskChips: day.taskChips.filter((chip) => chip.taskId !== taskId),
                };
            }),
        };
    });
    return removedHours;
}

function addTaskToMemberDay(
    data: PlannerApiPayload,
    memberId: string,
    datePart: string,
    chip: PlannerTaskChip,
    hours: number,
): void {
    data.members = data.members.map((member) => {
        if (member.id !== memberId) return member;
        return {
            ...member,
            days: member.days.map((day) => {
                if (day.datePart !== datePart) return day;
                return {
                    ...adjustDay(day, hours),
                    taskChips: [...day.taskChips, { ...chip, hours: roundHours(hours) }],
                };
            }),
        };
    });
}

function recalculateTotals(data: PlannerApiPayload): PlannerApiPayload {
    const next = data;
    next.teamTotal = {
        ...next.teamTotal,
        days: next.teamTotal.days.map((teamDay) => {
            let allocatedHours = 0;
            let capacityHours = 0;
            for (const member of next.members) {
                const day = member.days.find((candidate) => candidate.datePart === teamDay.datePart);
                if (!day) continue;
                allocatedHours += day.allocatedHours;
                capacityHours += day.capacityHours;
            }
            return {
                ...teamDay,
                allocatedHours: roundHours(allocatedHours),
                capacityHours: roundHours(capacityHours),
                availableHours: Math.max(0, roundHours(capacityHours - allocatedHours)),
                utilizationPercent: capacityHours > 0 ? roundHours((allocatedHours / capacityHours) * 100) : null,
            };
        }),
    };
    const totalAllocated = next.teamTotal.days.reduce((sum, day) => sum + day.allocatedHours, 0);
    const totalCapacity = next.teamTotal.days.reduce((sum, day) => sum + (day.capacityHours ?? 0), 0);
    next.teamTotal.periodUtilizationPercent = totalCapacity > 0
        ? roundHours((totalAllocated / totalCapacity) * 100)
        : null;

    const projectHours = new Map<string, Map<string, number>>();
    for (const member of next.members) {
        for (const day of member.days) {
            for (const chip of day.taskChips) {
                const projectId = chip.projectId ?? "__unassigned__";
                const byDate = projectHours.get(projectId) ?? new Map<string, number>();
                byDate.set(day.datePart, roundHours((byDate.get(day.datePart) ?? 0) + chip.hours));
                projectHours.set(projectId, byDate);
            }
        }
    }
    next.projectAxis = next.projectAxis.map((project) => {
        const byDate = projectHours.get(project.projectId);
        if (!byDate) return project;
        return {
            ...project,
            days: project.days.map((day) => ({
                ...day,
                allocatedHours: roundHours(byDate.get(day.datePart) ?? 0),
            })),
        };
    });
    return next;
}

function moveTaskOptimistically(
    data: PlannerApiPayload,
    drag: PlannerTaskDragData,
    target: PlannerDropTarget,
): PlannerApiPayload {
    if (target.type === "member" && target.memberId === drag.sourceMemberId) return data;
    if (target.type === "cell" && target.memberId === drag.sourceMemberId && target.datePart === drag.sourceDate) return data;

    const sourceOccurrences = taskOccurrences(data, drag.taskId, drag.sourceMemberId);
    const next = clonePlannerData(data);

    if (target.type === "cell" && target.memberId === drag.sourceMemberId) {
        const deltaDays = calendarDayDelta(drag.sourceDate, target.datePart);
        removeTaskFromMembers(next, drag.taskId, drag.sourceMemberId);
        for (const occurrence of sourceOccurrences) {
            addTaskToMemberDay(next, occurrence.memberId, shiftDatePartInternal(occurrence.datePart, deltaDays), occurrence.chip, occurrence.chip.hours);
        }
        return recalculateTotals(next);
    }

    removeTaskFromMembers(next, drag.taskId);
    const hours = sourceOccurrences.reduce((sum, occurrence) => sum + occurrence.chip.hours, 0) || drag.chip.hours;
    const targetDate = target.type === "cell" ? target.datePart : drag.sourceDate;
    addTaskToMemberDay(next, target.memberId, targetDate, drag.chip, hours);
    return recalculateTotals(next);
}

function resizeEstimateOptimistically(data: PlannerApiPayload, taskId: string, nextHours: number): PlannerApiPayload {
    const occurrences = taskOccurrences(data, taskId);
    const currentHours = occurrences.reduce((sum, occurrence) => sum + occurrence.chip.hours, 0);
    if (occurrences.length === 0 || currentHours <= 0) return data;

    const next = clonePlannerData(data);
    next.members = next.members.map((member) => ({
        ...member,
        days: member.days.map((day) => {
            let delta = 0;
            const taskChips = day.taskChips.map((chip) => {
                if (chip.taskId !== taskId) return chip;
                const hours = roundHours((chip.hours / currentHours) * nextHours);
                delta += hours - chip.hours;
                return { ...chip, hours };
            });
            return delta === 0 ? day : { ...adjustDay(day, delta), taskChips };
        }),
    }));
    return recalculateTotals(next);
}

function resizeDatesOptimistically(data: PlannerApiPayload, request: Extract<PlannerResizeRequest, { kind: "date" }>): PlannerApiPayload {
    const occurrences = taskOccurrences(data, request.taskId);
    if (occurrences.length === 0) return data;
    const oldDate = request.edge === "start"
        ? occurrences.map((occurrence) => occurrence.datePart).sort()[0]
        : occurrences.map((occurrence) => occurrence.datePart).sort().at(-1);
    const nextDate = request.edge === "start"
        ? (request.range.plannedStartAt ? datePartFromIso(request.range.plannedStartAt) : null)
        : (request.range.plannedEndAt ? datePartFromIso(request.range.plannedEndAt) : null);
    if (!oldDate || !nextDate || oldDate === nextDate) return data;

    const next = clonePlannerData(data);
    removeTaskFromMembers(next, request.taskId);
    for (const occurrence of occurrences) {
        addTaskToMemberDay(
            next,
            occurrence.memberId,
            occurrence.datePart === oldDate ? nextDate : occurrence.datePart,
            occurrence.chip,
            occurrence.chip.hours,
        );
    }
    return recalculateTotals(next);
}

function dragDataForTask(data: PlannerApiPayload, taskId: string, memberId: string, datePart: string): PlannerTaskDragData | null {
    const chip = taskOccurrences(data, taskId, memberId).find((occurrence) => occurrence.datePart === datePart)?.chip
        ?? taskOccurrences(data, taskId).find((occurrence) => occurrence.datePart === datePart)?.chip;
    if (!chip) return null;
    return { type: "task", taskId, sourceMemberId: memberId, sourceDate: datePart, chip };
}

function buildProjectRows(data: PlannerApiPayload): PlannerProjectDisplayRow[] {
    const rows = new Map<string, PlannerProjectDisplayRow>();
    for (const project of data.projectAxis) {
        const projectId = project.projectId || "__unassigned__";
        rows.set(projectId, {
            projectId,
            projectName: project.projectName ?? project.name ?? "Unassigned project",
            days: project.days.map((day) => ({ ...day })),
            chipsByDate: {},
        });
    }

    for (const member of data.members) {
        for (const day of member.days) {
            for (const chip of day.taskChips) {
                const projectId = chip.projectId ?? "__unassigned__";
                const row = rows.get(projectId) ?? {
                    projectId,
                    projectName: chip.projectName ?? "Unassigned project",
                    days: [],
                    chipsByDate: {},
                };
                const projectChip: PlannerProjectTaskChip = {
                    ...chip,
                    memberId: member.id,
                    memberName: member.name,
                    memberImage: member.image,
                };
                row.chipsByDate[day.datePart] = [...(row.chipsByDate[day.datePart] ?? []), projectChip];
                if (!rows.has(projectId)) rows.set(projectId, row);
            }
        }
    }

    for (const row of Array.from(rows.values())) {
        if (row.days.length > 0) continue;
        const byDate = new Map<string, number>();
        for (const [datePart, chips] of Object.entries(row.chipsByDate)) {
            byDate.set(datePart, chips.reduce((sum, chip) => sum + chip.hours, 0));
        }
        row.days = Array.from(byDate.entries()).map(([datePart, allocatedHours]) => ({ datePart, allocatedHours }));
    }

    return Array.from(rows.values()).sort((left, right) => left.projectName.localeCompare(right.projectName));
}

function shiftDatePartInternal(datePart: string, deltaDays: number): string {
    const date = new Date(`${datePart}T12:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return date.toISOString().slice(0, 10);
}

function getDateColumns(range: PlannerRange, anchor: string): PlannerDateColumn[] {
    if (range === "month") return [];
    return datePartsForRange(range, anchor).map((datePart) => ({
        datePart,
        label: formatDateLabel(datePart),
        weekday: formatWeekday(datePart),
        isWeekend: new Date(`${datePart}T12:00:00Z`).getUTCDay() >= 5,
    }));
}

function hasTaskFilterFields(filters: PlannerFilterState): boolean {
    return filters.projectIds.length > 0
        || filters.statuses.length > 0
        || filters.priorities.length > 0;
}

function filterMemberTasks(member: PlannerMember, filters: PlannerFilterState): PlannerMember {
    if (!hasTaskFilterFields(filters)) return member;
    const days = member.days.map((day) => {
        const taskChips = day.taskChips.filter((chip) => taskChipMatchesPlannerFilters(chip, filters));
        const allocatedHours = roundHours(taskChips.reduce((sum, chip) => sum + chip.hours, 0));
        return {
            ...day,
            taskChips,
            allocatedHours,
            availableHours: Math.max(0, roundHours(day.capacityHours - allocatedHours)),
            utilizationPercent: day.capacityHours > 0
                ? roundHours((allocatedHours / day.capacityHours) * 100)
                : null,
        };
    });
    const allocatedHours = days.reduce((sum, day) => sum + day.allocatedHours, 0);
    const capacityHours = days.reduce((sum, day) => sum + day.capacityHours, 0);
    const periodUtilizationPercent = capacityHours > 0
        ? roundHours((allocatedHours / capacityHours) * 100)
        : null;
    const state: PlannerMember["state"] = periodUtilizationPercent != null && periodUtilizationPercent > 100
        ? "overloaded"
        : periodUtilizationPercent != null && periodUtilizationPercent >= 80
            ? "booked"
            : "available";
    return { ...member, days, periodUtilizationPercent, state };
}

function filterPlannerData(data: PlannerApiPayload, filters: PlannerFilterState): PlannerApiPayload {
    if (!hasPlannerFilters(filters)) return data;
    const next = clonePlannerData(data);
    next.members = next.members
        .map((member) => filterMemberTasks(member, filters))
        .filter((member) => memberMatchesPlannerFilters(member, filters));
    next.projectAxis = next.projectAxis.filter((project) => next.members.some((member) => member.days.some((day) => (
        day.taskChips.some((chip) => chip.projectId === project.projectId)
    ))));
    if (filters.projectIds.length > 0) {
        next.backlog = next.backlog.filter((task) => task.projectId != null && filters.projectIds.includes(task.projectId));
    }
    return recalculateTotals(next);
}

async function errorMessage(response: Response): Promise<string> {
    try {
        const body = await response.json() as { error?: unknown };
        if (typeof body.error === "string") return body.error;
    } catch {
        // Fall through to the status text for non-JSON errors.
    }
    return response.statusText || `Request failed (${response.status})`;
}

export function Planner() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const router = useRouter();
    const { toast } = useToast();
    const filters = useMemo(() => parsePlannerFilterState(searchParams), [searchParams]);
    const [settings, setSettings] = useState<PlannerSettings>(DEFAULT_PLANNER_SETTINGS);
    const [settingsReady, setSettingsReady] = useState(false);
    const [knownMemberOptions, setKnownMemberOptions] = useState<PlannerFilterOption[]>([]);
    const [knownProjectOptions, setKnownProjectOptions] = useState<PlannerFilterOption[]>([]);
    const [range, setRange] = useState<PlannerRange>("week");
    const [anchor, setAnchor] = useState(() => todayDatePart());
    const [data, setData] = useState<PlannerApiPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshToken, setRefreshToken] = useState(0);
    const [axis, setAxis] = useState<"members" | "projects">("members");
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const contextMenuFirstItemRef = useRef<HTMLButtonElement | null>(null);
    const [action, setAction] = useState<ActionState | null>(null);
    const [actionValue, setActionValue] = useState("");
    const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
    const [insightOpen, setInsightOpen] = useState(false);
    const [insight, setInsight] = useState<PlannerInsight | null>(null);
    const [insightLoading, setInsightLoading] = useState(false);
    const [insightError, setInsightError] = useState<string | null>(null);

    const plannerWindow = useMemo(() => rangeWindow(range, anchor), [range, anchor]);
    const dateColumns = useMemo(
        () => getDateColumns(range, anchor).filter((column) => settings.showWeekends || !column.isWeekend),
        [anchor, range, settings.showWeekends],
    );
    const filteredData = useMemo(
        () => (data ? filterPlannerData(data, filters) : null),
        [data, filters],
    );
    const projectRows = useMemo(() => (filteredData ? buildProjectRows(filteredData) : []), [filteredData]);
    const taskMeta = useMemo(() => {
        const estimates = new Map<string, number>();
        const dates = new Map<string, string[]>();
        if (!data) return { estimates, ranges: new Map<string, PlannedDateRange>() };
        for (const member of data.members) {
            for (const day of member.days) {
                for (const chip of day.taskChips) {
                    estimates.set(chip.taskId, (estimates.get(chip.taskId) ?? 0) + chip.hours);
                    const existing = dates.get(chip.taskId) ?? [];
                    existing.push(day.datePart);
                    dates.set(chip.taskId, existing);
                }
            }
        }
        const ranges = new Map<string, PlannedDateRange>();
        for (const [taskId, taskDates] of Array.from(dates.entries())) {
            const sorted = taskDates.slice().sort();
            const lastDate = sorted[sorted.length - 1];
            ranges.set(taskId, {
                ...dayBounds(sorted[0]),
                plannedEndAt: dayBounds(lastDate).plannedEndAt,
            });
        }
        return { estimates, ranges };
    }, [data]);

    const getTaskEstimateHours = useCallback(
        (taskId: string) => Math.max(0.5, taskMeta.estimates.get(taskId) ?? 0.5),
        [taskMeta.estimates],
    );
    const getTaskPlannedRange = useCallback(
        (taskId: string) => taskMeta.ranges.get(taskId) ?? EMPTY_RANGE,
        [taskMeta.ranges],
    );

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem("planner-settings");
            if (stored) setSettings(normalizePlannerSettings(JSON.parse(stored) as unknown));
        } catch {
            // Ignore malformed or unavailable local settings and keep defaults.
        }
        setSettingsReady(true);
    }, []);

    useEffect(() => {
        if (!settingsReady) return;
        window.localStorage.setItem("planner-settings", JSON.stringify(settings));
    }, [settings, settingsReady]);

    useEffect(() => {
        if (!data) return;
        setKnownMemberOptions((current) => {
            const next = new Map<string, PlannerFilterOption>();
            for (const option of current) next.set(option.value, option);
            for (const member of data.members) next.set(member.id, { value: member.id, label: member.name });
            return Array.from(next.values()).sort((left, right) => left.label.localeCompare(right.label));
        });
        setKnownProjectOptions((current) => {
            const next = new Map<string, PlannerFilterOption>();
            for (const option of current) next.set(option.value, option);
            for (const project of data.projectAxis) {
                const label = project.projectName ?? project.name ?? project.projectId;
                next.set(project.projectId, { value: project.projectId, label });
            }
            return Array.from(next.values()).sort((left, right) => left.label.localeCompare(right.label));
        });
    }, [data]);

    const plannerRequestUrl = useMemo(() => {
        const params = new URLSearchParams();
        params.set("from", plannerWindow.from);
        params.set("to", plannerWindow.to);
        if (filters.memberIds.length > 0) params.set("memberIds", filters.memberIds.join(","));
        if (filters.projectIds.length > 0) params.set("projectIds", filters.projectIds.join(","));
        params.set("weekDays", settings.workingDays.join(","));
        params.set("dailyHours", String(settings.dailyHours));
        return `/api/planner?${params.toString()}`;
    }, [
        filters.memberIds,
        filters.projectIds,
        plannerWindow.from,
        plannerWindow.to,
        settings.dailyHours,
        settings.workingDays,
    ]);

    const updateFilters = useCallback((nextFilters: PlannerFilterState) => {
        const query = mergePlannerFilterStateIntoUrl(searchParams, nextFilters);
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [pathname, router, searchParams]);

    useEffect(() => {
        if (!settingsReady) return;
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        fetch(plannerRequestUrl, {
            signal: controller.signal,
            cache: "no-store",
        })
            .then(async (response) => {
                if (!response.ok) throw new Error(await errorMessage(response));
                return response.json() as Promise<PlannerApiPayload>;
            })
            .then((payload) => setData(payload))
            .catch((requestError: unknown) => {
                if (requestError instanceof DOMException && requestError.name === "AbortError") return;
                setError(requestError instanceof Error ? requestError.message : "Failed to load planner");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [refreshToken, plannerRequestUrl, settingsReady]);

    useEffect(() => {
        if (!contextMenu) return;
        const close = () => setContextMenu(null);
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [contextMenu]);

    useEffect(() => {
        if (contextMenu) contextMenuFirstItemRef.current?.focus();
    }, [contextMenu]);

    const patchTask = useCallback(async (taskId: string, body: Record<string, unknown>) => {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) throw new Error(await errorMessage(response));
    }, []);

    const commitMutation = useCallback(async (
        previous: PlannerApiPayload,
        next: PlannerApiPayload,
        taskId: string,
        body: Record<string, unknown>,
        successTitle: string,
    ) => {
        setData(next);
        try {
            await patchTask(taskId, body);
            toast({ title: successTitle });
        } catch (mutationError) {
            setData(previous);
            toast({
                title: "Planner update failed",
                description: mutationError instanceof Error ? mutationError.message : "The change was rolled back.",
                variant: "destructive",
            });
        }
    }, [patchTask, toast]);

    const handleDrop = useCallback((drag: PlannerTaskDragData, target: PlannerDropTarget) => {
        if (!data) return;
        const previous = data;
        const sourceRange = taskMeta.ranges.get(drag.taskId) ?? EMPTY_RANGE;
        let body: Record<string, unknown>;
        let next: PlannerApiPayload;
        let successTitle: string;

        if (target.type === "cell" && target.memberId === drag.sourceMemberId) {
            const deltaDays = calendarDayDelta(drag.sourceDate, target.datePart);
            if (deltaDays === 0) return;
            body = shiftPlannedDateRange(sourceRange, deltaDays);
            next = moveTaskOptimistically(data, drag, target);
            successTitle = "Task rescheduled";
        } else if (target.type === "cell") {
            const deltaDays = calendarDayDelta(drag.sourceDate, target.datePart);
            body = {
                assigneeIds: [target.memberId],
                ...shiftPlannedDateRange(sourceRange, deltaDays),
            };
            next = moveTaskOptimistically(data, drag, target);
            successTitle = "Task reassigned and rescheduled";
        } else {
            body = { assigneeIds: [target.memberId] };
            next = moveTaskOptimistically(data, drag, target);
            successTitle = "Task reassigned";
        }
        void commitMutation(previous, next, drag.taskId, body, successTitle);
    }, [commitMutation, data, taskMeta.ranges]);

    const handleResize = useCallback((request: PlannerResizeRequest) => {
        if (!data) return;
        const previous = data;
        if (request.kind === "estimate") {
            const hours = clampEstimateHours(request.hours);
            const next = resizeEstimateOptimistically(data, request.taskId, hours);
            void commitMutation(previous, next, request.taskId, { estimateMinutes: Math.round(hours * 60) }, "Estimate updated");
            return;
        }
        const next = resizeDatesOptimistically(data, request);
        void commitMutation(
            previous,
            next,
            request.taskId,
            request.range,
            `${request.edge === "start" ? "Start" : "End"} date updated`,
        );
    }, [commitMutation, data]);

    const openContextMenu = useCallback((event: React.MouseEvent, taskId: string, memberId: string, datePart: string) => {
        event.preventDefault();
        event.stopPropagation();
        setAction(null);
        setContextMenu({
            x: event.clientX,
            y: event.clientY,
            taskId,
            memberId,
            datePart,
        });
    }, []);

    const openQuickAdd = useCallback((memberId: string, datePart: string) => {
        setContextMenu(null);
        setAction(null);
        setQuickAdd({ memberId, datePart, title: "", hours: "1", projectId: "", saving: false });
    }, []);

    function openTask(taskId: string) {
        router.push(`/tasks?task=${encodeURIComponent(taskId)}`);
    }

    function removeFromPlan(taskId: string) {
        if (!data) return;
        const previous = data;
        const next = clonePlannerData(data);
        removeTaskFromMembers(next, taskId);
        void commitMutation(previous, recalculateTotals(next), taskId, {
            plannedStartAt: null,
            plannedEndAt: null,
        }, "Task removed from plan");
    }

    function submitReassign(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!action || action.kind !== "reassign" || !actionValue || !data) return;
        const drag = dragDataForTask(data, action.taskId, action.memberId, contextMenu?.datePart ?? "")
            ?? taskOccurrences(data, action.taskId).map((occurrence) => ({
                type: "task" as const,
                taskId: action.taskId,
                sourceMemberId: occurrence.memberId,
                sourceDate: occurrence.datePart,
                chip: occurrence.chip,
            }))[0];
        if (!drag) return;
        const previous = data;
        const next = moveTaskOptimistically(data, drag, { type: "member", memberId: actionValue });
        void commitMutation(previous, next, action.taskId, { assigneeIds: [actionValue] }, "Task reassigned");
        setAction(null);
    }

    function submitReschedule(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!action || action.kind !== "reschedule" || !actionValue || !data) return;
        const drag = dragDataForTask(data, action.taskId, action.memberId, action.datePart);
        if (!drag) return;
        const deltaDays = calendarDayDelta(action.datePart, actionValue);
        if (deltaDays === 0) {
            setAction(null);
            return;
        }
        const previous = data;
        const sourceRange = taskMeta.ranges.get(action.taskId) ?? EMPTY_RANGE;
        const next = moveTaskOptimistically(data, drag, { type: "cell", memberId: drag.sourceMemberId, datePart: actionValue });
        void commitMutation(previous, next, action.taskId, shiftPlannedDateRange(sourceRange, deltaDays), "Task rescheduled");
        setAction(null);
    }

    async function submitQuickAdd(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!quickAdd || !quickAdd.title.trim()) return;
        const hours = clampEstimateHours(Number(quickAdd.hours));
        const bounds = dayBounds(quickAdd.datePart);
        setQuickAdd({ ...quickAdd, saving: true, hours: String(hours) });
        try {
            const response = await fetch("/api/tasks", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: quickAdd.title.trim(),
                    status: "TODO",
                    priority: "MEDIUM",
                    effortHours: hours,
                    assigneeIds: [quickAdd.memberId],
                    ...(quickAdd.projectId ? { projectId: quickAdd.projectId } : {}),
                    startAt: bounds.plannedStartAt,
                    dueAt: bounds.plannedEndAt,
                }),
            });
            if (!response.ok) throw new Error(await errorMessage(response));
            const created = await response.json() as { id?: unknown; task?: { id?: unknown } };
            const taskId = typeof created.id === "string"
                ? created.id
                : typeof created.task?.id === "string" ? created.task.id : null;
            if (!taskId) throw new Error("Task was created without an id");
            await patchTask(taskId, {
                estimateMinutes: Math.round(hours * 60),
                plannedStartAt: bounds.plannedStartAt,
                plannedEndAt: bounds.plannedEndAt,
            });
            setQuickAdd(null);
            setRefreshToken((token) => token + 1);
            toast({ title: "Task added to plan" });
        } catch (creationError) {
            setQuickAdd({ ...quickAdd, saving: false });
            toast({
                title: "Could not add task",
                description: creationError instanceof Error ? creationError.message : "Try again.",
                variant: "destructive",
            });
        }
    }

    const hasPlannedTasks = Boolean(filteredData?.members.some((member) => member.days.some((day) => day.taskChips.length > 0)));
    const projectOptions = knownProjectOptions.map(({ value, label }) => [value, label] as [string, string]);

    return (
        <div className="space-y-5">
            <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <h1 className="text-2xl font-bold tracking-tight">Workload Planner</h1>
                        {data && data.unknownEffortCount > 0 && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                                {data.unknownEffortCount} unestimated · {settings.defaultEstimateHours.toFixed(1)}h display
                            </span>
                        )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">Plan capacity across people, projects, and working days.</p>
                </div>
                <div className="flex min-w-0 w-full flex-wrap items-center gap-2 sm:w-auto">
                    <RangeNav
                        range={range}
                        label={plannerWindow.label}
                        loading={loading}
                        onRangeChange={(nextRange) => {
                            setRange(nextRange);
                            if (nextRange === "day") setAnchor((current) => datePartsForRange("day", current)[0]);
                        }}
                        onNavigate={(direction) => setAnchor((current) => navigateAnchor(range, current, direction))}
                        onToday={() => setAnchor(todayDatePart())}
                        onRefresh={() => setRefreshToken((token) => token + 1)}
                    />
                    <PlannerSettingsDrawer settings={settings} onChange={setSettings} />
                </div>
            </div>

            <div className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div className="flex min-h-11 items-center gap-1 rounded-full bg-background p-1" role="group" aria-label="Planner axis">
                        <button
                            type="button"
                            aria-pressed={axis === "members"}
                            onClick={() => setAxis("members")}
                            className={`min-h-11 rounded-full px-3 py-1.5 text-xs font-medium transition ${axis === "members" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
                        >
                            <UserRound className="mr-1.5 inline h-3.5 w-3.5" />
                            Members
                        </button>
                        <button
                            type="button"
                            aria-pressed={axis === "projects"}
                            onClick={() => setAxis("projects")}
                            className={`min-h-11 rounded-full px-3 py-1.5 text-xs font-medium transition ${axis === "projects" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
                        >
                            <FolderKanban className="mr-1.5 inline h-3.5 w-3.5" />
                            Projects
                        </button>
                    </div>
                    <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
                        <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0">Drag chips to reschedule or reassign. Click an empty cell to add.</span>
                        {range === "month" && <span className="hidden shrink-0 rounded bg-muted px-2 py-1 sm:inline">Month shows meters only</span>}
                    </div>
                </div>
                <PlannerFilters
                    filters={filters}
                    memberOptions={knownMemberOptions}
                    projectOptions={knownProjectOptions}
                    onChange={updateFilters}
                />
            </div>

            {loading && !data && (
                <div className="flex min-h-[280px] items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading planner…
                </div>
            )}

            {error && !data && (
                <div className="flex min-h-[280px] flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
                    <AlertTriangle className="mb-3 h-8 w-8 text-destructive" />
                    <h2 className="font-semibold">Planner could not load</h2>
                    <p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
                    <Button type="button" variant="outline" className="mt-4" onClick={() => setRefreshToken((token) => token + 1)}>Try again</Button>
                </div>
            )}

            {filteredData && (
                <>
                    {!hasPlannedTasks && (
                        <div className="flex items-start gap-3 rounded-lg border border-dashed bg-card p-4 text-sm">
                            <Plus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            <div>
                                <div className="font-medium">No planned work in this range</div>
                                <div className="text-muted-foreground">Choose a member and click an empty day to create the first planned task.</div>
                            </div>
                        </div>
                    )}
                    <Grid
                        data={filteredData}
                        range={range}
                        dateColumns={dateColumns}
                        projectRows={projectRows}
                        getTaskEstimateHours={getTaskEstimateHours}
                        getTaskPlannedRange={getTaskPlannedRange}
                        onEmptyCell={openQuickAdd}
                        onTaskContextMenu={openContextMenu}
                        onDrop={handleDrop}
                        onResize={handleResize}
                    />

                    {filteredData.backlog.length > 0 && (
                        <section className="rounded-xl border bg-card p-4 shadow-sm">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                    <h2 className="font-semibold">Unscheduled backlog</h2>
                                    <p className="text-xs text-muted-foreground">Open tasks without a planned date.</p>
                                </div>
                                <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">{filteredData.backlog.length}</span>
                            </div>
                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {filteredData.backlog.slice(0, 12).map((task) => (
                                    <div key={task.taskId} className="rounded-lg border p-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{task.taskKey ?? "Unkeyed"}</div>
                                                <div className="truncate text-sm font-medium">{task.title}</div>
                                            </div>
                                            {task.hours != null && <span className="shrink-0 text-xs text-muted-foreground">{task.hours.toFixed(1)}h</span>}
                                        </div>
                                        <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">{task.reason}</div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    )}
                </>
            )}

            {contextMenu && data && (
                <div
                    role="menu"
                    aria-label="Task actions"
                    className="fixed z-[70] w-56 rounded-lg border bg-popover p-1.5 text-sm shadow-xl"
                    style={{
                        left: Math.max(8, Math.min(Math.max(globalThis.window.innerWidth - 224, 8), contextMenu.x)),
                        top: Math.max(8, Math.min(Math.max(globalThis.window.innerHeight - 220, 8), contextMenu.y)),
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            setContextMenu(null);
                        }
                    }}
                >
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Task actions</div>
                    <button
                        ref={contextMenuFirstItemRef}
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent"
                        onClick={() => {
                            setAction({ kind: "reassign", x: contextMenu.x, y: contextMenu.y, taskId: contextMenu.taskId, memberId: contextMenu.memberId });
                            setActionValue(contextMenu.memberId);
                            setContextMenu(null);
                        }}
                    >
                        <UserRound className="h-4 w-4" /> Reassign…
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent"
                        onClick={() => {
                            setAction({ kind: "reschedule", x: contextMenu.x, y: contextMenu.y, taskId: contextMenu.taskId, memberId: contextMenu.memberId, datePart: contextMenu.datePart });
                            setActionValue(contextMenu.datePart);
                            setContextMenu(null);
                        }}
                    >
                        <Clock3 className="h-4 w-4" /> Reschedule…
                    </button>
                    <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-2 text-left hover:bg-accent" onClick={() => openTask(contextMenu.taskId)}>
                        <MoreHorizontal className="h-4 w-4" /> Open task
                    </button>
                    <div className="my-1 border-t" />
                    <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-destructive hover:bg-destructive/10"
                        onClick={() => {
                            const taskId = contextMenu.taskId;
                            setContextMenu(null);
                            removeFromPlan(taskId);
                        }}
                    >
                        <X className="h-4 w-4" /> Remove from plan
                    </button>
                </div>
            )}

            {action && data && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={action.kind === "reassign" ? "Reassign task" : "Reschedule task"}
                    className="fixed z-[70] w-72 rounded-xl border bg-popover p-4 shadow-xl"
                    style={{
                        left: Math.max(8, Math.min(Math.max(globalThis.window.innerWidth - 304, 8), action.x)),
                        top: Math.max(8, Math.min(Math.max(globalThis.window.innerHeight - 250, 8), action.y)),
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            setAction(null);
                        }
                    }}
                >
                    <div className="mb-3 flex items-center justify-between">
                        <h2 className="font-semibold">{action.kind === "reassign" ? "Reassign task" : "Reschedule task"}</h2>
                        <button type="button" aria-label="Close" onClick={() => setAction(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                    </div>
                    {action.kind === "reassign" ? (
                        <form className="space-y-3" onSubmit={submitReassign}>
                            <label className="block text-xs font-medium" htmlFor="planner-reassign-member">Member</label>
                            <select id="planner-reassign-member" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={actionValue} onChange={(event) => setActionValue(event.target.value)}>
                                {data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                            </select>
                            <Button type="submit" size="sm" className="w-full"><Check className="mr-1.5 h-4 w-4" />Save assignment</Button>
                        </form>
                    ) : (
                        <form className="space-y-3" onSubmit={submitReschedule}>
                            <label className="block text-xs font-medium" htmlFor="planner-reschedule-date">Planned day</label>
                            <input id="planner-reschedule-date" type="date" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={actionValue} onChange={(event) => setActionValue(event.target.value)} />
                            <Button type="submit" size="sm" className="w-full"><Check className="mr-1.5 h-4 w-4" />Save dates</Button>
                        </form>
                    )}
                </div>
            )}

            {quickAdd && data && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-label="Add task to plan"
                    className="fixed inset-0 z-[65] flex items-start justify-center bg-black/10 p-4 pt-[12vh]"
                    onMouseDown={() => !quickAdd.saving && setQuickAdd(null)}
                    onKeyDown={(event) => {
                        if (event.key === "Escape" && !quickAdd.saving) {
                            event.preventDefault();
                            setQuickAdd(null);
                        }
                    }}
                >
                    <form
                        className="w-full max-w-md rounded-xl border bg-popover p-5 shadow-2xl"
                        onSubmit={submitQuickAdd}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h2 className="font-semibold">Add task to plan</h2>
                                <p className="text-xs text-muted-foreground">{data.members.find((member) => member.id === quickAdd.memberId)?.name ?? "Member"} · {formatDateLabel(quickAdd.datePart)}</p>
                            </div>
                            <button type="button" aria-label="Close" disabled={quickAdd.saving} onClick={() => setQuickAdd(null)}><X className="h-4 w-4 text-muted-foreground" /></button>
                        </div>
                        <div className="space-y-3">
                            <label className="block text-xs font-medium" htmlFor="planner-quick-add-title">Title</label>
                            <input id="planner-quick-add-title" autoFocus required value={quickAdd.title} onChange={(event) => setQuickAdd({ ...quickAdd, title: event.target.value })} placeholder="What needs to be done?" className="h-10 w-full rounded-md border bg-background px-3 text-sm" />
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium" htmlFor="planner-quick-add-hours">Estimate (hours)</label>
                                    <input id="planner-quick-add-hours" type="number" min="0.5" max="24" step="0.5" value={quickAdd.hours} onChange={(event) => setQuickAdd({ ...quickAdd, hours: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium" htmlFor="planner-quick-add-project">Project</label>
                                    <select id="planner-quick-add-project" value={quickAdd.projectId} onChange={(event) => setQuickAdd({ ...quickAdd, projectId: event.target.value })} className="mt-1 h-10 w-full rounded-md border bg-background px-2 text-sm">
                                        <option value="">No project</option>
                                        {projectOptions.map(([projectId, projectName]) => <option key={projectId} value={projectId}>{projectName}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Assignee is pre-filled from the selected member row.</div>
                        </div>
                        <div className="mt-5 flex justify-end gap-2">
                            <Button type="button" variant="outline" disabled={quickAdd.saving} onClick={() => setQuickAdd(null)}>Cancel</Button>
                            <Button type="submit" disabled={quickAdd.saving || !quickAdd.title.trim()}>
                                {quickAdd.saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}
                                Add to plan
                            </Button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
}

export default Planner;
