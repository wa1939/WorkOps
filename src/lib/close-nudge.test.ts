import { describe, it, expect } from "vitest";
import { classifyRecordingActivity, type WeeklyRecordingActivity } from "./communications/weekly-eligibility";
import { selectNudgeTargets, buildNudgeCopy, NUDGE_TYPE, NUDGE_LINK, type NudgeCandidate } from "./close-nudge";

const window = {
    weekStart: new Date("2026-08-22T21:00:00Z"), // Sun 23 Aug 00:00 Riyadh
    weekEnd: new Date("2026-08-29T21:00:00Z"),
};
const now = new Date("2026-08-27T11:00:00Z"); // Thursday 14:00 Riyadh

function candidate(overrides: Partial<NudgeCandidate>): NudgeCandidate {
    return {
        id: "u1", name: "وليد", email: "w@example.test",
        quietUntil: null, doneThisWeek: 0, leaves: [], alreadyNudgedThisWeek: false,
        recordingActivity: { createdTaskCount: 0, completedTaskCount: 0, progressCommentCount: 0 },
        ...overrides,
    };
}

describe("selectNudgeTargets", () => {
    it("targets an active user with zero closes and no leave", () => {
        expect(selectNudgeTargets([candidate({})], window, now)).toHaveLength(1);
    });
    it("does not treat a current-week close as prior-week recording", () => {
        expect(selectNudgeTargets([candidate({ doneThisWeek: 2 })], window, now)).toHaveLength(1);
    });
    it("recording gap is distinct from completion checkin", () => {
        const activity: WeeklyRecordingActivity = {
            createdTaskCount: 0,
            completedTaskCount: 0,
            progressCommentCount: 3,
        };
        expect(classifyRecordingActivity(activity)).toBe("recorded_activity");
        expect(selectNudgeTargets([candidate({ recordingActivity: activity })], window, now)).toHaveLength(0);
    });
    it("skips snoozed users", () => {
        expect(selectNudgeTargets([candidate({ quietUntil: new Date("2026-09-01T00:00:00Z") })], window, now)).toHaveLength(0);
    });
    it("skips already-nudged users (weekly idempotency)", () => {
        expect(selectNudgeTargets([candidate({ alreadyNudgedThisWeek: true })], window, now)).toHaveLength(0);
    });
    it("skips leave covering >= 3 Sun–Thu workdays, keeps 2-day leave", () => {
        const threeDays = [{ startAt: new Date("2026-08-22T21:00:00Z"), endAt: new Date("2026-08-25T20:59:00Z") }]; // Sun-Tue
        const twoDays = [{ startAt: new Date("2026-08-22T21:00:00Z"), endAt: new Date("2026-08-24T20:59:00Z") }]; // Sun-Mon
        expect(selectNudgeTargets([candidate({ leaves: threeDays })], window, now)).toHaveLength(0);
        expect(selectNudgeTargets([candidate({ leaves: twoDays })], window, now)).toHaveLength(1);
    });
});

describe("buildNudgeCopy", () => {
    it("greets by first name with the agreed copy and constants are wired", () => {
        const copy = buildNudgeCopy("سارة العتيبي");
        expect(copy.title).toBe("ما سجّلت أي إنجاز هذا الأسبوع");
        expect(copy.body).toContain("سارة");
        expect(copy.body).toContain("صباح");
        expect(NUDGE_TYPE).toBe("close_nudge");
        expect(NUDGE_LINK).toBe("/?sabah=record-week");
    });
});
