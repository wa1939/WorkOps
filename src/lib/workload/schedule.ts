import {
  DEFAULT_TIME_ZONE,
  dateInTimeZone,
  dayCapacity,
  isWorkingDay,
  type DayCapacityOptions,
} from './calendar';

export type CapacityDay = {
  datePart: string;
  capacityHours: number;
};

export type ScheduledTask = {
  id: string;
  remainingHours?: number | null;
  plannedStartAt?: Date | string | null;
  plannedEndAt?: Date | string | null;
};

export type ScheduleCalendarOptions = DayCapacityOptions & {
  weekDays?: readonly number[];
};

export type ScheduledAllocation = {
  id: string;
  datePart: string;
  hours: number;
};

export type ScheduleResult = {
  scheduled: ScheduledAllocation[];
  backlog: string[];
};

function asDate(value: Date | string): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDatePart(datePart: string, days: number): string {
  const [year, month, day] = datePart.split('-').map(Number);
  const shifted = new Date(0);
  shifted.setUTCFullYear(year, month - 1, day + days);
  shifted.setUTCHours(12, 0, 0, 0);

  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function datePartsInRange(startAt: Date, endAt: Date): string[] {
  const first = dateInTimeZone(startAt, DEFAULT_TIME_ZONE);
  const last = dateInTimeZone(endAt, DEFAULT_TIME_ZONE);
  const dateParts: string[] = [];
  let current = first;

  while (current <= last) {
    dateParts.push(current);
    if (current === last) {
      break;
    }
    current = shiftDatePart(current, 1);
  }

  return dateParts;
}

export function spreadAcrossDays(
  remainingHours: number,
  days: Array<CapacityDay>,
): { allocations: Array<{ datePart: string; hours: number }>; unscheduledHours: number } {
  if (!Number.isFinite(remainingHours) || remainingHours < 0) {
    throw new RangeError('Remaining hours must be finite and nonnegative');
  }

  let unscheduledHours = remainingHours;
  const allocations: Array<{ datePart: string; hours: number }> = [];

  for (const day of days) {
    if (!Number.isFinite(day.capacityHours) || day.capacityHours < 0) {
      throw new RangeError('Day capacity must be finite and nonnegative');
    }
    if (unscheduledHours === 0 || day.capacityHours === 0) {
      continue;
    }

    const hours = Math.min(unscheduledHours, day.capacityHours);
    allocations.push({ datePart: day.datePart, hours });
    if (hours >= unscheduledHours) {
      unscheduledHours = 0;
      break;
    }
    unscheduledHours -= hours;
  }

  return { allocations, unscheduledHours };
}

function overlapsRange(
  task: ScheduledTask,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  const start = task.plannedStartAt == null ? null : asDate(task.plannedStartAt);
  const end = task.plannedEndAt == null ? null : asDate(task.plannedEndAt);
  if (start === null && end === null) {
    return false;
  }
  if (task.plannedStartAt != null && start === null) {
    return false;
  }
  if (task.plannedEndAt != null && end === null) {
    return false;
  }

  const startTime = start?.getTime() ?? Number.NEGATIVE_INFINITY;
  const endTime = end?.getTime() ?? Number.POSITIVE_INFINITY;
  return startTime <= endTime && startTime <= rangeEnd && endTime >= rangeStart;
}

export function scheduleTasks(
  tasks: Array<ScheduledTask>,
  range: { startAt: Date | string; endAt: Date | string },
  calendarOpts: ScheduleCalendarOptions,
): ScheduleResult {
  const rangeStart = asDate(range.startAt);
  const rangeEnd = asDate(range.endAt);
  if (rangeStart === null || rangeEnd === null) {
    throw new RangeError('Schedule range must contain valid dates');
  }
  if (rangeEnd < rangeStart) {
    throw new RangeError('Schedule range end must not precede its start');
  }

  const days = datePartsInRange(rangeStart, rangeEnd)
    .filter((datePart) => isWorkingDay(datePart, {
      weekDays: calendarOpts.weekDays,
      holidays: calendarOpts.holidays,
    }))
    .map((datePart) => ({
      datePart,
      capacityHours: dayCapacity(datePart, calendarOpts),
    }));

  const scheduled: ScheduledAllocation[] = [];
  const backlog: string[] = [];

  for (const task of tasks) {
    const remainingHours = task.remainingHours;
    if (remainingHours === 0) {
      continue;
    }
    if (
      remainingHours == null
      || !Number.isFinite(remainingHours)
      || remainingHours < 0
      || !overlapsRange(task, rangeStart.getTime(), rangeEnd.getTime())
    ) {
      backlog.push(task.id);
      continue;
    }

    const result = spreadAcrossDays(remainingHours, days);
    scheduled.push(...result.allocations.map((allocation) => ({
      id: task.id,
      ...allocation,
    })));
    if (result.unscheduledHours > 0) {
      backlog.push(task.id);
    }
  }

  return { scheduled, backlog };
}
