import { describe, expect, it } from "vitest";
import { mapGridKey } from "./useGridKeyboard";

function keyEvent(key: string, target: EventTarget | null = null): KeyboardEvent {
    return { key, target } as KeyboardEvent;
}

describe("mapGridKey", () => {
    it("maps navigation and row actions", () => {
        expect(mapGridKey(keyEvent("j"))).toBe("next");
        expect(mapGridKey(keyEvent("k"))).toBe("previous");
        expect(mapGridKey(keyEvent("Enter"))).toBe("open");
        expect(mapGridKey(keyEvent(" "))).toBe("toggle-select");
        expect(mapGridKey(keyEvent("e"))).toBe("edit-title");
        expect(mapGridKey(keyEvent("E"))).toBe("edit-title");
        expect(mapGridKey(keyEvent("Escape"))).toBe("cancel-edit");
    });

    it("ignores shortcuts while typing in a form control", () => {
        const input = { tagName: "INPUT", isContentEditable: false } as unknown as EventTarget;
        const textarea = { tagName: "TEXTAREA", isContentEditable: false } as unknown as EventTarget;

        expect(mapGridKey(keyEvent("j", input))).toBe("none");
        expect(mapGridKey(keyEvent("Enter", input))).toBe("none");
        expect(mapGridKey(keyEvent("Escape", textarea))).toBe("none");
    });
});
