"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, Download, Loader2, Share2, Smartphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectPlatform } from "@/lib/pwa/install";
import { createPushPlatform, getNotificationPermission, getPushSupport, PushPermission } from "@/lib/pwa/push";

const ONBOARDING_DONE_KEY = "sabah-onboarding-done";
const ONBOARDING_SKIPPED_KEY = "sabah-onboarding-skipped";

type StepId = "install" | "push";

function isStandalone(): boolean {
    if (typeof window === "undefined") return false;
    if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
    return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * One-time, two-step PWA onboarding: install the app on the phone, then enable
 * push notifications. Shows on first mobile/PWA use, stays dismissible, and
 * remembers completion per device. Desktop-standalone users see only the push
 * step; everything else can skip past it.
 */
export function SabahOnboarding(): JSX.Element | null {
    const [visible, setVisible] = useState(false);
    const [step, setStep] = useState<StepId>("install");
    const [platform, setPlatform] = useState({ standalone: false, ios: false, beforeInstallPromptSupported: false });
    const [installDismissed, setInstallDismissed] = useState(false);
    const [permission, setPermission] = useState<PushPermission>("default");
    const [pushBusy, setPushBusy] = useState(false);
    const [pushError, setPushError] = useState<string | null>(null);
    const pushPlatform = useMemo(() => (typeof window === "undefined" ? null : createPushPlatform()), []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const done = window.localStorage.getItem(ONBOARDING_DONE_KEY) === "1";
        const skippedThisSession = window.sessionStorage.getItem(ONBOARDING_SKIPPED_KEY) === "1";
        const detected = detectPlatform();
        setPlatform(detected);
        setInstallDismissed(window.localStorage.getItem("pwa-install-dismissed") === "true");
        const standalone = isStandalone();
        // Mobile browser sessions get the full flow; standalone (installed) sessions
        // only need push. Desktop keeps the existing quiet banner only.
        const relevant = detected.ios || standalone || /Android|Mobile/i.test(window.navigator.userAgent);
        setVisible(relevant && !done && !skippedThisSession);
        setStep(detected.ios && !standalone ? "install" : standalone ? "push" : "install");
        setPermission(pushPlatform ? getNotificationPermission(pushPlatform) : "default");
    }, [pushPlatform]);

    const finish = useCallback(() => {
        try {
            window.localStorage.setItem(ONBOARDING_DONE_KEY, "1");
        } catch { /* storage is best-effort */ }
        setVisible(false);
    }, []);

    const skip = useCallback(() => {
        try {
            window.sessionStorage.setItem(ONBOARDING_SKIPPED_KEY, "1");
        } catch { /* storage is best-effort */ }
        setVisible(false);
    }, []);

    const enablePush = useCallback(async () => {
        if (!pushPlatform) return;
        setPushBusy(true);
        setPushError(null);
        try {
            const support = getPushSupport(pushPlatform);
            if (!support.supported) {
                setPushError(support.supportedReason);
                return;
            }
            const notification = pushPlatform.Notification;
            if (!notification) {
                setPushError("Notifications are not available on this device.");
                return;
            }
            const requested = notification.permission === "granted" ? "granted" : await notification.requestPermission();
            setPermission(requested);
            if (requested !== "granted") {
                if (requested === "denied") setPushError("Notifications are blocked. Allow them in your browser settings, then check again.");
                return;
            }
            // Delegate the actual subscription to the full settings component's
            // flow by loading it on demand through the settings page contract:
            // registration happens in PushSettings; here we only confirm intent
            // and route the user there to finish on this device.
            finish();
            if (typeof window !== "undefined") window.location.href = "/settings?tab=notifications#push-notifications";
        } catch {
            setPushError("Could not enable notifications. Try again from Settings → Notifications.");
        } finally {
            setPushBusy(false);
        }
    }, [finish, pushPlatform]);

    if (!visible) return null;

    const installComplete = platform.standalone || installDismissed;
    const pushGranted = permission === "granted";

    if (installComplete && pushGranted) {
        finish();
        return null;
    }

    const showInstallStep = step === "install" && !installComplete;
    const showPushStep = !showInstallStep;

    return (
        <aside
            aria-label="Set up the WorkOps app"
            data-testid="sabah-onboarding"
            className="fixed bottom-4 start-4 end-4 z-50 mx-auto max-w-md rounded-xl border bg-card p-4 text-card-foreground shadow-lg"
        >
            <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">Set up Sabah on this device</p>
                <button
                    type="button"
                    onClick={skip}
                    aria-label="Dismiss setup"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                    <X aria-hidden="true" className="h-4 w-4" />
                </button>
            </div>
            <ol className="mt-1 flex gap-1.5" aria-hidden="true">
                <li className={`h-1 flex-1 rounded-full ${installComplete ? "bg-primary" : "bg-primary/30"}`} />
                <li className={`h-1 flex-1 rounded-full ${pushGranted ? "bg-primary" : "bg-primary/30"}`} />
            </ol>

            {showInstallStep ? (
                <div className="mt-3 space-y-3">
                    <div className="flex items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Smartphone aria-hidden="true" className="h-4 w-4" /></span>
                        <div className="min-w-0">
                            <p className="text-sm font-medium">Install the app</p>
                            {platform.ios ? (
                                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                    In Safari, tap <Share2 aria-hidden="true" className="inline h-3 w-3" /> Share, then <strong>Add to Home Screen</strong>. Open it from your home screen to sign in once and stay signed in.
                                </p>
                            ) : (
                                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                    Tap your browser menu and choose <strong>Install app</strong> / <strong>Add to Home Screen</strong>. The app then opens full-screen like any other app.
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" className="min-h-[44px] flex-1" onClick={() => setStep("push")}>
                            Next <Check aria-hidden="true" className="ms-1 h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setStep("push")}>
                            Skip
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="mt-3 space-y-3">
                    <div className="flex items-start gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Bell aria-hidden="true" className="h-4 w-4" /></span>
                        <div className="min-w-0">
                            <p className="text-sm font-medium">Get push notifications</p>
                            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                                Task assignments, reminders, and approvals reach you even when the app is closed. You can turn this off anytime in Settings → Notifications.
                            </p>
                        </div>
                    </div>
                    {pushError && <p role="alert" className="text-xs text-destructive">{pushError}</p>}
                    <div className="flex gap-2">
                        {pushGranted ? (
                            <Button type="button" className="min-h-[44px] flex-1" onClick={finish}>
                                <Download aria-hidden="true" className="me-1 h-3.5 w-3.5" /> You are set — finish
                            </Button>
                        ) : (
                            <Button type="button" className="min-h-[44px] flex-1" disabled={pushBusy} onClick={() => void enablePush()}>
                                {pushBusy ? <Loader2 aria-hidden="true" className="me-1 h-3.5 w-3.5 motion-safe:animate-spin" /> : <Bell aria-hidden="true" className="me-1 h-3.5 w-3.5" />}
                                Enable notifications
                            </Button>
                        )}
                        <Button type="button" variant="outline" className="min-h-[44px]" onClick={finish}>
                            Later
                        </Button>
                    </div>
                </div>
            )}
        </aside>
    );
}

export default SabahOnboarding;
