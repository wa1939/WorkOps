export const PUSH_SUBSCRIPTIONS_ENDPOINT = "/api/notifications/push/subscriptions";

export const PUSH_BLOCKED_MESSAGE =
    "Push notifications are blocked. Reset notification permission in your browser settings to enable push notifications.";
export const PUSH_REGISTRATION_FAILURE_MESSAGE =
    "Permission granted but registration failed. Retry registration to enable push notifications.";
export const PUSH_ENDPOINT_CONFLICT_MESSAGE =
    "endpoint already registered on this device for another account";

export type PushPermission = NotificationPermission;

export interface PushNotificationApi {
    permission: PushPermission;
    requestPermission: () => Promise<PushPermission>;
}

export interface PushSubscriptionLike {
    endpoint: string;
    toJSON: () => {
        endpoint?: string;
        keys?: Record<string, string>;
    };
    unsubscribe: () => Promise<boolean>;
}

export interface PushManagerLike {
    subscribe: (options: {
        userVisibleOnly: boolean;
        applicationServerKey: Uint8Array;
    }) => Promise<PushSubscriptionLike>;
    getSubscription?: () => Promise<PushSubscriptionLike | null>;
}

export interface PushServiceWorkerRegistrationLike {
    pushManager: PushManagerLike;
}

export interface PushPermissionStatusLike {
    state: PermissionState;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
    onchange?: (() => void) | null;
}

export interface PushPlatform {
    serviceWorker?: {
        ready: Promise<PushServiceWorkerRegistrationLike>;
    };
    PushManager?: unknown;
    Notification?: PushNotificationApi;
    permissions?: {
        query: (descriptor: { name: string }) => Promise<PushPermissionStatusLike>;
    };
    userAgent?: string;
    isStandalone?: boolean;
    addEventListener?: (type: string, listener: () => void) => void;
    removeEventListener?: (type: string, listener: () => void) => void;
    fetch: typeof fetch;
}

export interface PushSupport {
    supported: boolean;
    supportedReason: string;
}

function isIosUserAgent(userAgent: string): boolean {
    return /iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent));
}

function isStandaloneDisplayMode(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(display-mode: standalone)").matches;
}

export function createPushPlatform(): PushPlatform {
    const navigatorRef = typeof navigator === "undefined" ? undefined : navigator;
    const notification = typeof globalThis.Notification === "undefined" ? undefined : globalThis.Notification;
    const pushManager = typeof globalThis.PushManager === "undefined" ? undefined : globalThis.PushManager;
    const serviceWorker = navigatorRef?.serviceWorker as unknown as PushPlatform["serviceWorker"];
    const fetchImpl = globalThis.fetch.bind(globalThis);
    const standalone = Boolean((navigatorRef as Navigator & { standalone?: boolean } | undefined)?.standalone) || isStandaloneDisplayMode();

    return {
        serviceWorker,
        PushManager: pushManager,
        Notification: notification as PushNotificationApi | undefined,
        permissions: navigatorRef?.permissions as unknown as PushPlatform["permissions"],
        userAgent: navigatorRef?.userAgent ?? "",
        isStandalone: standalone,
        addEventListener: typeof window === "undefined" ? undefined : window.addEventListener.bind(window),
        removeEventListener: typeof window === "undefined" ? undefined : window.removeEventListener.bind(window),
        fetch: fetchImpl,
    };
}

export function getNotificationPermission(platform: Pick<PushPlatform, "Notification">): PushPermission {
    return platform.Notification?.permission ?? "default";
}

export function getPushSupport(platform: Pick<PushPlatform, "serviceWorker" | "PushManager" | "Notification" | "userAgent" | "isStandalone">): PushSupport {
    if (!platform.serviceWorker) {
        return { supported: false, supportedReason: "This browser does not support service workers, so push notifications are unavailable." };
    }
    if (!platform.PushManager) {
        return { supported: false, supportedReason: "This browser does not support the Push API, so push notifications are unavailable." };
    }
    if (!platform.Notification) {
        return { supported: false, supportedReason: "This browser does not support notification permissions, so push notifications are unavailable." };
    }
    if (isIosUserAgent(platform.userAgent ?? "") && !platform.isStandalone) {
        return { supported: false, supportedReason: "On iOS, add this app to your Home Screen and open it there before enabling push notifications." };
    }
    return { supported: true, supportedReason: "Push notifications are supported on this device." };
}

export function applicationServerKeyFromBase64(value: string): Uint8Array {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    if (!padded) return new Uint8Array();
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function serializePushSubscription(subscription: PushSubscriptionLike): {
    endpoint: string;
    keys: Record<string, string>;
} {
    const serialized = subscription.toJSON();
    return {
        endpoint: serialized.endpoint ?? subscription.endpoint,
        keys: serialized.keys ?? {},
    };
}

export async function watchNotificationPermission(
    platform: PushPlatform,
    onChange: (permission: PushPermission) => void,
): Promise<() => void> {
    const cleanups: Array<() => void> = [];
    const emit = () => onChange(getNotificationPermission(platform));

    if (platform.addEventListener && platform.removeEventListener) {
        platform.addEventListener("focus", emit);
        platform.addEventListener("visibilitychange", emit);
        cleanups.push(() => platform.removeEventListener?.("focus", emit));
        cleanups.push(() => platform.removeEventListener?.("visibilitychange", emit));
    }

    try {
        const permissionStatus = await platform.permissions?.query({ name: "notifications" });
        if (permissionStatus?.addEventListener && permissionStatus.removeEventListener) {
            permissionStatus.addEventListener("change", emit);
            cleanups.push(() => permissionStatus.removeEventListener?.("change", emit));
        } else if (permissionStatus) {
            const previousOnChange = permissionStatus.onchange;
            permissionStatus.onchange = emit;
            cleanups.push(() => {
                permissionStatus.onchange = previousOnChange ?? null;
            });
        }
    } catch {
        // Permission observation is progressive enhancement. The explicit user action remains authoritative.
    }

    return () => cleanups.forEach((cleanup) => cleanup());
}
