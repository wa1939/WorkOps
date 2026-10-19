import defaultWebPushModule, {
    type PushSubscription as WebPushSubscription,
    type RequestOptions as WebPushRequestOptions,
    type SendResult as WebPushSendResult,
} from "web-push";
import { decryptPushSubscriptionValue } from "../pwa/crypto";
import type { DeliverySender } from "./worker";

export const GENERIC_TITLE = "WorkOps";
export const GENERIC_BODY = "You have a new update.";
export const MAX_PUSH_TTL_SECONDS = 24 * 60 * 60;

type PushHeaders = Record<string, string | string[] | undefined>;

export type PushProviderResult = Partial<WebPushSendResult> & {
    statusCode?: number;
    headers?: PushHeaders;
    id?: string;
    location?: string;
};

export type PushWebPush = {
    sendNotification: (
        subscription: WebPushSubscription,
        payload: string,
        options?: WebPushRequestOptions,
    ) => Promise<PushProviderResult>;
};

export type PushSubscriptionRecord = {
    id: string;
    enabled: boolean;
    endpointEncrypted?: string | null;
    p256dhEncrypted?: string | null;
    authEncrypted?: string | null;
    endpoint?: string;
    p256dh?: string;
    auth?: string;
    keys?: {
        p256dh: string;
        auth: string;
    };
};

export type PushDatabase = {
    pushSubscription: {
        update: (args: {
            where: { id: string };
            data: { enabled: boolean; revokedAt: Date };
        }) => Promise<unknown>;
    };
};

export type PushSenderDatabase = PushDatabase & {
    pushSubscription: PushDatabase["pushSubscription"] & {
        findUnique: (args: { where: { id: string } }) => Promise<PushSubscriptionRecord | null>;
        findFirst: (args: {
            where: { userId: string; enabled: boolean; revokedAt: null };
            orderBy: { lastSeenAt: "desc" };
        }) => Promise<PushSubscriptionRecord | null>;
    };
};

export type PushEvent = {
    id: string;
    expiresAt?: Date | string | null;
};

export type PushDeliveryOutcome = Awaited<ReturnType<DeliverySender>>;

function headerValue(headers: PushHeaders | undefined, name: string): string | undefined {
    if (!headers) return undefined;
    const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
    if (!matchingKey) return undefined;
    const value = headers[matchingKey];
    if (Array.isArray(value)) return value[0];
    return value;
}

function statusCode(value: unknown): number | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = (value as { statusCode?: unknown }).statusCode;
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
}

function headers(value: unknown): PushHeaders | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = (value as { headers?: unknown }).headers;
    return candidate && typeof candidate === "object" ? candidate as PushHeaders : undefined;
}

function computePushTtl(expiresAt: PushEvent["expiresAt"], now = Date.now()): number {
    if (expiresAt === undefined || expiresAt === null) return MAX_PUSH_TTL_SECONDS;
    const expiryMs = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
    if (!Number.isFinite(expiryMs)) return MAX_PUSH_TTL_SECONDS;
    return Math.min(MAX_PUSH_TTL_SECONDS, Math.max(0, Math.floor((expiryMs - now) / 1000)));
}

function decryptOrPlain(encrypted: string | null | undefined, plain: string | undefined): string | undefined {
    if (encrypted) return decryptPushSubscriptionValue(encrypted);
    return plain;
}

function toWebPushSubscription(subscription: PushSubscriptionRecord): WebPushSubscription {
    const endpoint = decryptOrPlain(subscription.endpointEncrypted, subscription.endpoint);
    const p256dh = decryptOrPlain(subscription.p256dhEncrypted, subscription.p256dh ?? subscription.keys?.p256dh);
    const auth = decryptOrPlain(subscription.authEncrypted, subscription.auth ?? subscription.keys?.auth);
    if (!endpoint || !p256dh || !auth) {
        throw new Error("Incomplete push subscription");
    }
    return { endpoint, keys: { p256dh, auth } };
}

function providerId(result: PushProviderResult | undefined, event: PushEvent, subscription: PushSubscriptionRecord): string {
    const location = headerValue(result?.headers, "location") ?? result?.location;
    return location ?? result?.id ?? `${event.id}:${subscription.id}`;
}

function goneOutcome(): PushDeliveryOutcome {
    return { outcome: "failed", retryable: false, message: "subscription gone" };
}

async function normalizeProviderOutcome(
    db: PushDatabase,
    event: PushEvent,
    subscription: PushSubscriptionRecord,
    result: PushProviderResult | undefined,
    thrown?: unknown,
): Promise<PushDeliveryOutcome> {
    const status = statusCode(thrown ?? result);
    const responseHeaders = headers(thrown ?? result) ?? result?.headers;

    if (status === 404 || status === 410) {
        await markSubscriptionGone(db, subscription.id);
        return goneOutcome();
    }

    if (status === 429) {
        const retryAfter = headerValue(responseHeaders, "retry-after");
        return {
            outcome: "failed",
            retryable: true,
            message: retryAfter
                ? `push provider rate limited; retry-after ${retryAfter}`
                : "push provider rate limited",
        };
    }

    if (thrown) return { outcome: "unknown" };

    if (status === undefined || (status >= 200 && status < 300)) {
        // Web Push acceptance is provider acceptance only; it does not mean displayed or read.
        return { outcome: "accepted", providerId: providerId(result, event, subscription) };
    }

    return {
        outcome: "failed",
        retryable: status >= 500,
        message: `push provider returned ${status}`,
    };
}

/** Disable a subscription after the provider confirms that its endpoint is gone. */
export async function markSubscriptionGone(db: PushDatabase, subscriptionId: string, now = new Date()): Promise<void> {
    await db.pushSubscription.update({
        where: { id: subscriptionId },
        data: { enabled: false, revokedAt: now },
    });
}

/** Send only a generic, consented push notification to one stored subscription. */
export async function sendPush(
    db: PushDatabase,
    event: PushEvent,
    subscription: PushSubscriptionRecord,
    webPush: PushWebPush = defaultWebPush,
): Promise<PushDeliveryOutcome> {
    if (!subscription.enabled) {
        return { outcome: "failed", retryable: false, message: "disabled" };
    }

    const ttl = computePushTtl(event.expiresAt);
    if (ttl <= 0) {
        return { outcome: "failed", retryable: false, message: "expired" };
    }

    let subscriptionShape: WebPushSubscription;
    try {
        subscriptionShape = toWebPushSubscription(subscription);
    } catch {
        return { outcome: "unknown" };
    }

    const payload = JSON.stringify({
        notificationId: event.id,
        title: GENERIC_TITLE,
        body: GENERIC_BODY,
    });
    const options: WebPushRequestOptions = { TTL: ttl, headers: {} };

    try {
        const result = await webPush.sendNotification(subscriptionShape, payload, options);
        return await normalizeProviderOutcome(db, event, subscription, result);
    } catch (error) {
        try {
            return await normalizeProviderOutcome(db, event, subscription, undefined, error);
        } catch {
            return { outcome: "unknown" };
        }
    }
}

/** Build the worker seam that resolves a delivery destination to its subscription. */
export function buildPushSender(db: PushSenderDatabase, webPush: PushWebPush = defaultWebPush): DeliverySender {
    return async (delivery, event) => {
        let subscription: PushSubscriptionRecord | null;
        try {
            // Producers address push deliveries as `user:<id>`; fan out to all
            // of that user's enabled devices. A raw subscription id is also
            // accepted for direct addressing.
            if (delivery.destinationKey.startsWith("user:")) {
                subscription = await db.pushSubscription.findFirst({
                    where: { userId: delivery.destinationKey.slice("user:".length), enabled: true, revokedAt: null },
                    orderBy: { lastSeenAt: "desc" },
                });
            } else {
                subscription = await db.pushSubscription.findUnique({ where: { id: delivery.destinationKey } });
            }
        } catch {
            return { outcome: "unknown" };
        }
        if (!subscription) {
            return { outcome: "failed", retryable: false, message: "subscription not found" };
        }
        return sendPush(db, event, subscription, webPush);
    };
}

function defaultVapidDetails(): WebPushRequestOptions["vapidDetails"] | undefined {
    const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
    const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    if (!subject || !publicKey || !privateKey) return undefined;
    return { subject, publicKey, privateKey };
}

/** The default provider keeps VAPID material server-side and never places it in payloads. */
export const defaultWebPush: PushWebPush = {
    sendNotification(subscription, payload, options) {
        const vapidDetails = defaultVapidDetails();
        return defaultWebPushModule.sendNotification(subscription, payload, {
            ...(options ?? {}),
            ...(vapidDetails ? { vapidDetails } : {}),
        });
    },
};
