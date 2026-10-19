export const RIYADH_TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh = UTC+3, no DST

/**
 * Given "now", returns the just-completed Saudi work week window
 * [weekStart, weekEnd) in UTC, where weekEnd is the most recent Sunday 00:00
 * Riyadh and weekStart is 7 days before.
 */
export function riyadhWeekWindow(now: Date) {
    const riyadhNow = new Date(now.getTime() + RIYADH_TZ_OFFSET_MS);
    const dayOfWeek = riyadhNow.getUTCDay(); // 0 = Sunday
    const startOfThisSunday = new Date(riyadhNow);
    startOfThisSunday.setUTCHours(0, 0, 0, 0);
    startOfThisSunday.setUTCDate(startOfThisSunday.getUTCDate() - dayOfWeek);
    const startUtc = new Date(startOfThisSunday.getTime() - RIYADH_TZ_OFFSET_MS);
    const weekStart = new Date(startUtc.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekEnd = startUtc;
    return { weekStart, weekEnd };
}

export function formatWeekLabel(weekStart: Date, weekEnd: Date) {
    const fmt = (d: Date) =>
        d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    return `${fmt(weekStart)} – ${fmt(new Date(weekEnd.getTime() - 24 * 60 * 60 * 1000))}`;
}

/**
 * The IN-PROGRESS Saudi week: most recent Sunday 00:00 Riyadh → +7 days.
 * (riyadhWeekWindow above returns the just-COMPLETED week — different use.)
 */
export function currentRiyadhWeekWindow(now: Date) {
    const riyadhNow = new Date(now.getTime() + RIYADH_TZ_OFFSET_MS);
    const dayOfWeek = riyadhNow.getUTCDay(); // 0 = Sunday
    const startOfThisSunday = new Date(riyadhNow);
    startOfThisSunday.setUTCHours(0, 0, 0, 0);
    startOfThisSunday.setUTCDate(startOfThisSunday.getUTCDate() - dayOfWeek);
    const weekStart = new Date(startOfThisSunday.getTime() - RIYADH_TZ_OFFSET_MS);
    const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { weekStart, weekEnd };
}
