export const PWA_INSTALL_DISMISSED_KEY = "pwa-install-dismissed";

export type PwaPlatform = {
    standalone: boolean;
    ios: boolean;
    beforeInstallPromptSupported: boolean;
};

type NavigatorWithPwa = Navigator & {
    msStream?: unknown;
    standalone?: boolean;
};

type WindowWithPwa = Window & {
    MSStream?: unknown;
    onbeforeinstallprompt?: ((event: Event) => void) | null;
};

export type DetectPlatformOptions = {
    window?: WindowWithPwa | null;
    navigator?: NavigatorWithPwa | null;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function currentWindow(): WindowWithPwa | null {
    return typeof window === "undefined" ? null : (window as WindowWithPwa);
}

/**
 * Detects install capabilities without assuming browser globals exist.
 * The Mac + touch check covers iPadOS devices that use a desktop Macintosh UA.
 */
export function detectPlatform(options: DetectPlatformOptions = {}): PwaPlatform {
    const windowLike = options.window === undefined ? currentWindow() : options.window;
    const navigatorLike = options.navigator === undefined
        ? (windowLike?.navigator as NavigatorWithPwa | undefined)
        : options.navigator;

    if (!windowLike || !navigatorLike) {
        return { standalone: false, ios: false, beforeInstallPromptSupported: false };
    }

    let standalone = Boolean(navigatorLike.standalone);
    try {
        standalone = standalone || Boolean(windowLike.matchMedia("(display-mode: standalone)").matches);
    } catch {
        // matchMedia can be unavailable or restricted in embedded webviews.
    }

    const userAgent = navigatorLike.userAgent ?? "";
    const hasMsStream = Boolean(windowLike.MSStream) || Boolean(navigatorLike.msStream);
    const iosUserAgent = /iPad|iPhone|iPod/.test(userAgent) && !hasMsStream;
    const macTouchDevice = /Macintosh/i.test(userAgent) && (navigatorLike.maxTouchPoints ?? 0) > 1;

    let beforeInstallPromptSupported = false;
    try {
        beforeInstallPromptSupported = "onbeforeinstallprompt" in windowLike;
    } catch {
        // Some test/webview globals can reject property inspection.
    }

    return {
        standalone,
        ios: iosUserAgent || macTouchDevice,
        beforeInstallPromptSupported,
    };
}

function getStorage(storage?: StorageLike | null): StorageLike | null {
    if (storage !== undefined) {
        return storage;
    }

    if (typeof window === "undefined") {
        return null;
    }

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function persistDismissal(storage?: StorageLike | null): void {
    try {
        getStorage(storage)?.setItem(PWA_INSTALL_DISMISSED_KEY, "true");
    } catch {
        // Storage is best-effort; the banner still dismisses for this mount.
    }
}

export function wasDismissed(storage?: StorageLike | null): boolean {
    try {
        return getStorage(storage)?.getItem(PWA_INSTALL_DISMISSED_KEY) === "true";
    } catch {
        return false;
    }
}
