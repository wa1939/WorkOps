import {
    addDays,
    addMonths,
    addYears,
    differenceInCalendarDays,
    format,
    getISOWeek,
    getISOWeekYear,
    isBefore,
    startOfDay,
    startOfMonth,
    startOfWeek,
    startOfYear,
} from "date-fns";

export type TimelineZoom = "day" | "week" | "month" | "quarter" | "year";

export const PX_PER_DAY = {
    day: 40,
    week: 12,
    month: 4,
    quarter: 2,
    year: 1,
} as const satisfies Record<TimelineZoom, number>;

export type RulerColumn = {
    /** Inclusive calendar start of the visible portion of this column. */
    start: Date;
    /** Exclusive calendar end of the visible portion of this column. */
    end: Date;
    label: string;
    isWeekend?: boolean;
};

export type TimelineRuler = {
    columns: RulerColumn[];
    totalWidth: number;
};

const DAY_ZOOM = "day";
const WEEK_ZOOM = "week";
const MONTH_ZOOM = "month";
const QUARTER_ZOOM = "quarter";
const YEAR_ZOOM = "year";

function validDay(value: Date, name: string): Date {
    const date = new Date(value.getTime());
    if (Number.isNaN(date.getTime())) {
        throw new RangeError(`${name} must be a valid date`);
    }
    return startOfDay(date);
}

function normalizeRange(from: Date, to: Date): { from: Date; to: Date } {
    const start = validDay(from, "from");
    const end = validDay(to, "to");
    return isBefore(start, end) ? { from: start, to: end } : { from: end, to: start };
}

/**
 * Number of calendar-month boundaries between two dates.
 *
 * The result is non-negative, so callers can safely use it for range sizing
 * even when a user has supplied the endpoints in reverse order.
 */
export function monthsSpan(from: Date, to: Date): number {
    const range = normalizeRange(from, to);
    return (
        (range.to.getFullYear() - range.from.getFullYear()) * 12 +
        range.to.getMonth() -
        range.from.getMonth()
    );
}

function periodStart(date: Date, zoom: TimelineZoom): Date {
    switch (zoom) {
        case DAY_ZOOM:
            return startOfDay(date);
        case WEEK_ZOOM:
            return startOfWeek(date, { weekStartsOn: 1 });
        case MONTH_ZOOM:
            return startOfMonth(date);
        case QUARTER_ZOOM:
            return startOfMonth(new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1));
        case YEAR_ZOOM:
            return startOfYear(date);
        default:
            return assertNever(zoom);
    }
}

function periodEnd(start: Date, zoom: TimelineZoom): Date {
    switch (zoom) {
        case DAY_ZOOM:
            return addDays(start, 1);
        case WEEK_ZOOM:
            return addDays(start, 7);
        case MONTH_ZOOM:
            return addMonths(start, 1);
        case QUARTER_ZOOM:
            return addMonths(start, 3);
        case YEAR_ZOOM:
            return addYears(start, 1);
        default:
            return assertNever(zoom);
    }
}

function columnLabel(start: Date, zoom: TimelineZoom): string {
    switch (zoom) {
        case DAY_ZOOM:
            return format(start, "d MMM");
        case WEEK_ZOOM:
            return `W${String(getISOWeek(start)).padStart(2, "0")} ${getISOWeekYear(start)}`;
        case MONTH_ZOOM:
            return format(start, "MMM yyyy");
        case QUARTER_ZOOM:
            return `Q${Math.floor(start.getMonth() / 3) + 1} ${format(start, "yyyy")}`;
        case YEAR_ZOOM:
            return format(start, "yyyy");
        default:
            return assertNever(zoom);
    }
}

function assertNever(value: never): never {
    throw new RangeError(`Unsupported timeline zoom: ${String(value)}`);
}

/**
 * Build a calendar ruler for an inclusive date range.
 *
 * Columns are clipped to the requested range while labels retain their
 * calendar-period meaning. The width is always the number of visible days
 * multiplied by the zoom's pixels-per-day scale.
 */
export function buildRuler(from: Date, to: Date, zoom: TimelineZoom): TimelineRuler {
    const range = normalizeRange(from, to);
    const rangeEndExclusive = addDays(range.to, 1);
    const columns: RulerColumn[] = [];
    let cursor = periodStart(range.from, zoom);

    while (isBefore(cursor, rangeEndExclusive)) {
        const next = periodEnd(cursor, zoom);
        const visibleStart = isBefore(cursor, range.from) ? range.from : cursor;
        const visibleEnd = isBefore(rangeEndExclusive, next) ? rangeEndExclusive : next;
        const column: RulerColumn = {
            start: new Date(visibleStart.getTime()),
            end: new Date(visibleEnd.getTime()),
            label: columnLabel(cursor, zoom),
        };
        if (zoom === DAY_ZOOM) {
            column.isWeekend = visibleStart.getDay() === 0 || visibleStart.getDay() === 6;
        }
        columns.push(column);
        cursor = next;
    }

    return {
        columns,
        totalWidth: differenceInCalendarDays(rangeEndExclusive, range.from) * PX_PER_DAY[zoom],
    };
}

export function pxPerDay(zoom: TimelineZoom): number {
    return PX_PER_DAY[zoom];
}
