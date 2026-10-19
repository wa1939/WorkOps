export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurrenceMode = "create" | "status";

/**
 * The recurrence module deliberately accepts the persisted/string form as well
 * as Dates. This keeps the calendar calculation independent of Prisma and safe
 * to call from API payloads, jobs, and tests.
 */
export interface RecurrenceRule {
    freq: string;
    interval?: number | null;
    byDay?: unknown;
    byMonthDay?: number | null;
    nthWeek?: number | null;
    weekday?: number | null;
    mode?: string;
    targetStatus?: string | null;
    active?: boolean | null;
    lastRunAt?: Date | string | null;
    nextRunAt?: Date | string | null;
}

const MAX_INTERVAL = 1_000_000;
const MAX_SEARCH_MONTHS = 12 * 400;
const MAX_SEARCH_YEARS = 401;

function isValidDate(value: Date): boolean {
    return !Number.isNaN(value.getTime());
}

function asDate(value: Date | string | null | undefined): Date | null {
    if (value instanceof Date) {
        return isValidDate(value) ? new Date(value.getTime()) : null;
    }
    if (typeof value !== "string") return null;
    const parsed = new Date(value);
    return isValidDate(parsed) ? parsed : null;
}

function startOfUtcDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days));
}

function addUtcMonths(year: number, month: number, months: number): { year: number; month: number } {
    const absoluteMonth = year * 12 + month + months;
    return {
        year: Math.floor(absoluteMonth / 12),
        month: ((absoluteMonth % 12) + 12) % 12,
    };
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function validInteger(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function intervalOf(rule: RecurrenceRule): number | null {
    const interval = rule.interval ?? 1;
    return validInteger(interval, 1, MAX_INTERVAL) ? interval : null;
}

function daysOfWeek(rule: RecurrenceRule): number[] | null {
    if (!Array.isArray(rule.byDay) || rule.byDay.length === 0 || rule.byDay.length > 7) return null;
    const days = rule.byDay.map((day) => day);
    if (!days.every((day) => validInteger(day, 0, 6))) return null;
    return Array.from(new Set(days)).sort((left, right) => left - right);
}

function hasValue(value: unknown): boolean {
    return value !== undefined && value !== null;
}

/** Return whether the rule has a supported, internally consistent shape. */
export function isValidRecurrenceRule(rule: RecurrenceRule | null | undefined): rule is RecurrenceRule {
    if (!rule || typeof rule !== "object") return false;
    if (rule.active !== undefined && rule.active !== null && typeof rule.active !== "boolean") return false;
    if (rule.freq !== "daily" && rule.freq !== "weekly" && rule.freq !== "monthly" && rule.freq !== "yearly") return false;
    if (intervalOf(rule) === null) return false;

    if (rule.freq === "weekly" && daysOfWeek(rule) === null) return false;
    if (rule.freq !== "weekly" && hasValue(rule.byDay)) return false;

    const hasMonthDay = hasValue(rule.byMonthDay);
    if (hasMonthDay && !validInteger(rule.byMonthDay, 1, 31)) return false;
    const hasNthWeek = hasValue(rule.nthWeek);
    const hasWeekday = hasValue(rule.weekday);
    if (hasNthWeek && !validInteger(rule.nthWeek, 1, 5)) return false;
    if (hasWeekday && !validInteger(rule.weekday, 0, 6)) return false;

    if (rule.freq === "monthly") {
        const hasNthRule = hasNthWeek || hasWeekday;
        if (hasMonthDay === hasNthRule) return false;
        if (hasNthRule && (!hasNthWeek || !hasWeekday)) return false;
    } else if (rule.freq === "daily" || rule.freq === "weekly") {
        if (hasMonthDay || hasNthWeek || hasWeekday) return false;
    }

    if (rule.freq === "yearly" && (hasNthWeek || hasWeekday)) return false;
    return true;
}

function nextDaily(rule: RecurrenceRule, from: Date, interval: number): Date {
    return addUtcDays(startOfUtcDay(from), interval);
}

function nextWeekly(rule: RecurrenceRule, from: Date, interval: number): Date | null {
    const days = daysOfWeek(rule);
    if (!days) return null;

    const fromDay = startOfUtcDay(from);
    const weekStart = addUtcDays(fromDay, -fromDay.getUTCDay());
    for (const weekday of days) {
        const candidate = addUtcDays(weekStart, weekday);
        if (candidate.getTime() > from.getTime()) return candidate;
    }

    // A rule's interval applies to recurrence weeks. Multiple byDay values
    // remain active within the same week; once that week is exhausted, move
    // forward by the configured number of Sunday-started weeks.
    return addUtcDays(weekStart, interval * 7 + days[0]);
}

function nextMonthlyByDay(rule: RecurrenceRule, from: Date): Date | null {
    const day = rule.byMonthDay;
    if (!validInteger(day, 1, 31)) return null;
    const interval = intervalOf(rule) ?? 1;
    const fromDay = startOfUtcDay(from);
    let year = fromDay.getUTCFullYear();
    let month = fromDay.getUTCMonth();

    // A 31st is intentionally skipped in shorter months rather than clamped
    // to their final day. That keeps the recurrence on its requested date.
    // The interval counts calendar months from the month being examined;
    // occurrences landing in skipped months resume on the next interval
    // step from the original month sequence.
    for (let offset = 0; offset < MAX_SEARCH_MONTHS; offset += interval) {
        const candidateDays = daysInMonth(year, month);
        if (day <= candidateDays) {
            const candidate = new Date(Date.UTC(year, month, day));
            if (candidate.getTime() > from.getTime()) return candidate;
        }
        ({ year, month } = addUtcMonths(year, month, interval));
    }
    return null;
}

function nextMonthlyByNthWeekday(rule: RecurrenceRule, from: Date): Date | null {
    const nthWeek = rule.nthWeek;
    const weekday = rule.weekday;
    if (!validInteger(nthWeek, 1, 5) || !validInteger(weekday, 0, 6)) return null;
    const interval = intervalOf(rule) ?? 1;

    const fromDay = startOfUtcDay(from);
    let year = fromDay.getUTCFullYear();
    let month = fromDay.getUTCMonth();
    for (let offset = 0; offset < MAX_SEARCH_MONTHS; offset += interval) {
        const first = new Date(Date.UTC(year, month, 1));
        const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (nthWeek - 1) * 7;
        if (day <= daysInMonth(year, month)) {
            const candidate = new Date(Date.UTC(year, month, day));
            if (candidate.getTime() > from.getTime()) return candidate;
        }
        ({ year, month } = addUtcMonths(year, month, interval));
    }
    return null;
}

function nextYearly(rule: RecurrenceRule, from: Date): Date | null {
    const fromDay = startOfUtcDay(from);
    const month = fromDay.getUTCMonth();
    const day = rule.byMonthDay ?? fromDay.getUTCDate();
    if (!validInteger(day, 1, 31)) return null;
    const interval = Math.max(1, intervalOf(rule) ?? 1);

    // The month/day is anchored to the supplied occurrence date because the
    // schema intentionally stores no separate byMonth field. Invalid dates,
    // such as February 29 in a non-leap year, are skipped.
    for (let offset = interval; offset <= MAX_SEARCH_YEARS; offset += interval) {
        const year = fromDay.getUTCFullYear() + offset;
        if (day > daysInMonth(year, month)) continue;
        const candidate = new Date(Date.UTC(year, month, day));
        if (candidate.getTime() > from.getTime()) return candidate;
    }
    return null;
}

/**
 * Calculate the next occurrence strictly after `from`.
 *
 * Occurrences are represented as UTC-midnight calendar dates. The application
 * displays them in Asia/Riyadh, so doing all arithmetic on UTC components
 * avoids host-local DST and timezone rollover effects.
 */
export function nextOccurrence(rule: RecurrenceRule | null | undefined, from: Date): Date | null {
    if (!isValidRecurrenceRule(rule) || rule.active === false || !isValidDate(from)) return null;
    const interval = intervalOf(rule);
    if (!interval) return null;

    switch (rule.freq as RecurrenceFrequency) {
        case "daily":
            return nextDaily(rule, from, interval);
        case "weekly":
            return nextWeekly(rule, from, interval);
        case "monthly":
            return rule.byMonthDay !== undefined && rule.byMonthDay !== null
                ? nextMonthlyByDay(rule, from)
                : nextMonthlyByNthWeekday(rule, from);
        case "yearly":
            return nextYearly(rule, from);
        default:
            return null;
    }
}

/** Return true when an active rule has a scheduled occurrence due at `now`. */
export function isDue(rule: RecurrenceRule | null | undefined, now: Date): boolean {
    if (!isValidRecurrenceRule(rule) || rule.active === false || !isValidDate(now)) return false;
    const nextRunAt = asDate(rule.nextRunAt);
    return nextRunAt !== null && nextRunAt.getTime() <= now.getTime();
}

export function recurrenceDate(value: Date | string | null | undefined): Date | null {
    return asDate(value);
}
