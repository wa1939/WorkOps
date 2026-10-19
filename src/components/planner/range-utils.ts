export type PlannerRange = "day" | "week" | "month";

const RIYADH_TIME_ZONE = "Asia/Riyadh";
const WEEKEND_DAYS = new Set([5, 6]);

function dateFromPart(datePart: string): Date {
    const date = new Date(`${datePart}T12:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
        throw new RangeError(`Invalid date part: ${datePart}`);
    }
    return date;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

function partsToDatePart(parts: Intl.DateTimeFormatPart[]): string {
    const values = new Map<string, string>();
    for (const part of parts) values.set(part.type, part.value);
    return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function todayDatePart(): string {
    return partsToDatePart(new Intl.DateTimeFormat("en-US", {
        timeZone: RIYADH_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date()));
}

export function datePartFromIso(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new RangeError("Invalid ISO date");
    return partsToDatePart(new Intl.DateTimeFormat("en-US", {
        timeZone: RIYADH_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date));
}

export function shiftDatePart(datePart: string, deltaDays: number): string {
    const date = dateFromPart(datePart);
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function dayOfWeek(datePart: string): number {
    return dateFromPart(datePart).getUTCDay();
}

export function isWeekendDate(datePart: string): boolean {
    return WEEKEND_DAYS.has(dayOfWeek(datePart));
}

export function isWorkingDay(datePart: string): boolean {
    return !isWeekendDate(datePart);
}

export function normalizeWorkingDay(datePart: string, direction: 1 | -1 = 1): string {
    let candidate = datePart;
    for (let count = 0; count < 7 && !isWorkingDay(candidate); count += 1) {
        candidate = shiftDatePart(candidate, direction);
    }
    return candidate;
}

export function datePartsForRange(range: PlannerRange, anchor: string): string[] {
    const normalized = range === "day" ? normalizeWorkingDay(anchor) : anchor;
    const start = range === "day"
        ? normalized
        : shiftDatePart(normalized, -dayOfWeek(normalized));
    const length = range === "month" ? 28 : range === "week" ? 7 : 1;
    const parts: string[] = [];
    for (let index = 0; index < length; index += 1) {
        parts.push(shiftDatePart(start, index));
    }
    return parts;
}

export function rangeWindow(range: PlannerRange, anchor: string): {
    from: string;
    to: string;
    dateParts: string[];
    label: string;
} {
    const dateParts = datePartsForRange(range, anchor);
    const from = dateParts[0];
    const to = dateParts[dateParts.length - 1];
    return { from, to, dateParts, label: rangeLabel(range, from, to) };
}

export function navigateAnchor(range: PlannerRange, anchor: string, direction: 1 | -1): string {
    const step = range === "month" ? 28 : range === "week" ? 7 : 1;
    const next = shiftDatePart(anchor, step * direction);
    return range === "day" ? normalizeWorkingDay(next, direction) : next;
}

export function formatDateLabel(datePart: string): string {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
    }).format(dateFromPart(datePart));
}

export function formatWeekday(datePart: string): string {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        weekday: "short",
    }).format(dateFromPart(datePart));
}

function formatDateWithYear(datePart: string): string {
    return new Intl.DateTimeFormat("en-US", {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(dateFromPart(datePart));
}

export function rangeLabel(range: PlannerRange, from: string, to: string): string {
    if (range === "day") return formatDateWithYear(from);
    return `${formatDateLabel(from)} – ${formatDateWithYear(to)}`;
}

export function dayBounds(datePart: string): { plannedStartAt: string; plannedEndAt: string } {
    const start = new Date(`${datePart}T00:00:00.000+03:00`);
    const next = new Date(`${shiftDatePart(datePart, 1)}T00:00:00.000+03:00`);
    return {
        plannedStartAt: start.toISOString(),
        plannedEndAt: new Date(next.getTime() - 1).toISOString(),
    };
}

export function calendarDayDelta(from: string, to: string): number {
    return Math.round((dateFromPart(to).getTime() - dateFromPart(from).getTime()) / 86_400_000);
}
