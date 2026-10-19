import { describe, expect, it } from "vitest";
import { parseMentions, renderMentionHighlights, type MentionMember } from "./mentions";

const members: MentionMember[] = [
    { id: "user-alice", name: "Alice Johnson" },
    { id: "user-bob", name: "Bob" },
    { id: "user-carol", name: "Carol" },
];

describe("parseMentions", () => {
    it("keeps exact member mentions and returns their ids", () => {
        expect(parseMentions("Please ask @Alice Johnson", members)).toEqual({
            cleanedText: "Please ask @Alice Johnson",
            mentionUserIds: ["user-alice"],
        });
    });

    it("matches member names case-insensitively", () => {
        expect(parseMentions("ping @alice johnson and @BOB", members)).toEqual({
            cleanedText: "ping @alice johnson and @BOB",
            mentionUserIds: ["user-alice", "user-bob"],
        });
    });

    it("returns multiple unique mentions in appearance order", () => {
        expect(parseMentions("@Bob please pair with @Carol; @Bob can review", members)).toEqual({
            cleanedText: "@Bob please pair with @Carol; @Bob can review",
            mentionUserIds: ["user-bob", "user-carol"],
        });
    });

    it("leaves names that are not members unlinked", () => {
        expect(parseMentions("No match for @Nobody here", members)).toEqual({
            cleanedText: "No match for @Nobody here",
            mentionUserIds: [],
        });
    });

    it("handles adjacent punctuation without consuming it", () => {
        expect(parseMentions("(@Bob),@Carol! @Alice Johnson.", members)).toEqual({
            cleanedText: "(@Bob),@Carol! @Alice Johnson.",
            mentionUserIds: ["user-bob", "user-carol", "user-alice"],
        });
    });
});

describe("renderMentionHighlights", () => {
    it("returns React-friendly text and mention segments", () => {
        expect(renderMentionHighlights("Hi @Alice Johnson, see @Bob.", members)).toEqual([
            { type: "text", text: "Hi " },
            { type: "mention", text: "@Alice Johnson", userId: "user-alice" },
            { type: "text", text: ", see " },
            { type: "mention", text: "@Bob", userId: "user-bob" },
            { type: "text", text: "." },
        ]);
    });

    it("returns one text segment when there are no valid mentions", () => {
        expect(renderMentionHighlights("hello @Nobody", members)).toEqual([
            { type: "text", text: "hello @Nobody" },
        ]);
    });
});
