"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
    applicationServerKeyFromBase64,
    createPushPlatform,
    getNotificationPermission,
    getPushSupport,
    PUSH_BLOCKED_MESSAGE,
    PUSH_ENDPOINT_CONFLICT_MESSAGE,
    PUSH_REGISTRATION_FAILURE_MESSAGE,
    PUSH_SUBSCRIPTIONS_ENDPOINT,
    PushPermission,
    PushPlatform,
    PushSubscriptionLike,
    serializePushSubscription,
    watchNotificationPermission,
} from "@/lib/pwa/push";

type ServerRegistrationState = "not-registered" | "pending" | "registered" | "failed";

export interface PushSettingsProps {
    platform?: PushPlatform;
    fetchImpl?: typeof fetch;
    vapidPublicKey?: string;
}

function browserPermissionLabel(permission: PushPermission): string {
    if (permission === "granted") return "Granted";
    if (permission === "denied") return "Blocked";
    return "Not granted";
}

function serverRegistrationLabel(state: ServerRegistrationState): string {
    if (state === "registered") return "Registered";
    if (state === "pending") return "Pending";
    if (state === "failed") return "Failed";
    return "Not registered";
}

export function PushSettings({ platform, fetchImpl, vapidPublicKey }: PushSettingsProps) {
    const activePlatform = useMemo(() => platform ?? createPushPlatform(), [platform]);
    const support = useMemo(() => getPushSupport(activePlatform), [activePlatform]);
    const [permission, setPermission] = useState<PushPermission>(() => getNotificationPermission(activePlatform));
    const [serverRegistration, setServerRegistration] = useState<ServerRegistrationState>("not-registered");
    const [subscription, setSubscription] = useState<PushSubscriptionLike | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    // Resolution order: prop → build-time env → runtime key endpoint. The
    // runtime fetch keeps deployments from needing a rebuild to rotate keys.
    const [runtimeKey, setRuntimeKey] = useState("");
    const buildKey = vapidPublicKey ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
    useEffect(() => {
        if (buildKey || (typeof window !== "undefined" && window.location.hostname === "localhost")) return;
        let disposed = false;
        void fetch("/api/notifications/push/public-key")
            .then((response) => (response.ok ? response.json() : null))
            .then((body: { publicKey?: unknown } | null) => {
                if (!disposed && body && typeof body.publicKey === "string") setRuntimeKey(body.publicKey);
            })
            .catch(() => undefined);
        return () => { disposed = true; };
    }, [buildKey]);
    const vapidKey = buildKey || runtimeKey;
    const request = fetchImpl ?? activePlatform.fetch;

    const installationId = () => {
        try {
            const key = "pwa-installation-id";
            let id = window.localStorage.getItem(key);
            if (!id) {
                id = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
                window.localStorage.setItem(key, id);
            }
            return id;
        } catch {
            return "web";
        }
    };

    useEffect(() => {
        let disposed = false;
        let removePermissionWatcher = () => {};

        void watchNotificationPermission(activePlatform, (nextPermission) => {
            if (disposed) return;
            setPermission(nextPermission);
            if (nextPermission === "denied") {
                setServerRegistration("not-registered");
                setSubscription(null);
                setMessage(PUSH_BLOCKED_MESSAGE);
            } else {
                setMessage((current) => (current === PUSH_BLOCKED_MESSAGE ? null : current));
            }
        }).then((cleanup) => {
            if (disposed) cleanup();
            else removePermissionWatcher = cleanup;
        });

        return () => {
            disposed = true;
            removePermissionWatcher();
        };
    }, [activePlatform]);

    const enablePush = async () => {
        if (!support.supported || !activePlatform.Notification || !activePlatform.serviceWorker || busy || permission === "denied") return;

        setBusy(true);
        setMessage(null);
        setServerRegistration("pending");

        try {
            const nextPermission = await activePlatform.Notification.requestPermission();
            setPermission(nextPermission);

            if (nextPermission === "denied") {
                setServerRegistration("not-registered");
                setMessage(PUSH_BLOCKED_MESSAGE);
                return;
            }
            if (nextPermission !== "granted") {
                setServerRegistration("not-registered");
                setMessage("Push permission was not granted. Choose Allow in your browser prompt to enable push notifications.");
                return;
            }

            setServerRegistration("pending");
            const registration = await activePlatform.serviceWorker.ready;
            const nextSubscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKeyFromBase64(vapidKey),
            });
            const payload = { ...serializePushSubscription(nextSubscription), installationId: installationId() };
            const response = await request(PUSH_SUBSCRIPTIONS_ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-installation-id": installationId(),
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                setServerRegistration("failed");
                if (response.status === 409) {
                    setSubscription(null);
                    setMessage(PUSH_ENDPOINT_CONFLICT_MESSAGE);
                } else {
                    setSubscription(null);
                    setMessage(PUSH_REGISTRATION_FAILURE_MESSAGE);
                }
                return;
            }

            setSubscription(nextSubscription);
            setServerRegistration("registered");
            setMessage("Push notifications are enabled for this account on this device.");
        } catch {
            setSubscription(null);
            setServerRegistration("failed");
            setMessage(PUSH_REGISTRATION_FAILURE_MESSAGE);
        } finally {
            setBusy(false);
        }
    };

    const disablePush = async () => {
        const currentSubscription = subscription;
        if (!currentSubscription || busy) return;

        setBusy(true);
        setMessage(null);
        try {
            const response = await request(PUSH_SUBSCRIPTIONS_ENDPOINT, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ endpoint: currentSubscription.endpoint }),
            });
            if (!response.ok) throw new Error("server revocation failed");

            await currentSubscription.unsubscribe();
            setSubscription(null);
            setServerRegistration("not-registered");
            setMessage("Push notifications are disabled for this account on this device.");
        } catch {
            setMessage("Unable to disable push notifications. The server subscription remains active until revocation succeeds.");
        } finally {
            setBusy(false);
        }
    };

    const blocked = permission === "denied";
    const enableLabel = serverRegistration === "failed" ? "Retry registration" : "Enable push";

    return (
        <section aria-labelledby="push-settings-title" className="space-y-4">
            <div>
                <h2 id="push-settings-title" className="text-lg font-semibold">Push notifications</h2>
                <p data-testid="push-supported-reason" className="text-sm text-muted-foreground">{support.supportedReason}</p>
            </div>

            <dl className="space-y-2 text-sm">
                <div>
                    <dt className="font-medium">Browser permission</dt>
                    <dd data-testid="browser-permission-state">{browserPermissionLabel(permission)}</dd>
                </div>
                <div>
                    <dt className="font-medium">Server registration</dt>
                    <dd data-testid="server-registration-state">{serverRegistrationLabel(serverRegistration)}</dd>
                </div>
            </dl>

            {!support.supported ? (
                <p role="status">Push notifications are unavailable on this device: {support.supportedReason}</p>
            ) : blocked ? (
                <p role="status">{PUSH_BLOCKED_MESSAGE}</p>
            ) : serverRegistration === "registered" ? (
                <button type="button" onClick={disablePush} disabled={busy}>
                    {busy ? "Disabling push..." : "Disable push"}
                </button>
            ) : (
                <button type="button" onClick={enablePush} disabled={busy}>
                    {busy && serverRegistration === "pending" ? "Registering push..." : enableLabel}
                </button>
            )}

            {message && message !== PUSH_BLOCKED_MESSAGE ? <p role="status">{message}</p> : null}
            <p className="text-xs text-muted-foreground">
                This control manages only this account&apos;s device subscription. The app&apos;s logout flow revokes subscriptions for logged-out accounts.
            </p>
        </section>
    );
}
