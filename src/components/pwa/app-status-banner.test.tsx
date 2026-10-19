// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../sabah/test/setup";
import { cleanup, render, screen } from "@testing-library/react";
import { AppStatusBanner } from "./app-status-banner";

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("app status banner", () => {
    it("offline banner shows exact copy", () => {
        vi.stubGlobal("navigator", { ...navigator, onLine: false });
        render(<AppStatusBanner />);
        expect(screen.getByTestId("offline-banner").textContent).toBe(
            "You're offline. Reconnect to load or save work.",
        );
    });

    it("online hides offline banner", () => {
        vi.stubGlobal("navigator", { ...navigator, onLine: true });
        render(<AppStatusBanner />);
        expect(screen.queryByTestId("offline-banner")).toBeNull();
    });
});
