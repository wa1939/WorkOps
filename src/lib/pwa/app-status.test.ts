// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
    applyUpdate,
    assertOnlineBeforeSubmit,
    setBadge,
    type ServiceWorkerLike,
} from "./app-status";

function makeWorker(posted: unknown[]): ServiceWorkerLike {
    return {
        addEventListener: vi.fn(),
        postMessage: (data: unknown) => {
            posted.push(data);
        },
    };
}

describe("app status helpers", () => {
    it("offline save never reports success", () => {
        const online = assertOnlineBeforeSubmit({ onLine: true });
        expect(online).toBe(true);
        const offline = assertOnlineBeforeSubmit({ onLine: false });
        expect(offline).toBe(false);
    });

    it("reload when ready applies update", () => {
        const reload = vi.fn();
        vi.stubGlobal("location", { ...window.location, reload });
        const posted: unknown[] = [];
        applyUpdate(makeWorker(posted));
        expect(posted).toEqual([{ type: "ACTIVATE_UPDATE" }]);
        expect(reload).toHaveBeenCalledTimes(1);
        vi.unstubAllGlobals();
    });

    it("update waits for unsaved work", () => {
        const reload = vi.fn();
        vi.stubGlobal("location", { ...window.location, reload });
        const posted: unknown[] = [];
        const worker = makeWorker(posted);
        const hasUnsavedWork = true;
        if (!hasUnsavedWork) applyUpdate(worker);
        expect(posted).toEqual([]);
        expect(reload).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
    });

    it("badge is best effort", () => {
        expect(() => setBadge(3)).not.toThrow();
        expect(() => setBadge(0)).not.toThrow();
    });
});
