export type PlannedDateRange = {
    plannedStartAt: string | null;
    plannedEndAt: string | null;
};

export type DateResizeEdge = "start" | "end";

export const MIN_ESTIMATE_HOURS = 0.5;
export const MAX_ESTIMATE_HOURS = 24;
export const ESTIMATE_STEP_HOURS = 0.5;

function parseDate(value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new RangeError("Invalid planned date");
    }
    return parsed;
}

function shiftDate(value: string, deltaDays: number): string {
    const shifted = parseDate(value);
    shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
    return shifted.toISOString();
}

function keepTimeOnDate(value: string, date: string): string {
    const source = parseDate(value);
    const target = parseDate(date);
    target.setUTCHours(
        source.getUTCHours(),
        source.getUTCMinutes(),
        source.getUTCSeconds(),
        source.getUTCMilliseconds(),
    );
    return target.toISOString();
}

/** Move both planned edges by a calendar-day delta, preserving their times. */
export function shiftPlannedDateRange(range: PlannedDateRange, deltaDays: number): PlannedDateRange {
    if (!Number.isInteger(deltaDays)) {
        throw new RangeError("Date shift must use whole calendar days");
    }
    return {
        plannedStartAt: range.plannedStartAt == null ? null : shiftDate(range.plannedStartAt, deltaDays),
        plannedEndAt: range.plannedEndAt == null ? null : shiftDate(range.plannedEndAt, deltaDays),
    };
}

/** Resize one planned edge by whole days without letting the range invert. */
export function resizePlannedDateRange(
    range: PlannedDateRange,
    edge: DateResizeEdge,
    deltaDays: number,
): PlannedDateRange {
    if (!Number.isInteger(deltaDays)) {
        throw new RangeError("Date resize must use whole calendar days");
    }

    if (edge === "start" && range.plannedStartAt != null) {
        let nextStart = shiftDate(range.plannedStartAt, deltaDays);
        if (range.plannedEndAt != null && parseDate(nextStart) > parseDate(range.plannedEndAt)) {
            nextStart = keepTimeOnDate(nextStart, range.plannedEndAt);
        }
        return { ...range, plannedStartAt: nextStart };
    }

    if (edge === "end" && range.plannedEndAt != null) {
        let nextEnd = shiftDate(range.plannedEndAt, deltaDays);
        if (range.plannedStartAt != null && parseDate(nextEnd) < parseDate(range.plannedStartAt)) {
            nextEnd = keepTimeOnDate(nextEnd, range.plannedStartAt);
        }
        return { ...range, plannedEndAt: nextEnd };
    }

    return range;
}

/** Snap an estimate to half-hour increments and keep it within planner bounds. */
export function clampEstimateHours(hours: number): number {
    if (!Number.isFinite(hours)) return MIN_ESTIMATE_HOURS;
    const snapped = Math.round(hours / ESTIMATE_STEP_HOURS) * ESTIMATE_STEP_HOURS;
    return Math.min(MAX_ESTIMATE_HOURS, Math.max(MIN_ESTIMATE_HOURS, snapped));
}
