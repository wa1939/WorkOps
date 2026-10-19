import { useCallback, useEffect, useState } from "react";

export type OnlineNavigator = Pick<Navigator, "onLine">;

export type UpdateState =
    | { kind: "idle" }
    | { kind: "update-available"; canReloadImmediately: boolean };

export type AppStatusOptions = {
    /** Returns true when the user has unsaved work; defers auto-apply of updates. */
    hasUnsavedWork?: () => boolean;
    /** Returns true when a chat stream or other background task is active. */
    isStreaming?: () => boolean;
    unreadCount?: number;
};

/** True when a submit may proceed; false when offline (call before optimistic UI). */
export function assertOnlineBeforeSubmit(navigatorLike: OnlineNavigator): boolean {
    return navigatorLike.onLine;
}

export function useOnlineStatus(navigatorLike: OnlineNavigator = navigator): boolean {
    const [online, setOnline] = useState(navigatorLike.onLine);

    useEffect(() => {
        const goOnline = () => setOnline(true);
        const goOffline = () => setOnline(false);
        window.addEventListener("online", goOnline);
        window.addEventListener("offline", goOffline);
        setOnline(navigatorLike.onLine);
        return () => {
            window.removeEventListener("online", goOnline);
            window.removeEventListener("offline", goOffline);
        };
    }, [navigatorLike]);

    return online;
}

export type ServiceWorkerLike = {
    addEventListener(type: string, listener: () => void): void;
    postMessage(data: unknown): void;
};

export type ServiceWorkerRegistrationLike = {
    addEventListener(type: string, listener: () => void): void;
    installing?: ServiceWorkerLike | null;
    waiting?: ServiceWorkerLike | null;
};

export function watchForUpdate(
    registration: ServiceWorkerRegistrationLike,
    onUpdateAvailable: (worker: ServiceWorkerLike) => void,
): void {
    if (registration.waiting) {
        onUpdateAvailable(registration.waiting);
        return;
    }
    registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
            if ((installing as unknown as { state?: string }).state === "installed") {
                onUpdateAvailable(installing);
            }
        });
    });
}

/** Apply a waiting update: message the worker (ACTIVATE_UPDATE) then reload. */
export function applyUpdate(worker: { postMessage(data: unknown): void }): void {
    worker.postMessage({ type: "ACTIVATE_UPDATE" });
    window.location.reload();
}

/** Best-effort badge; absence of the capability is never an error. */
export function setBadge(count: number): void {
    try {
        const nav = navigator as Navigator & {
            setAppBadge?: (count?: number) => void;
            clearAppBadge?: () => void;
        };
        if (count > 0) nav.setAppBadge?.(count);
        else nav.clearAppBadge?.();
    } catch {
        // Badge is optional; ignore unsupported browsers.
    }
}

/** React hook: truthful connectivity + update status with deferred reload. */
export function useAppStatus(options: AppStatusOptions = {}): {
    online: boolean;
    update: UpdateState;
    reloadWhenReady: () => void;
} {
    const online = useOnlineStatus();
    const [update, setUpdate] = useState<UpdateState>({ kind: "idle" });
    const [worker, setWorker] = useState<ServiceWorkerLike | null>(null);

    const blocked = useCallback(
        () => (options.hasUnsavedWork?.() ?? false) || (options.isStreaming?.() ?? false),
        [options],
    );

    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        let registration: ServiceWorkerRegistrationLike | null = null;
        navigator.serviceWorker.ready
            .then((reg) => {
                registration = reg as unknown as ServiceWorkerRegistrationLike;
                watchForUpdate(registration, (w) => {
                    setWorker(w);
                    setUpdate({ kind: "update-available", canReloadImmediately: !blocked() });
                });
            })
            .catch(() => {
                // No service worker; update banner stays idle.
            });
        return () => {
            void registration;
        };
    }, [blocked]);

    useEffect(() => {
        if (options.unreadCount === undefined) return;
        setBadge(options.unreadCount);
    }, [options.unreadCount]);

    const reloadWhenReady = useCallback(() => {
        if (!worker) return;
        if (blocked()) {
            setUpdate({ kind: "update-available", canReloadImmediately: false });
            return;
        }
        applyUpdate(worker);
    }, [worker, blocked]);

    return { online, update, reloadWhenReady };
}
