import { describe, expect, it } from "vitest";
import { projectColor } from "./project-color";

describe("projectColor", () => {
    it("returns a compact accent color for both named and unassigned projects", () => {
        for (const projectName of ["Operations", "Research", null]) {
            expect(projectColor(projectName).dotColor).toMatch(/^hsl\(\d+ 65% 48%\)$/);
        }
    });

    it("does not expose a light-only surface color", () => {
        expect(projectColor("Operations")).toEqual({ dotColor: expect.any(String) });
        expect(projectColor("Operations")).not.toHaveProperty("backgroundColor");
    });
});
