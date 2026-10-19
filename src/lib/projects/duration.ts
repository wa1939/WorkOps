/**
 * Duration derivation for strategic projects.
 *
 * Strategic portfolio reporting counts implementation duration in whole
 * calendar months, inclusive of both the start and end month, from plain
 * calendar dates (YYYY-MM-DD).
 */

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ImplementationDuration {
    /** Whole calendar months spanned, counting the start and end months. */
    months: number;
    /** Human-readable label, e.g. "6 months" (singular "1 month"). */
    label: string;
}

function parseCalendarDate(value: string): Date {
    const match = CALENDAR_DATE_PATTERN.exec(value);
    if (!match) {
        throw new Error(`Invalid calendar date "${value}": expected YYYY-MM-DD`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);

    // Reject rollover dates such as 2026-02-31 by round-tripping the components.
    const date = new Date(Date.UTC(year, month, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day
    ) {
        throw new Error(`Invalid calendar date "${value}": not a real date`);
    }

    return date;
}

/**
 * Derive the implementation duration between two calendar dates.
 *
 * Months are counted inclusively on the calendar: 2026-11-01 → 2027-04-30
 * spans Nov, Dec, Jan, Feb, Mar, Apr = 6 months.
 */
export function deriveImplementationDuration(
    startAt: string,
    dueAt: string,
): ImplementationDuration {
    const start = parseCalendarDate(startAt);
    const end = parseCalendarDate(dueAt);

    if (start.getTime() > end.getTime()) {
        throw new Error(
            `Invalid date order: startAt (${startAt}) must be on or before dueAt (${dueAt})`,
        );
    }

    const months =
        (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (end.getUTCMonth() - start.getUTCMonth()) +
        1;

    return { months, label: months === 1 ? "1 month" : `${months} months` };
}
