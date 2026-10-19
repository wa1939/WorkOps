import { describe, expect, it } from "vitest";
import { AI_TOOLS } from "./tools";

describe("chat action tool descriptions", () => {
    it("keeps governed confirmation in the conversation without promising execution", () => {
        const tool = AI_TOOLS.find(item => item.function.name === "proposeWorkflow");
        expect(tool).toBeDefined();
        expect(tool!.function.description).not.toMatch(/Plan tab/i);
        expect(tool!.function.description).toContain("inline confirmation");
        expect(tool!.function.description).toMatch(/does not execute/i);
    });
});
