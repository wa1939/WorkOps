import { describe, expect, it, vi } from "vitest";
import { GENERIC_BODY, GENERIC_TITLE, buildPushSender, markSubscriptionGone, sendPush, type PushEvent, type PushSubscriptionRecord, type PushWebPush } from "./push";

const enabledSubscription: PushSubscriptionRecord = {
    id: "sub-1",
    enabled: true,
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

const event: PushEvent = { id: "event-1", expiresAt: null };

function makeProvider(overrides: {
    result?: Record<string, unknown>;
    thrown?: unknown;
    payloadRef?: { payload?: string };
}): PushWebPush {
    return {
        async sendNotification(_subscription, payload, _options) {
            if (overrides.payloadRef) overrides.payloadRef.payload = payload;
            if (overrides.thrown !== undefined) throw overrides.thrown;
            return (overrides.result ?? { statusCode: 201 }) as never;
        },
    };
}

describe("push delivery adapter", () => {
    it("payload contains no private content", async () => {
        const payloadRef: { payload?: string } = {};
        const provider = makeProvider({ payloadRef });
        await sendPush(
            { pushSubscription: { update: vi.fn() } },
            { id: "evt_123", expiresAt: null },
            enabledSubscription,
            provider,
        );
        expect(payloadRef.payload).toBeDefined();
        const parsed = JSON.parse(payloadRef.payload as string);
        expect(parsed).toEqual({ notificationId: "evt_123", title: GENERIC_TITLE, body: GENERIC_BODY });
        expect(Object.keys(parsed)).toEqual(["notificationId", "title", "body"]);
        expect(parsed.body).toBe("You have a new update.");
    });

    it("410 disables endpoint", async () => {
        const update = vi.fn();
        const provider = makeProvider({ thrown: Object.assign(new Error("gone"), { statusCode: 410 }) });
        const outcome = await sendPush(
            { pushSubscription: { update } },
            event,
            enabledSubscription,
            provider,
        );
        expect(outcome).toMatchObject({ outcome: "failed", retryable: false, message: "subscription gone" });
        expect(update).toHaveBeenCalledWith({
            where: { id: "sub-1" },
            data: { enabled: false, revokedAt: expect.any(Date) },
        });
    });

    it("disabled device is skipped at send time", async () => {
        const sendNotification = vi.fn();
        const provider: PushWebPush = { sendNotification };
        const outcome = await sendPush(
            { pushSubscription: { update: vi.fn() } },
            event,
            { ...enabledSubscription, enabled: false },
            provider,
        );
        expect(outcome).toMatchObject({ outcome: "failed", retryable: false, message: "disabled" });
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it("429 retries with Retry-After", async () => {
        const provider = makeProvider({
            thrown: Object.assign(new Error("rate limited"), {
                statusCode: 429,
                headers: { "Retry-After": "30" },
            }),
        });
        const outcome = await sendPush(
            { pushSubscription: { update: vi.fn() } },
            event,
            enabledSubscription,
            provider,
        );
        expect(outcome).toMatchObject({
            outcome: "failed",
            retryable: true,
            message: expect.stringContaining("30"),
        });
    });

    it("accepted is not labeled displayed", async () => {
        const provider = makeProvider({
            result: { statusCode: 201, headers: { location: "https://fcm.googleapis.com/loc-1" } },
        });
        const outcome = await sendPush(
            { pushSubscription: { update: vi.fn() } },
            event,
            enabledSubscription,
            provider,
        );
        expect(outcome.outcome).toBe("accepted");
        const serialized = JSON.stringify(outcome);
        expect(serialized).not.toMatch(/displayed|"read"|delivered/i);
    });

    it("buildPushSender resolves destination to subscription and skips missing", async () => {
        const findUnique = vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(enabledSubscription);
        const sendNotification = vi.fn();
        const db = { pushSubscription: { findUnique, update: vi.fn() } };
        const sender = buildPushSender(db as never, makeProvider({}));
        const missing = await sender(
            { id: "d1", channel: "push", destinationKey: "nope" },
            { id: "e1", category: "task", sourceType: "task", sourceId: "t1" },
        );
        expect(missing).toMatchObject({ outcome: "failed", retryable: false });
        const delivered = await sender(
            { id: "d2", channel: "push", destinationKey: "sub-1" },
            { id: "e2", category: "task", sourceType: "task", sourceId: "t1" },
        );
        expect(delivered).toMatchObject({ outcome: "accepted" });
    });

    it("expired events skip the send with bounded TTL semantics", async () => {
        const sendNotification = vi.fn();
        const provider: PushWebPush = { sendNotification };
        const outcome = await sendPush(
            { pushSubscription: { update: vi.fn() } },
            { id: "evt_expired", expiresAt: new Date(Date.now() - 1000) },
            enabledSubscription,
            provider,
        );
        expect(outcome).toMatchObject({ outcome: "failed", retryable: false, message: "expired" });
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it("markSubscriptionGone disables with revocation timestamp", async () => {
        const update = vi.fn();
        await markSubscriptionGone({ pushSubscription: { update } }, "sub-9");
        expect(update).toHaveBeenCalledWith({
            where: { id: "sub-9" },
            data: { enabled: false, revokedAt: expect.any(Date) },
        });
    });
});
