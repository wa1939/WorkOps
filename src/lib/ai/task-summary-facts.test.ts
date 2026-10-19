import { describe, expect, it } from "vitest";
import { buildTaskSummaryFacts, formatTaskSummaryFacts } from "./task-summary-facts";

describe("task summary facts", () => {
    it("counts only the server-selected snapshot and labels it as a bounded sample", () => {
        const facts = buildTaskSummaryFacts([
            { id: "1", title: "First", status: "TODO", dueAt: null },
            { id: "2", title: "Second", status: "BLOCKED", dueAt: null },
            { id: "3", title: "Third", status: "BLOCKED", dueAt: null },
        ]);

        expect(facts).toEqual({
            scope: "selected_sample",
            selectedCount: 3,
            statusCounts: { TODO: 1, BLOCKED: 2 },
        });
        expect(formatTaskSummaryFacts(facts, "en")).toBe("Selected task sample · 3 tasks · 1 to do · 2 blocked");
        expect(formatTaskSummaryFacts(facts, "ar")).toContain("٣");
    });
});
