"use client";

import React, { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type WindowWithSw = Window & {
  __swUpdateRegistration?: ServiceWorkerRegistration | null;
  __swUpdateListeners?: Set<(registration: ServiceWorkerRegistration | null) => void>;
  __swActivateUpdate?: (registration: ServiceWorkerRegistration) => void;
  __swRegister?: () => void;
};

/**
 * Shared SW-update plumbing. `RegisterWorker` performs the registration and
 * publishes a waiting worker onto these window slots; this component (and any
 * other surface) subscribes and can trigger SKIP_WAITING + reload.
 */
export function subscribeToWorkerUpdates(listener: (registration: ServiceWorkerRegistration | null) => void): () => void {
  const w = window as WindowWithSw;
  w.__swUpdateListeners = w.__swUpdateListeners ?? new Set();
  w.__swUpdateListeners.add(listener);
  listener(w.__swUpdateRegistration ?? null);
  return () => {
    w.__swUpdateListeners?.delete(listener);
  };
}

export function activateWorkerUpdate(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage({ type: "ACTIVATE_UPDATE" });
  // Reload once the new worker takes control.
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
}

export function useServiceWorkerUpdate() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => subscribeToWorkerUpdates((next) => {
    setRegistration(next);
    if (next) setDismissed(false);
  }), []);
  return { registration, dismissed, setDismissed };
}

/**
 * Ported from elm-leaders-compass PwaUpdatePrompt: when a new service worker
 * is waiting, offer "Update now" (SKIP_WAITING + reload) with a dismissible
 * card above the mobile nav.
 */
export function PwaUpdatePrompt(): JSX.Element | null {
  const { registration, dismissed, setDismissed } = useServiceWorkerUpdate();
  if (!registration || dismissed) return null;
  return (
    <aside
      role="status"
      data-testid="pwa-update-prompt"
      className="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-[80] mx-auto max-w-md rounded-xl border bg-card p-4 text-card-foreground shadow-lg md:bottom-6"
    >
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">A new update is ready</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Update now to get the latest WorkOps experience.
          </p>
          <Button size="sm" className="mt-3" onClick={() => activateWorkerUpdate(registration)}>
            Update app
          </Button>
        </div>
        <button
          type="button"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          aria-label="Dismiss update prompt"
          onClick={() => setDismissed(true)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

export default PwaUpdatePrompt;
