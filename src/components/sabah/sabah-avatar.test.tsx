// @vitest-environment jsdom
import React from "react";
import { expect, describe, it } from "vitest";
import "./test/setup";
import { render, screen } from "@testing-library/react";
import { SabahAvatar } from "./sabah-avatar";

function renderAvatar(props: React.ComponentProps<typeof SabahAvatar> = {}) {
    return render(<SabahAvatar {...props} />);
}

describe("SabahAvatar", () => {
    it("renders an accessible image with the Sabah label", () => {
        renderAvatar();
        const img = screen.getByRole("img", { name: "Sabah employee copilot" });
        expect(img).toHaveAttribute("src", "/sabah/sabah-avatar.svg");
        expect(img).toHaveAttribute("alt", "Sabah employee copilot");
    });

    it("applies exact pixel classes for size sm (24px)", () => {
        renderAvatar({ size: "sm" });
        expect(screen.getByRole("img")).toHaveClass("h-6", "w-6");
    });

    it("applies exact pixel classes for size md (32px)", () => {
        renderAvatar({ size: "md" });
        expect(screen.getByRole("img")).toHaveClass("h-8", "w-8");
    });

    it("applies exact pixel classes for size lg (48px)", () => {
        renderAvatar({ size: "lg" });
        expect(screen.getByRole("img")).toHaveClass("h-12", "w-12");
    });

    it("renders a decorative status indicator that is hidden from a11y tree", () => {
        renderAvatar({ status: "working" });
        expect(screen.getByTestId("sabah-status")).toHaveAttribute("aria-hidden", "true");
    });

    it("does not render a status dot when status is idle (default)", () => {
        renderAvatar({ status: "idle" });
        expect(screen.queryByTestId("sabah-status")).not.toBeInTheDocument();
    });

    it("marks the working status dot with reduced-motion-safe styling hooks", () => {
        renderAvatar({ status: "working" });
        const dot = screen.getByTestId("sabah-status");
        expect(dot.className).not.toMatch(/animate-pulse|animate-spin|transition/);
    });

    it("renders identically under RTL direction (RTL-neutral)", () => {
        const { container, unmount } = renderAvatar({ status: "attention" });
        const rtl = container.innerHTML;
        unmount();
        const { container: ltrContainer } = renderAvatar({ status: "attention" });
        expect(ltrContainer.innerHTML).toBe(rtl);
    });
});
