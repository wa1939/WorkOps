/**
 * Streaks are derived from task-completion history rather than stored in a counter.
 *
 * The previous design kept a `UserStreak` row that only `POST /api/streak` could advance,
 * and nothing in the app ever called it — so every streak sat at 0 forever. Deriving the
 * value means it is always correct, needs no write path, and repairs itself retroactively.
 */

/** Day bucket key, matching the UTC-based day maths the rest of the dashboard uses. */
export function dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

const DAY_MS = 86400000;

const shiftDays = (key: string, days: number): string =>
    dayKey(new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * DAY_MS));

export interface StreakSummary {
    currentStreak: number;
    bestStreak: number;
    totalPoints: number;
    lastActiveAt: string | null;
    /** Day keys within the trailing week that had a completion — drives the widget dots. */
    activeDays: string[];
}

export function computeStreak(completedAt: Array<Date | string>, now: Date): StreakSummary {
    const days = new Set<string>();
    let latest: Date | null = null;

    for (const raw of completedAt) {
        const date = raw instanceof Date ? raw : new Date(raw);
        if (Number.isNaN(date.getTime())) continue;
        days.add(dayKey(date));
        if (!latest || date > latest) latest = date;
    }

    const today = dayKey(now);
    const yesterday = shiftDays(today, -1);

    // Count back from today. If nothing is done yet today the streak is still alive —
    // it only breaks once a full day has been missed — so fall back to yesterday.
    let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
    let currentStreak = 0;
    while (cursor && days.has(cursor)) {
        currentStreak++;
        cursor = shiftDays(cursor, -1);
    }

    // Longest run anywhere in history: a day starts a run only if the day before is absent.
    let bestStreak = 0;
    for (const day of Array.from(days)) {
        if (days.has(shiftDays(day, -1))) continue;
        let run = 0;
        let walk = day;
        while (days.has(walk)) {
            run++;
            walk = shiftDays(walk, 1);
        }
        if (run > bestStreak) bestStreak = run;
    }

    const activeDays = Array.from({ length: 7 }, (_, i) => shiftDays(today, i - 6)).filter((d) =>
        days.has(d),
    );

    return {
        currentStreak,
        bestStreak: Math.max(bestStreak, currentStreak),
        totalPoints: completedAt.length,
        lastActiveAt: latest ? latest.toISOString() : null,
        activeDays,
    };
}
