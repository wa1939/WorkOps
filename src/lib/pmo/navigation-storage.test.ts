import { describe, expect, it } from "vitest";
import {
    getPmoSessionStorage,
    recordPmoVisit,
    takePmoBackDestination,
} from "./navigation-storage";

class MemoryStorage {
    private values = new Map<string, string>();

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}

describe("PMO navigation storage", () => {
    it("records visits and consumes the current entry on Back", () => {
        const storage = new MemoryStorage();
        recordPmoVisit(storage, {
            kind: "pmo",
            url: "/pmo/settings?tab=contacts",
        });
        recordPmoVisit(storage, {
            kind: "pmo",
            url: "/pmo/actions/new?projectId=project-1",
        });

        expect(
            takePmoBackDestination(
                storage,
                "/pmo/actions/new?projectId=project-1",
            ),
        ).toBe("/pmo/settings?tab=contacts");
        expect(
            takePmoBackDestination(
                storage,
                "/pmo/settings?tab=contacts",
            ),
        ).toBe("/pmo");
    });

    it("repairs corrupt stored history", () => {
        const storage = new MemoryStorage();
        storage.setItem("cee:pmo-history:v1", "not-json");

        expect(takePmoBackDestination(storage, "/pmo/settings")).toBe(
            "/pmo",
        );
        expect(storage.getItem("cee:pmo-history:v1")).toBe("[]");
    });

    it("falls back when browser storage is unavailable", () => {
        const blockedStorage = {
            getItem(): string | null {
                throw new Error("blocked");
            },
            setItem(): void {
                throw new Error("blocked");
            },
        };

        expect(() =>
            recordPmoVisit(blockedStorage, {
                kind: "pmo",
                url: "/pmo/settings",
            }),
        ).not.toThrow();
        expect(
            takePmoBackDestination(blockedStorage, "/pmo/settings"),
        ).toBe("/pmo");
    });

    it("returns no storage when the browser blocks sessionStorage access", () => {
        const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            get() {
                return {
                    get sessionStorage(): Storage {
                        throw new Error("blocked");
                    },
                };
            },
        });

        try {
            expect(getPmoSessionStorage()).toBeNull();
        } finally {
            if (previousWindow) {
                Object.defineProperty(globalThis, "window", previousWindow);
            } else {
                delete (globalThis as { window?: unknown }).window;
            }
        }
    });
});
