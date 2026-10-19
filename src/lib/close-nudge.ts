import {
    classifyRecordingActivity,
    type WeeklyEligibilityCategory,
    type WeeklyRecordingActivity,
} from "./communications/weekly-eligibility";

/**
 * Thursday "nothing recorded in the prior week" nudge — pure eligibility + copy.
 * The cron route gathers data and calls these; nothing here touches the DB.
 */

export const NUDGE_TYPE = "close_nudge";
export const NUDGE_LINK = "/?sabah=record-week";
export const LEAVE_SKIP_DAYS = 3;
export const RECORDING_GAP_COPY =
    "No completed tasks were recorded for this period. Review your tasks or capture work completed outside the system.";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRIOR_WEEK_MS = 7 * DAY_MS;

/**
 * Sun–Thu workdays of a RIYADH-offset week window that any leave covers.
 * The window's weekStart is Sunday 00:00 Riyadh, so day-slot i (0-based) IS
 * the Riyadh weekday: 0..4 = Sun..Thu, 5..6 = weekend. (team-load's
 * workdaysOnLeave walks a UTC-midnight grid instead — wrong for this window.)
 */
export function riyadhWorkdaysOnLeave(
    window: { weekStart: Date; weekEnd: Date },
    leaves: { startAt: Date; endAt: Date }[],
): number {
    let count = 0;
    for (let i = 0; i < 5; i++) {
        const dayStart = new Date(window.weekStart.getTime() + i * DAY_MS);
        const dayEnd = new Date(dayStart.getTime() + DAY_MS);
        const onLeave = leaves.some(
            (l) => new Date(l.startAt) < dayEnd && new Date(l.endAt) >= dayStart,
        );
        if (onLeave) count++;
    }
    return count;
}

export interface NudgeCandidate {
    id: string;
    name: string;
    email: string;
    quietUntil: Date | null;
    /** DONE tasks with doneAt inside the current week, among their assignments. */
    doneThisWeek: number;
    leaves: { startAt: Date; endAt: Date }[];
    alreadyNudgedThisWeek: boolean;
    /** Qualifying activity in the prior completed Riyadh week. */
    recordingActivity?: WeeklyRecordingActivity;
    /** Window used for leave exclusion for the category being nudged. */
    recordingWindow?: { weekStart: Date; weekEnd: Date };
    isActive?: boolean;
    createdAt?: Date;
    snoozedCategories?: readonly WeeklyEligibilityCategory[];
}

export type NudgeEligibility = (
    candidate: NudgeCandidate,
    window: { weekStart: Date; weekEnd: Date },
    now: Date,
) => boolean;

const emptyRecordingActivity: WeeklyRecordingActivity = {
    createdTaskCount: 0,
    completedTaskCount: 0,
    progressCommentCount: 0,
};

/**
 * The close nudge is specifically a recording-gap nudge.
 * completion is not evidence of prior-week recording, and zero completions
 * are not evidence of a gap when another qualifying activity exists.
 */
export const isRecordingGapNudgeEligible: NudgeEligibility = (candidate, window) => {
    if (candidate.isActive === false) return false;
    const priorWeekStart = new Date(window.weekStart.getTime() - PRIOR_WEEK_MS);
    if (candidate.createdAt && candidate.createdAt > priorWeekStart) return false;
    if (candidate.snoozedCategories?.includes("weekly_recording_gap")) return false;
    return classifyRecordingActivity(candidate.recordingActivity ?? emptyRecordingActivity) === "recording_gap";
};

export function selectNudgeTargets(
    candidates: NudgeCandidate[],
    window: { weekStart: Date; weekEnd: Date },
    now: Date,
    eligibility: NudgeEligibility = isRecordingGapNudgeEligible,
): NudgeCandidate[] {
    return candidates.filter((c) => {
        if (!eligibility(c, window, now)) return false;
        if (c.alreadyNudgedThisWeek) return false;
        if (c.quietUntil && c.quietUntil > now) return false;
        const leaveWindow = c.recordingWindow ?? window;
        if (riyadhWorkdaysOnLeave(leaveWindow, c.leaves) >= LEAVE_SKIP_DAYS) return false;
        return true;
    });
}

export function buildNudgeCopy(
    name: string,
    category: WeeklyEligibilityCategory = "weekly_recording_gap",
): { title: string; body: string } {
    const first = name.trim().split(/\s+/)[0] || name;
    if (category === "weekly_recording_gap") {
        return {
            title: "ما سجّلت أي إنجاز هذا الأسبوع",
            body: `يا ${first}، صباح: ${RECORDING_GAP_COPY}`,
        };
    }
    return {
        title: "مراجعة مهام هذا الأسبوع",
        body: `يا ${first}، ما أغلقت أي مهمة هذا الأسبوع وأنت مو بإجازة — راجع مهامك وأنجز ما تستطيع قبل نهاية الأسبوع.`,
    };
}
