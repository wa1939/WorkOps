// @vitest-environment jsdom
import { expect, it } from "vitest";
import "./setup";

it("setup shims are installed", () => {
    expect(typeof globalThis.ResizeObserver).toBe("function");
    expect(typeof window.matchMedia).toBe("function");
    expect(typeof window.PointerEvent).toBe("function");
    expect(window.matchMedia("(min-width: 1px)").matches).toBe(false);
});
