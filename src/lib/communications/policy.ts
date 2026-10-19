export type Category =
    | "account_security"
    | "task"
    | "digest"
    | "suggestion"
    | "weekly_recording_gap"
    | "weekly_completion_checkin"
    | "stale_task_update"
    | (string & {});

export type Channel = "in_app" | "email" | "push";

export type DispatchSuppressionReason =
    | "category_disabled"
    | "channel_disabled"
    | "membership_inactive"
    | "push_not_consented"
    | "snoozed";

export interface DispatchInput {
    category: Category;
    channel: Channel;
    quietHoursActive: boolean;
    memberActive: boolean;
    pushConsented: boolean;
}

export interface DispatchPreferences {
    emailEnabled: boolean;
    inAppEnabled: boolean;
    pushEnabled: boolean;
    snoozedUntil?: Date | null;
    now: Date;
}

export type DispatchDecision =
    | { action: "send" }
    | { action: "delay" }
    | { action: "suppress"; reason: DispatchSuppressionReason };

const ACCOUNT_SECURITY_CATEGORY = "account_security";

/**
 * Resolve the durable delivery decision without reading or writing external state.
 * Account-security email and in-app messages bypass ordinary notification toggles,
 * but push still requires the recipient's explicit push consent.
 */
export function resolveDispatch(input: DispatchInput, prefs: DispatchPreferences): DispatchDecision {
    const isAccountSecurity = input.category === ACCOUNT_SECURITY_CATEGORY;

    if (!input.memberActive) {
        return { action: "suppress", reason: "membership_inactive" };
    }

    if (!isAccountSecurity && prefs.snoozedUntil && prefs.snoozedUntil.getTime() > prefs.now.getTime()) {
        return { action: "suppress", reason: "snoozed" };
    }

    if (input.channel === "push") {
        if (!prefs.pushEnabled) {
            return { action: "suppress", reason: "channel_disabled" };
        }
        if (!input.pushConsented) {
            return { action: "suppress", reason: "push_not_consented" };
        }
    } else if (!isAccountSecurity && input.channel === "email" && !prefs.emailEnabled) {
        return { action: "suppress", reason: "category_disabled" };
    } else if (!isAccountSecurity && input.channel === "in_app" && !prefs.inAppEnabled) {
        return { action: "suppress", reason: "channel_disabled" };
    }

    if (!isAccountSecurity && input.quietHoursActive) {
        return { action: "delay" };
    }

    return { action: "send" };
}
