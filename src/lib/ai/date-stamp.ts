const RIYADH_TIME_ZONE = "Asia/Riyadh";

export type RiyadhDateParts = {
    isoDate: string;
    weekday: string;
    displayDate: string;
};

/** Return all model-facing date strings from one Riyadh calendar projection. */
export function getRiyadhDateParts(now: Date): RiyadhDateParts {
    const dateParts = new Intl.DateTimeFormat("en-US", {
        timeZone: RIYADH_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const values = Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
    const isoDate = `${values.year}-${values.month}-${values.day}`;
    const weekday = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        timeZone: RIYADH_TIME_ZONE,
    }).format(now);
    const displayDate = new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: RIYADH_TIME_ZONE,
    }).format(now);

    return { isoDate, weekday, displayDate };
}

/**
 * Stamp the current Riyadh date onto the outgoing user turn. Reopened old
 * conversations replay months-old dates in history and the model trusts them
 * over the system prompt — this per-turn stamp is the ground truth for "today".
 * Applied to the GLM-bound message ONLY; the persisted AiMessage stays clean.
 */
export function stampCurrentDate(message: string, now: Date): string {
    const { isoDate, weekday } = getRiyadhDateParts(now);
    return `[التاريخ الآن: ${isoDate} (${weekday}, Riyadh)]\n${message}`;
}
