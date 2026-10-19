"use client";

import React, { useEffect, useRef, useState } from "react";
import { Share2, X } from "lucide-react";
import { useSabahMaybe } from "@/components/sabah/state/sabah-context";
import { Button } from "@/components/ui/button";
import {
    detectPlatform,
    persistDismissal,
    wasDismissed,
    type PwaPlatform,
} from "@/lib/pwa/install";

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void> | void;
}

type PromptState = {
    platform: PwaPlatform;
    visible: boolean;
    canInstall: boolean;
};

export function InstallPrompt(): JSX.Element | null {
    const sabah = useSabahMaybe();
    const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);
    const [state, setState] = useState<PromptState | null>(null);

    useEffect(() => {
        const platform = detectPlatform();
        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            deferredPromptRef.current = event as BeforeInstallPromptEvent;
            setState((current) => current ? { ...current, canInstall: true } : current);
        };

        window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        setState({
            platform,
            visible: !platform.standalone && !wasDismissed(),
            canInstall: false,
        });

        return () => {
            window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
            deferredPromptRef.current = null;
        };
    }, []);

    if (sabah !== null && sabah.state.shell.mode !== "CLOSED") {
        return null;
    }

    if (!state?.visible) {
        return null;
    }

    const dismiss = () => {
        persistDismissal();
        setState((current) => current ? { ...current, visible: false } : current);
    };

    const install = async () => {
        const deferredPrompt = deferredPromptRef.current;
        if (!deferredPrompt) {
            return;
        }

        deferredPromptRef.current = null;
        try {
            await deferredPrompt.prompt();
        } catch {
            // The browser owns the prompt lifecycle; a rejection must not block the app.
        } finally {
            setState((current) => current ? { ...current, visible: false } : current);
        }
    };

    let guidance: JSX.Element;
    if (state.platform.ios) {
        guidance = (
            <p className="flex items-center gap-2 text-sm">
                <Share2 aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>Share, then Add to Home Screen</span>
            </p>
        );
    } else if (state.platform.beforeInstallPromptSupported && state.canInstall) {
        guidance = (
            <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm">Install WorkOps for quick access.</p>
                <Button
                    type="button"
                    className="min-h-[44px] shrink-0"
                    onClick={install}
                >
                    Install WorkOps
                </Button>
            </div>
        );
    } else {
        guidance = (
            <p className="text-sm">Add to Home Screen from your browser menu to install</p>
        );
    }

    return (
        <aside
            aria-label="Install WorkOps"
            className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] start-4 end-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-lg border bg-card p-3 text-card-foreground shadow-lg md:bottom-4"
        >
            <div className="min-w-0 flex-1">{guidance}</div>
            <button
                type="button"
                aria-label="Dismiss install guidance"
                className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={dismiss}
            >
                <X aria-hidden="true" className="h-4 w-4" />
            </button>
        </aside>
    );
}

export default InstallPrompt;
