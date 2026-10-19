import { describe, expect, it } from "vitest";
import { serializeCsv } from "./csv";

describe("serializeCsv", () => {
    it("quotes commas, quotes, newlines, and preserves empty values", () => {
        expect(serializeCsv(
            ["Name", "Note", "Value"],
            [["Acme, Inc.", 'He said "go"', null], ["Two\nlines", undefined, 7]],
        )).toBe(
            "Name,Note,Value\r\n\"Acme, Inc.\",\"He said \"\"go\"\"\",\r\n\"Two\nlines\",,7\r\n",
        );
    });
});
