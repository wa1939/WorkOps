import { describe, expect, it } from "vitest";
import { resolveDispatch, type Category, type Channel, type DispatchPreferences } from "./policy";

const now = new Date("2026-09-07T09:00:00.000Z");

function preferences(overrides: Partial<DispatchPreferences> = {}): DispatchPreferences {
    return {
        emailEnabled: true,
        inAppEnabled: true,
        pushEnabled: false,
        snoozedUntil: null,
        now,
        ...overrides,
    };
}

function request(overrides: Partial<{
    category: Category;
    channel: Channel;
    quietHoursActive: boolean;
    memberActive: boolean;
    pushConsented: boolean;
}> = {}) {
    return {
        category: "task" as Category,
        channel: "email" as Channel,
        quietHoursActive: false,
        memberActive: true,
        pushConsented: false,
        ...overrides,
    };
}

describe("resolveDispatch", () => {
    it("account security cannot be preference-disabled", () => {
        expect(resolveDispatch(request({ category: "account_security" }), preferences({ emailEnabled: false }))).toEqual({ action: "send" });
    });

    it("quiet hours delay rather than lose delivery", () => {
        const decision = resolveDispatch(
            request({ category: "task", channel: "email", quietHoursActive: true }),
            preferences(),
        );

        expect(decision).toEqual({ action: "delay" });
        expect(decision.action).not.toBe("suppress");
    });

    it("unsubscribed category suppressed with reason", () => {
        expect(
            resolveDispatch(request({ category: "digest", channel: "email" }), preferences({ emailEnabled: false })),
        ).toEqual({ action: "suppress", reason: "category_disabled" });
    });

    it("snoozed noncritical suggestion is suppressed but account security is not", () => {
        const snoozedUntil = new Date("2026-09-07T10:00:00.000Z");

        expect(
            resolveDispatch(request({ category: "suggestion" }), preferences({ snoozedUntil })),
        ).toEqual({ action: "suppress", reason: "snoozed" });
        expect(
            resolveDispatch(request({ category: "account_security" }), preferences({ snoozedUntil })),
        ).toEqual({ action: "send" });
    });

    it("revoked membership blocks dispatch", () => {
        const expected = { action: "suppress", reason: "membership_inactive" } as const;

        expect(resolveDispatch(request({ memberActive: false }), preferences())).toEqual(expected);
        expect(
            resolveDispatch(request({ category: "account_security", memberActive: false }), preferences()),
        ).toEqual(expected);
    });
});
