"use client";

import React, { useEffect } from "react";

type WindowWithSw = Window & {
  __swUpdateRegistration?: ServiceWorkerRegistration | null;
  __swUpdateListeners?: Set<(registration: ServiceWorkerRegistration | null) => void>;
};

function publish(registration: ServiceWorkerRegistration | null): void {
  const w = window as WindowWithSw;
  w.__swUpdateRegistration = registration;
  w.__swUpdateListeners?.forEach((listener) => listener(registration));
}

export function RegisterWorker(): null {
  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined") {
      return;
    }

    const isAllowedOrigin = window.location.protocol === "https:"
      || window.location.hostname === "localhost";
    if (!isAllowedOrigin || !("serviceWorker" in navigator)) {
      return;
    }

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        // A worker may already be waiting (update staged before this load).
        if (registration.waiting && navigator.serviceWorker.controller) {
          publish(registration);
        }
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              publish(registration);
            }
          });
        });
      } catch (error) {
        console.warn("[PWA] Service worker registration failed", error);
      }
    })();
  }, []);

  return null;
}

export default RegisterWorker;
