import { fromZonedTime, formatInTimeZone } from 'date-fns-tz';

export const DEFAULT_TIME_ZONE = 'Asia/Riyadh';
export const DEFAULT_WORK_WEEK: readonly number[] = [0, 1, 2, 3, 4];

export type LeavePeriod = {
  userId?: string;
  startAt: Date | string;
  endAt: Date | string;
};

export type RecurringCommitment = {
  hoursPerDay?: number;
  startAt: Date | string;
  endAt: Date | string;
  dayOfWeek?: number;
};

export type DayCapacityOptions = {
  dailyHours: number;
  leave: LeavePeriod[];
  recurring: RecurringCommitment[];
  holidays?: readonly string[];
};

const DATE_PART_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseDatePart(datePart: string): { year: number; month: number; day: number } {
  const match = DATE_PART_PATTERN.exec(datePart);
  if (!match) {
    throw new RangeError(`Invalid date part: ${datePart}`);
  }

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
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function asValidDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Invalid date');
  }
  return date;
}

function dayBounds(datePart: string, timeZone: string): [number, number] {
  parseDatePart(datePart);
  const start = fromZonedTime(`${datePart}T00:00:00`, timeZone).getTime();
  const end = fromZonedTime(`${shiftDatePart(datePart, 1)}T00:00:00`, timeZone).getTime();
  return [start, end];
}

function intervalCoversDay(
  startAt: Date | string,
  endAt: Date | string,
  datePart: string,
): boolean {
  const start = asValidDate(startAt).getTime();
  const end = asValidDate(endAt).getTime();
  if (end < start) {
    throw new RangeError('End date must not precede start date');
  }

  const [dayStart, dayEnd] = dayBounds(datePart, DEFAULT_TIME_ZONE);
  return start < dayEnd && end > dayStart;
}

export function dateInTimeZone(instant: Date | string, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

export function weekdayOfDatePart(datePart: string, timeZone: string): number {
  parseDatePart(datePart);
  const localNoon = fromZonedTime(`${datePart}T12:00:00`, timeZone);
  const isoWeekday = Number(formatInTimeZone(localNoon, timeZone, 'i'));
  return isoWeekday === 7 ? 0 : isoWeekday;
}

export function isWorkingDay(
  datePart: string,
  opts: { weekDays?: readonly number[]; holidays?: readonly string[] } = {},
): boolean {
  const weekDays = opts.weekDays ?? DEFAULT_WORK_WEEK;
  const holidays = opts.holidays ?? [];
  const weekday = weekdayOfDatePart(datePart, DEFAULT_TIME_ZONE);
  return weekDays.includes(weekday) && !holidays.includes(datePart);
}

export function dayCapacity(datePart: string, opts: DayCapacityOptions): number {
  const { dailyHours, leave, recurring, holidays = [] } = opts;
  if (!Number.isFinite(dailyHours) || dailyHours < 0) {
    throw new RangeError('Daily hours must be finite and nonnegative');
  }
  parseDatePart(datePart);

  if (holidays.includes(datePart)) {
    return 0;
  }

  const hasActiveLeave = leave.some((period) => intervalCoversDay(period.startAt, period.endAt, datePart));
  const weekday = weekdayOfDatePart(datePart, DEFAULT_TIME_ZONE);
  let recurringHours = 0;

  for (const commitment of recurring) {
    const hoursPerDay = commitment.hoursPerDay ?? 0;
    if (!Number.isFinite(hoursPerDay) || hoursPerDay < 0) {
      throw new RangeError('Recurring hours must be finite and nonnegative');
    }
    if (commitment.dayOfWeek != null && commitment.dayOfWeek !== weekday) {
      continue;
    }
    if (intervalCoversDay(commitment.startAt, commitment.endAt, datePart)) {
      recurringHours += hoursPerDay;
    }
  }

  const leaveHours = hasActiveLeave ? dailyHours : 0;
  return Math.max(0, dailyHours - leaveHours - recurringHours);
}
