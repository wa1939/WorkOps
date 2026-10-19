import { describe, expect, it } from "vitest";
import {
    evaluateWeeklyEligibility,
    type WeeklyActivityReader,
    type WeeklyEligibilityConfig,
    type WeeklyEligibilityUser,
    type WeeklyTaskActivity,
} from "./weekly-eligibility";

const thursday = new Date("2026-08-27T11:00:00Z"); // 14:00 Riyadh
const monday = new Date("2026-08-24T09:00:00Z"); // 12:00 Riyadh

function user(overrides: Partial<WeeklyEligibilityUser> = {}): WeeklyEligibilityUser {
    return {
        userId: "u1",
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        leaves: [],
        ...overrides,
    };
}

function reader(overrides: {
    created?: number;
    completed?: number;
    progress?: number;
    tasks?: WeeklyTaskActivity[];
} = {}): WeeklyActivityReader {
    return {
        createdTaskCount: async () => overrides.created ?? 0,
        completedTaskCount: async () => overrides.completed ?? 0,
        progressCommentCount: async () => overrides.progress ?? 0,
        activeAssignedTasks: async () => overrides.tasks ?? [],
    };
}

function config(
    users: WeeklyEligibilityUser[],
    overrides: Partial<WeeklyEligibilityConfig> = {},
): WeeklyEligibilityConfig {
    return {
        users,
        cutoff: { weekday: 0, hour: 17 },
        staleTaskThresholdMs: 7 * 24 * 60 * 60 * 1000,
        ...overrides,
    };
}

describe("evaluateWeeklyEligibility", () => {
    it("recording gap requires no qualifying work not zero completions", async () => {
        const withProgress = user({ userId: "progress" });
        const noActivity = user({ userId: "empty" });
        const results = await evaluateWeeklyEligibility(
            {
                createdTaskCount: async (userId) => (userId === "empty" ? 0 : 0),
                completedTaskCount: async () => 0,
                progressCommentCount: async (userId) => (userId === "progress" ? 3 : 0),
                activeAssignedTasks: async () => [],
            },
            config([withProgress, noActivity]),
            thursday,
        );

        expect(results.find((result) => result.userId === "progress")?.eligibleCategories).not.toContain("weekly_recording_gap");
        expect(results.find((result) => result.userId === "empty")?.eligibleCategories).toContain("weekly_recording_gap");
    });

    it("checkin before cutoff is never eligible", async () => {
        const [result] = await evaluateWeeklyEligibility(
            reader(),
            config([user()], { cutoff: { weekday: 0, hour: 17 } }),
            new Date("2026-08-23T13:00:00Z"), // Sunday 16:00 Riyadh
        );

        expect(result.eligibleCategories).not.toContain("weekly_completion_checkin");
    });

    it("newcomer exempt in first active week", async () => {
        const [result] = await evaluateWeeklyEligibility(
            reader(),
            config([user({ createdAt: new Date("2026-08-24T00:00:00Z") })]),
            thursday,
        );

        expect(result.eligibleCategories).not.toContain("weekly_recording_gap");
    });

    it("user on leave for the whole window is excluded", async () => {
        const [result] = await evaluateWeeklyEligibility(
            reader({
                tasks: [{ status: "DOING", lastActivityAt: new Date("2026-08-01T00:00:00Z") }],
            }),
            config([
                user({
                    leaves: [{ startAt: new Date("2026-08-15T21:00:00Z"), endAt: new Date("2026-08-29T21:00:00Z") }],
                }),
            ]),
            thursday,
        );

        expect(result.eligibleCategories).toEqual([]);
    });

    it("snoozed category is excluded but others are not", async () => {
        const [result] = await evaluateWeeklyEligibility(
            reader({
                tasks: [{ status: "DOING", lastActivityAt: new Date("2026-08-01T00:00:00Z") }],
            }),
            config([user()], {
                snoozeReader: async (_userId, category) => category === "weekly_recording_gap",
            }),
            thursday,
        );

        expect(result.eligibleCategories).not.toContain("weekly_recording_gap");
        expect(result.eligibleCategories).toContain("weekly_completion_checkin");
        expect(result.eligibleCategories).toContain("stale_task_update");
    });

    it("Monday cannot run Thursday checkin early", async () => {
        const [result] = await evaluateWeeklyEligibility(
            reader(),
            config([user()], { cutoff: { weekday: 4, hour: 17 } }),
            monday,
        );

        expect(result.eligibleCategories).not.toContain("weekly_completion_checkin");
    });
});
