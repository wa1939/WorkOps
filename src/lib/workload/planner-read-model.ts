import { fromZonedTime } from "date-fns-tz";
import {
    DEFAULT_TIME_ZONE,
    DEFAULT_WORK_WEEK,
    dateInTimeZone,
    dayCapacity,
    isWorkingDay,
    weekdayOfDatePart,
    type RecurringCommitment,
} from "./calendar";
import { allocateTaskEffort } from "./allocation";
import { scheduleTasks } from "./schedule";
import { summarizeWorkload } from "./summary";

const DEFAULT_CAPACITY_PER_WEEK_HOURS = 35;
const PRESENTATION_BOOKED_THRESHOLD = 80;

export type PlannerDateValue = Date | string;

export type PlannerUser = {
    id: string;
    name: string;
    image?: string | null;
    /** Optional persisted weekly capacity. The application default is 35h. */
    capacityPerWeekHours?: number | null;
    /** Optional per-user override for the calendar's daily capacity. */
    dailyHours?: number | null;
    /** Optional recurring commitments already normalized for the calendar engine. */
    recurring?: readonly RecurringCommitment[];
};

export type PlannerAssignment = {
    userId: string;
    plannedShare?: number | null;
};

export type PlannerTask = {
    id: string;
    taskKey: string | null;
    title: string;
    status: string;
    priority: string;
    estimateMinutes: number | null;
    remainingEffortHours?: number | null;
    plannedStartAt?: PlannerDateValue | null;
    plannedEndAt?: PlannerDateValue | null;
    assignments: readonly PlannerAssignment[];
    projectId?: string | null;
    projectName?: string | null;
};

export type PlannerLeavePeriod = {
    userId: string;
    startAt: PlannerDateValue;
    endAt: PlannerDateValue;
};

export type PlannerTimeLog = {
    userId: string;
    datePart?: string;
    startedAt?: PlannerDateValue;
    minutes: number;
};

export type PlannerTimeLogs =
    | readonly PlannerTimeLog[]
    | Readonly<Record<string, number>>
    | Readonly<Record<string, Readonly<Record<string, number>>>>;

export type PlannerModelInput = {
    rangeStart: PlannerDateValue;
    rangeEnd: PlannerDateValue;
    users: readonly PlannerUser[];
    tasks: readonly PlannerTask[];
    leavePeriods: readonly PlannerLeavePeriod[];
    existingTimeLogs?: PlannerTimeLogs;
    /** Optional calendar overrides; defaults match the existing User model. */
    dailyHours?: number;
    holidays?: readonly string[];
    weekDays?: readonly number[];
    recurring?: readonly RecurringCommitment[];
};

export type PlannerTaskChip = {
    taskId: string;
    taskKey: string | null;
    title: string;
    hours: number;
    projectId: string | null;
    projectName: string | null;
    status: string;
    priority: string;
};

export type PlannerMemberDay = {
    datePart: string;
    capacityHours: number;
    allocatedHours: number;
    availableHours: number;
    utilizationPercent: number | null;
    isTimeOff: boolean;
    isWeekend: boolean;
    taskChips: PlannerTaskChip[];
};

export type PlannerMemberState = "available" | "booked" | "overloaded";

export type PlannerMember = {
    id: string;
    name: string;
    image: string | null;
    days: PlannerMemberDay[];
    periodUtilizationPercent: number | null;
    state: PlannerMemberState;
};

export type PlannerProjectDay = {
    datePart: string;
    allocatedHours: number;
};

export type PlannerLoadMeter = {
    allocatedHours: number;
};

export type PlannerProject = {
    projectId: string;
    name: string;
    days: PlannerProjectDay[];
    loadMeter: PlannerLoadMeter;
};

export type PlannerTeamDay = {
    datePart: string;
    capacityHours: number;
    allocatedHours: number;
    utilizationPercent: number | null;
};

export type PlannerTeamTotal = {
    days: PlannerTeamDay[];
    utilizationPercent: number | null;
};

export type PlannerBacklogReason =
    | "unknown-effort"
    | "unassigned"
    | "member-not-found"
    | "unscheduled"
    | "outside-range"
    | "capacity";

export type PlannerBacklogItem = {
    taskId: string;
    reason: PlannerBacklogReason;
};

export type PlannerModel = {
    members: PlannerMember[];
    projectAxis: PlannerProject[];
    teamTotal: PlannerTeamTotal;
    backlog: PlannerBacklogItem[];
    unknownEffortCount: number;
};

type MutableMemberDay = PlannerMemberDay;

type ProjectAccumulator = {
    projectId: string;
    name: string;
    allocatedByDate: Map<string, number>;
};

type NormalizedTimeLog = {
    userId: string;
    datePart: string;
    minutes: number;
};

function asDate(value: PlannerDateValue): Date | null {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function requireDate(value: PlannerDateValue, label: string): Date {
    const date = asDate(value);
    if (date === null) {
        throw new RangeError(`${label} must be a valid date`);
    }
    return date;
}

function parseDatePart(datePart: string): { year: number; month: number; day: number } {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
    if (!match) throw new RangeError(`Invalid date part: ${datePart}`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const check = new Date(0);
    check.setUTCFullYear(year, month - 1, day);
    check.setUTCHours(0, 0, 0, 0);
    if (
        check.getUTCFullYear() !== year
        || check.getUTCMonth() !== month - 1
        || check.getUTCDate() !== day
    ) {
        throw new RangeError(`Invalid date part: ${datePart}`);
    }
    return { year, month, day };
}

function shiftDatePart(datePart: string, days: number): string {
    const { year, month, day } = parseDatePart(datePart);
    const shifted = new Date(0);
    shifted.setUTCFullYear(year, month - 1, day + days);
    shifted.setUTCHours(12, 0, 0, 0);
    return [
        String(shifted.getUTCFullYear()).padStart(4, "0"),
        String(shifted.getUTCMonth() + 1).padStart(2, "0"),
        String(shifted.getUTCDate()).padStart(2, "0"),
    ].join("-");
}

function datePartsInRange(startAt: Date, endAt: Date): string[] {
    const first = dateInTimeZone(startAt, DEFAULT_TIME_ZONE);
    const last = dateInTimeZone(endAt, DEFAULT_TIME_ZONE);
    const result: string[] = [];
    let current = first;
    while (current <= last) {
        result.push(current);
        if (current === last) break;
        current = shiftDatePart(current, 1);
    }
    return result;
}

function dayBounds(datePart: string): { start: number; end: number } {
    parseDatePart(datePart);
    return {
        start: fromZonedTime(`${datePart}T00:00:00`, DEFAULT_TIME_ZONE).getTime(),
        end: fromZonedTime(`${shiftDatePart(datePart, 1)}T00:00:00`, DEFAULT_TIME_ZONE).getTime(),
    };
}

function intervalCoversDay(startAt: PlannerDateValue, endAt: PlannerDateValue, datePart: string): boolean {
    const start = asDate(startAt);
    const end = asDate(endAt);
    if (start === null || end === null || end.getTime() < start.getTime()) return false;
    const bounds = dayBounds(datePart);
    return start.getTime() < bounds.end && end.getTime() > bounds.start;
}

function isTerminalStatus(status: string): boolean {
    const normalized = status.trim().toLowerCase();
    return normalized === "done"
        || normalized === "completed"
        || normalized === "cancelled"
        || normalized === "canceled"
        || normalized === "closed";
}

function allocationStatus(status: string): string {
    // The shared allocation engine intentionally accepts lower-level status
    // strings. Normalize DepartmentHub's DONE enum to its terminal equivalent.
    return status.trim().toUpperCase() === "DONE" ? "completed" : status;
}

function validateNonnegative(value: number, label: string): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${label} must be finite and nonnegative`);
    }
}

function splitCompositeTimeLogKey(key: string): { userId: string; datePart: string } | null {
    const separator = key.indexOf("|");
    if (separator > 0) {
        const userId = key.slice(0, separator);
        const datePart = key.slice(separator + 1);
        return datePart ? { userId, datePart } : null;
    }
    const dateSeparator = key.lastIndexOf(":");
    if (dateSeparator > 0) {
        const userId = key.slice(0, dateSeparator);
        const datePart = key.slice(dateSeparator + 1);
        return datePart ? { userId, datePart } : null;
    }
    return null;
}

function normalizeTimeLogs(input: PlannerTimeLogs | undefined): NormalizedTimeLog[] {
    if (input === undefined) return [];
    const logs: NormalizedTimeLog[] = [];
    if (Array.isArray(input)) {
        for (const log of input) {
            const datePart = log.datePart
                ?? (log.startedAt === undefined ? undefined : (() => {
                    const startedAt = asDate(log.startedAt);
                    return startedAt === null ? undefined : dateInTimeZone(startedAt, DEFAULT_TIME_ZONE);
                })());
            if (!datePart) throw new RangeError("Time logs must include a valid date part");
            validateNonnegative(log.minutes, "Time log minutes");
            logs.push({ userId: log.userId, datePart, minutes: log.minutes });
        }
        return logs;
    }

    const keyedInput = input as Readonly<Record<string, number | Readonly<Record<string, number>>>>;
    for (const key of Object.keys(keyedInput)) {
        const value = keyedInput[key];
        if (typeof value === "number") {
            const parsed = splitCompositeTimeLogKey(key);
            if (!parsed) throw new RangeError("Time log map keys must be userId|datePart");
            validateNonnegative(value, "Time log minutes");
            logs.push({ ...parsed, minutes: value });
            continue;
        }
        if (value === null || typeof value !== "object") {
            throw new RangeError("Time log map values must be minutes or date maps");
        }
        for (const datePart of Object.keys(value)) {
            const minutes = value[datePart];
            validateNonnegative(minutes, "Time log minutes");
            logs.push({ userId: key, datePart, minutes });
        }
    }
    return logs;
}

function timeLogMinutesByUserDay(logs: readonly NormalizedTimeLog[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const log of logs) {
        const key = `${log.userId}|${log.datePart}`;
        result.set(key, (result.get(key) ?? 0) + log.minutes);
    }
    return result;
}

function percentFor(allocatedHours: number, capacityHours: number): number | null {
    return summarizeWorkload([allocatedHours], capacityHours).percent;
}

function presentationState(
    percent: number | null,
    hasCapacityBacklog: boolean,
): PlannerMemberState {
    if (hasCapacityBacklog) return "overloaded";
    if (percent === null) return "available";
    if (percent > 100) return "overloaded";
    return percent >= PRESENTATION_BOOKED_THRESHOLD ? "booked" : "available";
}

function backlogReasonForSchedule(
    task: PlannerTask,
    rangeStart: number,
    rangeEnd: number,
): PlannerBacklogReason {
    const start = task.plannedStartAt == null ? null : asDate(task.plannedStartAt);
    const end = task.plannedEndAt == null ? null : asDate(task.plannedEndAt);
    if ((task.plannedStartAt != null && start === null) || (task.plannedEndAt != null && end === null)) {
        return "unscheduled";
    }
    if (start === null && end === null) return "unscheduled";
    const startTime = start?.getTime() ?? Number.NEGATIVE_INFINITY;
    const endTime = end?.getTime() ?? Number.POSITIVE_INFINITY;
    return startTime <= rangeEnd && endTime >= rangeStart ? "capacity" : "outside-range";
}

function addBacklog(
    backlogByTask: Map<string, PlannerBacklogReason>,
    taskId: string,
    reason: PlannerBacklogReason,
): void {
    const current = backlogByTask.get(taskId);
    if (current === undefined) {
        backlogByTask.set(taskId, reason);
        return;
    }
    // A capacity miss is more actionable than another assignment's metadata
    // miss when a shared task has several assignees.
    if (reason === "capacity") backlogByTask.set(taskId, reason);
}

function addProjectHours(
    projects: Map<string, ProjectAccumulator>,
    task: PlannerTask,
    datePart: string,
    hours: number,
): void {
    if (!task.projectId) return;
    const project = projects.get(task.projectId) ?? {
        projectId: task.projectId,
        name: task.projectName ?? task.projectId,
        allocatedByDate: new Map<string, number>(),
    };
    projects.set(task.projectId, project);
    if (task.projectName && project.name === task.projectId) project.name = task.projectName;
    project.allocatedByDate.set(
        datePart,
        (project.allocatedByDate.get(datePart) ?? 0) + hours,
    );
}

function buildCalendarOptions(
    user: PlannerUser,
    leave: readonly PlannerLeavePeriod[],
    input: PlannerModelInput,
    dailyHours: number,
): {
    dailyHours: number;
    leave: PlannerLeavePeriod[];
    recurring: RecurringCommitment[];
    holidays: readonly string[];
    weekDays: readonly number[];
} {
    const recurring = [
        ...(input.recurring ?? []),
        ...(user.recurring ?? []),
    ];
    return {
        dailyHours,
        leave: [...leave],
        recurring,
        holidays: input.holidays ?? [],
        weekDays: input.weekDays ?? DEFAULT_WORK_WEEK,
    };
}

function taskChipFor(task: PlannerTask, hours: number): PlannerTaskChip {
    return {
        taskId: task.id,
        taskKey: task.taskKey,
        title: task.title,
        hours,
        projectId: task.projectId ?? null,
        projectName: task.projectName ?? (task.projectId ?? null),
        status: task.status,
        priority: task.priority,
    };
}

type ScheduledPlannerAllocation = {
    datePart: string;
    hours: number;
};

type AllocationScheduleResult = {
    scheduled: ScheduledPlannerAllocation[];
    remainingHours: number;
    hadEligibleWorkingDay: boolean;
};

function taskOverlapsDay(task: PlannerTask, datePart: string): boolean {
    const start = task.plannedStartAt == null ? null : asDate(task.plannedStartAt);
    const end = task.plannedEndAt == null ? null : asDate(task.plannedEndAt);
    if ((task.plannedStartAt != null && start === null) || (task.plannedEndAt != null && end === null)) {
        return false;
    }
    if (start === null && end === null) return false;
    const bounds = dayBounds(datePart);
    const startTime = start?.getTime() ?? Number.NEGATIVE_INFINITY;
    const endTime = end?.getTime() ?? Number.POSITIVE_INFINITY;
    return startTime <= endTime && startTime <= bounds.end && endTime >= bounds.start;
}

function schedulePlannerAllocation(
    task: PlannerTask,
    allocationHours: number,
    user: PlannerUser,
    leaves: readonly PlannerLeavePeriod[],
    input: PlannerModelInput,
    dateParts: readonly string[],
    dayByUserDate: Map<string, MutableMemberDay>,
    timeLogs: Map<string, number>,
    dailyHours: number,
): AllocationScheduleResult {
    const scheduled: ScheduledPlannerAllocation[] = [];
    let remainingHours = allocationHours;
    let hadEligibleWorkingDay = false;
    const weekDays = input.weekDays ?? DEFAULT_WORK_WEEK;
    const holidays = input.holidays ?? [];

    for (const datePart of dateParts) {
        if (remainingHours <= 0 || !taskOverlapsDay(task, datePart)) continue;
        if (!isWorkingDay(datePart, { weekDays, holidays })) continue;
        hadEligibleWorkingDay = true;
        const day = dayByUserDate.get(`${user.id}|${datePart}`);
        if (!day) continue;
        const committedHours = (timeLogs.get(`${user.id}|${datePart}`) ?? 0) / 60;
        const availableBeforeEngine = Math.max(0, dailyHours - committedHours - day.allocatedHours);
        const calendarOptions = buildCalendarOptions(user, leaves, input, availableBeforeEngine);
        const bounds = dayBounds(datePart);
        const result = scheduleTasks(
            [{
                id: task.id,
                remainingHours,
                plannedStartAt: task.plannedStartAt,
                plannedEndAt: task.plannedEndAt,
            }],
            {
                startAt: new Date(bounds.start),
                endAt: new Date(bounds.end - 1),
            },
            calendarOptions,
        );
        let placedHours = 0;
        for (const item of result.scheduled) {
            if (item.hours <= 0) continue;
            scheduled.push({ datePart: item.datePart, hours: item.hours });
            placedHours += item.hours;
        }
        remainingHours = Math.max(0, remainingHours - placedHours);
    }

    return { scheduled, remainingHours, hadEligibleWorkingDay };
}

export function buildPlannerModel(input: PlannerModelInput): PlannerModel {
    const rangeStart = requireDate(input.rangeStart, "Planner range start");
    const rangeEnd = requireDate(input.rangeEnd, "Planner range end");
    if (rangeEnd.getTime() < rangeStart.getTime()) {
        throw new RangeError("Planner range end must not precede its start");
    }

    const weekDays = input.weekDays ?? DEFAULT_WORK_WEEK;
    const workingDayCount = weekDays.length;
    const dateParts = datePartsInRange(rangeStart, rangeEnd);
    const timeLogs = timeLogMinutesByUserDay(normalizeTimeLogs(input.existingTimeLogs));
    const userById = new Map<string, PlannerUser>();
    const leavesByUser = new Map<string, PlannerLeavePeriod[]>();
    const daysByUser = new Map<string, MutableMemberDay[]>();
    const dayByUserDate = new Map<string, MutableMemberDay>();
    const capacityBacklogByUser = new Set<string>();

    for (const leave of input.leavePeriods) {
        const periods = leavesByUser.get(leave.userId) ?? [];
        periods.push(leave);
        leavesByUser.set(leave.userId, periods);
    }

    for (const user of input.users) {
        userById.set(user.id, user);
        const weeklyCapacity = user.capacityPerWeekHours ?? DEFAULT_CAPACITY_PER_WEEK_HOURS;
        validateNonnegative(weeklyCapacity, "Weekly capacity");
        const dailyHours = user.dailyHours
            ?? input.dailyHours
            ?? (workingDayCount > 0 ? weeklyCapacity / workingDayCount : 0);
        validateNonnegative(dailyHours, "Daily capacity");
        const leaves = leavesByUser.get(user.id) ?? [];
        const calendarOptions = buildCalendarOptions(user, leaves, input, dailyHours);
        const days: MutableMemberDay[] = [];

        for (const datePart of dateParts) {
            const weekday = weekdayOfDatePart(datePart, DEFAULT_TIME_ZONE);
            const isWeekend = !weekDays.includes(weekday);
            const working = isWorkingDay(datePart, {
                weekDays,
                holidays: input.holidays,
            });
            const engineCapacity = working ? dayCapacity(datePart, calendarOptions) : 0;
            const committedHours = (timeLogs.get(`${user.id}|${datePart}`) ?? 0) / 60;
            const capacityHours = Math.max(0, engineCapacity - committedHours);
            const day: MutableMemberDay = {
                datePart,
                capacityHours,
                allocatedHours: 0,
                availableHours: capacityHours,
                utilizationPercent: percentFor(0, capacityHours),
                isTimeOff: leaves.some((leave) => intervalCoversDay(leave.startAt, leave.endAt, datePart)),
                isWeekend,
                taskChips: [],
            };
            days.push(day);
            dayByUserDate.set(`${user.id}|${datePart}`, day);
        }
        daysByUser.set(user.id, days);
    }

    const projects = new Map<string, ProjectAccumulator>();
    const backlogByTask = new Map<string, PlannerBacklogReason>();
    let unknownEffortCount = 0;
    const rangeStartTime = rangeStart.getTime();
    const rangeEndTime = rangeEnd.getTime();

    for (const task of input.tasks) {
        if (isTerminalStatus(task.status)) continue;

        const effort = allocateTaskEffort(
            {
                remainingEffortHours: task.remainingEffortHours,
                estimateHours: task.remainingEffortHours == null && task.estimateMinutes != null
                    ? task.estimateMinutes / 60
                    : undefined,
                status: allocationStatus(task.status),
            },
            task.assignments.map((assignment) => ({
                userId: assignment.userId,
                plannedShare: assignment.plannedShare,
            })),
        );

        if (effort.remaining === null) {
            unknownEffortCount++;
            addBacklog(backlogByTask, task.id, "unknown-effort");
            continue;
        }
        if (effort.allocations.length === 0) {
            if (effort.remaining.hours > 0) addBacklog(backlogByTask, task.id, "unassigned");
            continue;
        }

        let scheduledForKnownMember = false;
        let scheduledForAnyMember = false;
        let capacityMissForTask = false;
        const capacityBacklogUsersForTask = new Set<string>();

        for (const allocation of effort.allocations) {
            const user = userById.get(allocation.userId);
            if (!user) {
                addBacklog(backlogByTask, task.id, "member-not-found");
                continue;
            }
            scheduledForKnownMember = true;
            let shortfallHours = 0;
            if (allocation.hours === 0) continue;
            const leaves = leavesByUser.get(user.id) ?? [];
            const weeklyCapacity = user.capacityPerWeekHours ?? DEFAULT_CAPACITY_PER_WEEK_HOURS;
            const baseDailyHours = user.dailyHours
                ?? input.dailyHours
                ?? (workingDayCount > 0 ? weeklyCapacity / workingDayCount : 0);
            const calendarOptions = buildCalendarOptions(user, leaves, input, baseDailyHours);
            const scheduled = scheduleTasks(
                [{
                    id: task.id,
                    remainingHours: allocation.hours,
                    plannedStartAt: task.plannedStartAt,
                    plannedEndAt: task.plannedEndAt,
                }],
                { startAt: rangeStart, endAt: rangeEnd },
                calendarOptions,
            );

            for (const item of scheduled.scheduled) {
                if (item.hours <= 0) continue;
                const day = dayByUserDate.get(`${user.id}|${item.datePart}`);
                if (!day) continue;
                // The engine fills each task against full day capacity; when
                // tasks are scheduled sequentially, cap each placement at the
                // capacity still remaining on that day so earlier tasks
                // consume it first (no over-booking). Shortfalls go to the
                // capacity backlog.
                const remainingCapacity = Math.max(0, day.capacityHours - day.allocatedHours);
                const beforeCap = item.hours;
                item.hours = Math.min(item.hours, remainingCapacity);
                if (item.hours <= 0) {
                    capacityMissForTask = true;
                    capacityBacklogUsersForTask.add(user.id);
                    continue;
                }
                shortfallHours += beforeCap - item.hours;
                day.allocatedHours += item.hours;
                day.taskChips.push(taskChipFor(task, item.hours));
                addProjectHours(projects, task, item.datePart, item.hours);
                scheduledForAnyMember = true;
            }
            if (scheduled.backlog.includes(task.id) || shortfallHours > 0.001) {
                capacityMissForTask = true;
                capacityBacklogUsersForTask.add(user.id);
            }
        }

        if (capacityMissForTask) {
            const scheduleReason = backlogReasonForSchedule(task, rangeStartTime, rangeEndTime);
            addBacklog(backlogByTask, task.id, scheduleReason);
            if (scheduleReason === "capacity") {
                for (const userId of Array.from(capacityBacklogUsersForTask)) {
                    capacityBacklogByUser.add(userId);
                }
            }
        } else if (scheduledForKnownMember && !scheduledForAnyMember && effort.remaining.hours > 0) {
            addBacklog(backlogByTask, task.id, backlogReasonForSchedule(task, rangeStartTime, rangeEndTime));
        }
    }

    const members: PlannerMember[] = [];
    const teamDays: PlannerTeamDay[] = [];
    const teamAllocated: number[] = [];
    const teamCapacity: number[] = [];

    for (const user of input.users) {
        const days = daysByUser.get(user.id) ?? [];
        const efforts: number[] = [];
        let memberAllocated = 0;
        let memberCapacity = 0;
        for (const day of days) {
            day.availableHours = Math.max(0, day.capacityHours - day.allocatedHours);
            day.utilizationPercent = percentFor(day.allocatedHours, day.capacityHours);
            efforts.push(day.allocatedHours);
            memberAllocated += day.allocatedHours;
            memberCapacity += day.capacityHours;
        }
        const periodSummary = summarizeWorkload(efforts, memberCapacity);
        members.push({
            id: user.id,
            name: user.name,
            image: user.image ?? null,
            days,
            periodUtilizationPercent: periodSummary.percent,
            state: presentationState(periodSummary.percent, capacityBacklogByUser.has(user.id)),
        });

        for (let index = 0; index < days.length; index += 1) {
            teamAllocated[index] = (teamAllocated[index] ?? 0) + days[index].allocatedHours;
            teamCapacity[index] = (teamCapacity[index] ?? 0) + days[index].capacityHours;
        }
    }

    for (let index = 0; index < dateParts.length; index += 1) {
        const allocatedHours = teamAllocated[index] ?? 0;
        const capacityHours = teamCapacity[index] ?? 0;
        teamDays.push({
            datePart: dateParts[index],
            capacityHours,
            allocatedHours,
            utilizationPercent: percentFor(allocatedHours, capacityHours),
        });
    }

    const projectAxis: PlannerProject[] = [];
    for (const project of Array.from(projects.values())) {
        let allocatedHours = 0;
        const days: PlannerProjectDay[] = dateParts.map((datePart) => {
            const hours = project.allocatedByDate.get(datePart) ?? 0;
            allocatedHours += hours;
            return { datePart, allocatedHours: hours };
        });
        projectAxis.push({
            projectId: project.projectId,
            name: project.name,
            days,
            loadMeter: { allocatedHours },
        });
    }

    const teamSummary = summarizeWorkload(teamDays.map((day) => day.allocatedHours), teamDays.reduce((sum, day) => sum + day.capacityHours, 0));

    return {
        members,
        projectAxis,
        teamTotal: {
            days: teamDays,
            utilizationPercent: teamSummary.percent,
        },
        backlog: Array.from(backlogByTask, ([taskId, reason]) => ({ taskId, reason })),
        unknownEffortCount,
    };
}
