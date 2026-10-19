// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileNavigation } from "./mobile-navigation";

vi.mock("next/navigation", () => ({
    usePathname: vi.fn(),
}));

import { usePathname } from "next/navigation";
const pathnameMock = vi.mocked(usePathname);

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("mobile navigation", () => {
    it("active destination announced", () => {
        pathnameMock.mockReturnValue("/tasks");
        render(<MobileNavigation />);
        const active = screen.getByTestId("mobile-nav-my work");
        expect(active.getAttribute("aria-current")).toBe("page");
        const inactive = screen.getByTestId("mobile-nav-home");
        expect(inactive.getAttribute("aria-current")).toBeNull();
    });

    it("hidden on md+ and floats as a safe-area capsule", () => {
        pathnameMock.mockReturnValue("/dashboard");
        render(<MobileNavigation />);
        const nav = screen.getByTestId("mobile-navigation");
        expect(nav.className).toContain("md:hidden");
        // Floating capsule: detached from the viewport edge with blur.
        expect(nav.className).toContain("bottom-3");
        expect(nav.className).toContain("backdrop-blur-xl");
        expect(nav.className).toContain("rounded-2xl");
        expect(nav.style.paddingBottom).toContain("env(safe-area-inset-bottom)");
    });

    it("renders all four primary destinations", () => {
        pathnameMock.mockReturnValue("/dashboard");
        render(<MobileNavigation />);
        expect(screen.getByTestId("mobile-nav-home")).toBeDefined();
        expect(screen.getByTestId("mobile-nav-my work")).toBeDefined();
        expect(screen.getByTestId("mobile-nav-inbox")).toBeDefined();
        expect(screen.getByTestId("mobile-nav-sabah")).toBeDefined();
    });
});
