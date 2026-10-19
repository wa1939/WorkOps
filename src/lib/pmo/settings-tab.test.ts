import { describe, expect, it } from "vitest";
import { parsePmoSettingsTab } from "./settings-tab";

describe("parsePmoSettingsTab", () => {
    it("restores only the supported contacts tab", () => {
        expect(parsePmoSettingsTab("contacts")).toBe("contacts");
    });

    it.each([undefined, "areas", "unknown", ["contacts"]])(
        "falls back to work areas for %j",
        (value) => {
            expect(parsePmoSettingsTab(value)).toBe("areas");
        },
    );
});
