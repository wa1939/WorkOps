const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const RIYADH_OFFSET_MS = 3 * HOUR_MS;
const DEFAULT_STALE_TASK_THRESHOLD_MS = 7 * DAY_MS;

export const WEEKLY_ELIGIBILITY_CATEGORIES = [
    "weekly_recording_gap",
    "weekly_completion_checkin",
    "stale_task_update",
] as const;

export type WeeklyEligibilityCategory = (typeof WEEKLY_ELIGIBILITY_CATEGORIES)[number];

export interface WeeklyWindow {
    start: Date;
    end: Date;
}

export interface WeeklyLeavePeriod {
    startAt: Date;
    endAt: Date;
}

export interface WeeklyEligibilityUser {
    userId: string;
    isActive: boolean;
    createdAt: Date;
    leaves?: readonly WeeklyLeavePeriod[];
}

export interface WeeklyTaskActivity {
    status: string;
    lastActivityAt?: Date;
    /** `updatedAt` is accepted as a reader-friendly alias for lastActivityAt. */
    updatedAt?: Date;
}

export interface WeeklyRecordingActivity {
    createdTaskCount: number;
    completedTaskCount: number;
    progressCommentCount: number;
}

export type WeeklyReaderValue<T> = T | Promise<T>;

export interface WeeklyActivityReader {
    /** Tasks created by the user during the supplied window. */
    createdTaskCount(userId: string, window: WeeklyWindow): WeeklyReaderValue<number>;
    /** Tasks moved to DONE by the user during the supplied window. */
    completedTaskCount(userId: string, window: WeeklyWindow): WeeklyReaderValue<number>;
    /** Substantive comments by the user on their assigned tasks during the window. */
    progressCommentCount(userId: string, window: WeeklyWindow): WeeklyReaderValue<number>;

    /** Optional explicit reader for assigned DONE tasks in a WTD window. */
    assignedDoneTaskCount?(userId: string, window: WeeklyWindow): WeeklyReaderValue<number>;
    /** Active assigned tasks and their latest activity for stale-update checks. */
    activeAssignedTasks?(userId: string): WeeklyReaderValue<readonly WeeklyTaskActivity[]>;
    /** Alias supported for readers that name this query from the task's perspective. */
    assignedActiveTasks?(userId: string): WeeklyReaderValue<readonly WeeklyTaskActivity[]>;
    /** Optional snooze reader when config.snoozeReader is not supplied. */
    isSnoozed?(
        userId: string,
        category: WeeklyEligibilityCategory,
        now: Date,
    ): WeeklyReaderValue<boolean>;

    /** Optional user source for callers that keep users beside the activity reader. */
    users?: readonly WeeklyEligibilityUser[];
}

export interface WeeklyCutoff {
    /** Riyadh weekday: Sunday = 0 through Saturday = 6. */
    weekday?: number;
    /** Alias for weekday. */
    dayOfWeek?: number;
    /** Alias for weekday. */
    day?: number;
    hour: number;
    minute?: number;
    second?: number;
}

export type WeeklySnoozeReader =
    | ((userId: string, category: WeeklyEligibilityCategory, now: Date) => WeeklyReaderValue<boolean>)
    | {
          isSnoozed(
              userId: string,
              category: WeeklyEligibilityCategory,
              now: Date,
          ): WeeklyReaderValue<boolean>;
      }
    | {
          snoozed(
              userId: string,
              category: WeeklyEligibilityCategory,
              now: Date,
          ): WeeklyReaderValue<boolean>;
      };

export type WeeklyLeaveReader =
    | ((userId: string, window: WeeklyWindow) => WeeklyReaderValue<readonly WeeklyLeavePeriod[]>)
    | {
          leavesFor(userId: string, window: WeeklyWindow): WeeklyReaderValue<readonly WeeklyLeavePeriod[]>;
      }
    | {
          getLeavePeriods(userId: string, window: WeeklyWindow): WeeklyReaderValue<readonly WeeklyLeavePeriod[]>;
      };

export interface WeeklyEligibilityConfig {
    users?: readonly WeeklyEligibilityUser[];
    cutoff?: WeeklyCutoff;
    /** Alias for cutoff for callers with a more explicit config name. */
    weeklyCutoff?: WeeklyCutoff;
    staleTaskThresholdMs?: number;
    /** Alias for staleTaskThresholdMs. */
    stalenessThresholdMs?: number;
    /** Alias for staleTaskThresholdMs. */
    staleTaskThreshold?: number;
    snoozeReader?: WeeklySnoozeReader;
    leaveReader?: WeeklyLeaveReader;
}

export interface WeeklyEligibilityResult {
    userId: string;
    eligibleCategories: WeeklyEligibilityCategory[];
    reasons: string[];
}

export type RecordingActivityClassification = "recording_gap" | "recorded_activity";

/**
 * Classify recording from all qualifying activity, not from completion count
 * alone. A progress comment is enough to prove that work was recorded.
 */
export function classifyRecordingActivity(
    activity: WeeklyRecordingActivity,
): RecordingActivityClassification {
    return activity.createdTaskCount > 0 ||
        activity.completedTaskCount > 0 ||
        activity.progressCommentCount > 0
        ? "recorded_activity"
        : "recording_gap";
}

export function hasQualifyingRecordingActivity(activity: WeeklyRecordingActivity): boolean {
    return classifyRecordingActivity(activity) === "recorded_activity";
}

/** Start of the current Sunday–Saturday Riyadh calendar week as a UTC Date. */
export function currentRiyadhWeekWindow(now: Date): WeeklyWindow {
    const shifted = new Date(now.getTime() + RIYADH_OFFSET_MS);
    const sundayMidnightUtc =
        Date.UTC(
            shifted.getUTCFullYear(),
            shifted.getUTCMonth(),
            shifted.getUTCDate(),
        ) - shifted.getUTCDay() * DAY_MS;
    const start = new Date(sundayMidnightUtc - RIYADH_OFFSET_MS);
    return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

export function priorCompletedRiyadhWeekWindow(now: Date): WeeklyWindow {
    const current = currentRiyadhWeekWindow(now);
    return {
        start: new Date(current.start.getTime() - 7 * DAY_MS),
        end: current.start,
    };
}

function currentWeekToDateWindow(now: Date, current: WeeklyWindow): WeeklyWindow {
    return { start: current.start, end: new Date(now.getTime()) };
}

function fullWorkingWeekLeave(window: WeeklyWindow, leaves: readonly WeeklyLeavePeriod[]): boolean {
    for (let weekday = 0; weekday < 5; weekday++) {
        const dayStart = new Date(window.start.getTime() + weekday * DAY_MS);
        const dayEnd = new Date(dayStart.getTime() + DAY_MS);
        const covered = leaves.some(
            (leave) => new Date(leave.startAt) < dayEnd && new Date(leave.endAt) >= dayStart,
        );
        if (!covered) return false;
    }
    return true;
}

function cutoffInstant(current: WeeklyWindow, cutoff: WeeklyCutoff | undefined): Date {
    const selected = cutoff ?? { weekday: 0, hour: 17 };
    const weekday = selected.weekday ?? selected.dayOfWeek ?? selected.day ?? 0;
    const minute = selected.minute ?? 0;
    const second = selected.second ?? 0;
    return new Date(
        current.start.getTime() +
            weekday * DAY_MS +
            selected.hour * HOUR_MS +
            minute * MINUTE_MS +
            second * 1000,
    );
}

function staleThreshold(config: WeeklyEligibilityConfig): number {
    return config.staleTaskThresholdMs ??
        config.stalenessThresholdMs ??
        config.staleTaskThreshold ??
        DEFAULT_STALE_TASK_THRESHOLD_MS;
}

async function readLeaves(
    reader: WeeklyActivityReader,
    config: WeeklyEligibilityConfig,
    user: WeeklyEligibilityUser,
    window: WeeklyWindow,
): Promise<readonly WeeklyLeavePeriod[]> {
    if (config.leaveReader) {
        const leaveReader = config.leaveReader;
        if (typeof leaveReader === "function") return (await leaveReader(user.userId, window)) ?? [];
        if ("leavesFor" in leaveReader) return (await leaveReader.leavesFor(user.userId, window)) ?? [];
        return (await leaveReader.getLeavePeriods(user.userId, window)) ?? [];
    }
    return user.leaves ?? [];
}

async function isSnoozed(
    reader: WeeklyActivityReader,
    config: WeeklyEligibilityConfig,
    userId: string,
    category: WeeklyEligibilityCategory,
    now: Date,
): Promise<boolean> {
    const snoozeReader = config.snoozeReader ?? reader.isSnoozed;
    if (!snoozeReader) return false;
    if (typeof snoozeReader === "function") return Boolean(await snoozeReader(userId, category, now));
    if ("isSnoozed" in snoozeReader) {
        return Boolean(await snoozeReader.isSnoozed(userId, category, now));
    }
    return Boolean(await snoozeReader.snoozed(userId, category, now));
}

async function readActiveAssignedTasks(
    reader: WeeklyActivityReader,
    userId: string,
): Promise<readonly WeeklyTaskActivity[]> {
    if (reader.activeAssignedTasks) return (await reader.activeAssignedTasks(userId)) ?? [];
    if (reader.assignedActiveTasks) return (await reader.assignedActiveTasks(userId)) ?? [];
    return [];
}

async function readAssignedDoneCount(
    reader: WeeklyActivityReader,
    userId: string,
    window: WeeklyWindow,
): Promise<number> {
    if (reader.assignedDoneTaskCount) return await reader.assignedDoneTaskCount(userId, window);
    return await reader.completedTaskCount(userId, window);
}

function isTaskActive(status: string): boolean {
    const normalized = status.toUpperCase();
    return normalized !== "DONE" && normalized !== "CANCELED" && normalized !== "CANCELLED";
}

async function categoryIsExcluded(
    reader: WeeklyActivityReader,
    config: WeeklyEligibilityConfig,
    user: WeeklyEligibilityUser,
    category: WeeklyEligibilityCategory,
    relevantWindow: WeeklyWindow,
    now: Date,
): Promise<boolean> {
    if (!user.isActive) return true;
    if (new Date(user.createdAt).getTime() > relevantWindow.start.getTime()) return true;
    if (await isSnoozed(reader, config, user.userId, category, now)) return true;
    const leaves = await readLeaves(reader, config, user, relevantWindow);
    return fullWorkingWeekLeave(relevantWindow, leaves);
}

export async function evaluateWeeklyEligibility(
    reader: WeeklyActivityReader,
    config: WeeklyEligibilityConfig,
    now: Date,
): Promise<WeeklyEligibilityResult[]> {
    const currentWindow = currentRiyadhWeekWindow(now);
    const priorWindow = priorCompletedRiyadhWeekWindow(now);
    const users = config.users ?? reader.users ?? [];
    const checkinWindow = currentWeekToDateWindow(now, currentWindow);
    const checkinAllowed = new Date(now).getTime() >= cutoffInstant(currentWindow, config.cutoff ?? config.weeklyCutoff).getTime();
    const staleAt = new Date(now.getTime() - staleThreshold(config));

    return Promise.all(users.map(async (user) => {
        const result: WeeklyEligibilityResult = {
            userId: user.userId,
            eligibleCategories: [],
            reasons: [],
        };

        if (!user.isActive) return result;

        if (!await categoryIsExcluded(reader, config, user, "weekly_recording_gap", priorWindow, now)) {
            const [createdTaskCount, completedTaskCount, progressCommentCount] = await Promise.all([
                reader.createdTaskCount(user.userId, priorWindow),
                reader.completedTaskCount(user.userId, priorWindow),
                reader.progressCommentCount(user.userId, priorWindow),
            ]);
            const activity = { createdTaskCount, completedTaskCount, progressCommentCount };
            if (classifyRecordingActivity(activity) === "recording_gap") {
                result.eligibleCategories.push("weekly_recording_gap");
                result.reasons.push("No qualifying work was recorded in the prior completed Riyadh week.");
            }
        }

        if (checkinAllowed && !await categoryIsExcluded(
            reader,
            config,
            user,
            "weekly_completion_checkin",
            currentWindow,
            now,
        )) {
            const doneCount = await readAssignedDoneCount(reader, user.userId, checkinWindow);
            if (doneCount === 0) {
                result.eligibleCategories.push("weekly_completion_checkin");
                result.reasons.push("No assigned DONE tasks were recorded in the current week-to-date.");
            }
        }

        if (!await categoryIsExcluded(reader, config, user, "stale_task_update", currentWindow, now)) {
            const tasks = await readActiveAssignedTasks(reader, user.userId);
            const hasStaleTask = tasks.some((task) => {
                if (!isTaskActive(task.status)) return false;
                const lastActivityAt = task.lastActivityAt ?? task.updatedAt;
                return Boolean(lastActivityAt && new Date(lastActivityAt).getTime() < staleAt.getTime());
            });
            if (hasStaleTask) {
                result.eligibleCategories.push("stale_task_update");
                result.reasons.push("An active assigned task has not changed within the configured staleness threshold.");
            }
        }

        return result;
    }));
}
