// @vitest-environment jsdom
// Shared harness for Sabah UI component tests.
// Each UI test file opts into jsdom via a `// @vitest-environment jsdom`
// header and imports this module; the vitest default stays "node".
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
    cleanup();
});

// Deterministic ResizeObserver shim: jsdom does not implement it.
class ResizeObserverStub implements Partial<ResizeObserver> {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = ResizeObserverStub as typeof ResizeObserver;
}

// Deterministic matchMedia shim: jsdom does not implement it.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    window.matchMedia = (query: string): MediaQueryList =>
        ({
            matches: false,
            media: query,
            onchange: null,
            addListener: (): void => {},
            removeListener: (): void => {},
            addEventListener: (): void => {},
            removeEventListener: (): void => {},
            dispatchEvent: (): boolean => false,
        }) as MediaQueryList;
}

// Deterministic PointerEvent shim: jsdom does not implement it.
if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
    class PointerEventStub extends MouseEvent implements PointerEvent {
        pointerId: number;
        pointerType: string;
        isPrimary: boolean;
        width: number;
        height: number;
        pressure: number;
        tangentialPressure: number;
        tiltX: number;
        tiltY: number;
        twist: number;
        altitudeAngle: number;
        azimuthAngle: number;

        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 0;
            this.pointerType = init.pointerType ?? "";
            this.isPrimary = init.isPrimary ?? false;
            this.width = init.width ?? 1;
            this.height = init.height ?? 1;
            this.pressure = init.pressure ?? 0;
            this.tangentialPressure = init.tangentialPressure ?? 0;
            this.tiltX = init.tiltX ?? 0;
            this.tiltY = init.tiltY ?? 0;
            this.twist = init.twist ?? 0;
            this.altitudeAngle = init.altitudeAngle ?? 0;
            this.azimuthAngle = init.azimuthAngle ?? 0;
        }

        getCoalescedEvents(): PointerEvent[] {
            return [];
        }

        getPredictedEvents(): PointerEvent[] {
            return [];
        }
    }

    window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent;
}
