import { beforeEach, describe, expect, it, vi } from "vitest";

const glm = vi.hoisted(() => ({ callGLMText: vi.fn() }));
vi.mock("@/lib/glm", () => glm);

import {
    buildSummaryPrompt,
    parseBreakdownResponse,
    parseQuickAddResponse,
    parseSummaryResponse,
    parseTitleResponse,
    requestTaskBreakdown,
    requestTaskSummary,
} from "./task-actions";
import { buildTaskSummaryFacts, formatTaskSummaryFacts } from "./task-summary-facts";

describe("task action JSON responses", () => {
    beforeEach(() => glm.callGLMText.mockReset());

    it("parses a fenced breakdown and keeps the requested shape", async () => {
        glm.callGLMText.mockResolvedValueOnce([
            "```json",
            JSON.stringify([
                { title: "Confirm the scope", estimateMinutes: 30 },
                { title: "Draft the first version", estimateMinutes: 90 },
                { title: "Review and publish", estimateMinutes: 45 },
            ]),
            "```",
        ].join("\n"));

        await expect(requestTaskBreakdown({ title: "Prepare launch brief", description: "Coordinate the launch." })).resolves.toEqual([
            { title: "Confirm the scope", estimateMinutes: 30 },
            { title: "Draft the first version", estimateMinutes: 90 },
            { title: "Review and publish", estimateMinutes: 45 },
        ]);
        expect(glm.callGLMText).toHaveBeenCalledOnce();
    });

    it("returns null for malformed or underspecified JSON instead of throwing", () => {
        expect(parseBreakdownResponse("not JSON")).toBeNull();
        expect(parseBreakdownResponse(JSON.stringify([{ title: "Only one" }]))).toBeNull();
        expect(parseQuickAddResponse(JSON.stringify({ title: "", priority: "HIGH" }))).toBeNull();
    });

    it("normalizes valid summary, title, and quick-add responses", () => {
        expect(parseSummaryResponse(JSON.stringify({
            summary: "• The blocker needs a clear owner\n• Start with the launch brief\n• Keep the next decision visible",
        }))).toBe("• The blocker needs a clear owner\n• Start with the launch brief\n• Keep the next decision visible");
        expect(parseTitleResponse(JSON.stringify({ title: "Publish the approved launch brief" }))).toBe("Publish the approved launch brief");
        expect(parseQuickAddResponse(JSON.stringify({ title: "Schedule stakeholder review", priority: "HIGH", estimateMinutes: 45, dueInDays: 3 }))).toEqual({
            title: "Schedule stakeholder review",
            priority: "HIGH",
            estimateMinutes: 45,
            dueInDays: 3,
        });
    });

    it("rejects a summary with extra bullets instead of truncating it", () => {
        expect(parseSummaryResponse(JSON.stringify({
            summary: "• One\n• Two\n• Three\n• Four",
        }))).toBeNull();
    });

    it("uses distinct grounded prompts for briefing, day plan, and first-person update", () => {
        const tasks = [{ id: "task-1", title: "Prepare the launch brief", status: "DOING", dueAt: null }];
        const briefing = buildSummaryPrompt(tasks, undefined, "briefing");
        const plan = buildSummaryPrompt(tasks, undefined, "plan");
        const update = buildSummaryPrompt(tasks, undefined, "update");

        expect(briefing).toContain("daily briefing");
        expect(plan).toContain("day plan");
        expect(plan).toContain("first move");
        expect(update).toContain("first-person work update");
        expect(update).toContain("I/my");
        expect(new Set([briefing, plan, update]).size).toBe(3);
    });

    it("rejects the observed mismatched aggregate prose instead of displaying it as grounded", () => {
        const observedBadResponse = JSON.stringify({
            summary: "• All 13 QA acceptance tasks share a due date; none are done (8 TODO, 5 BLOCKED).\n• Clearest blocker/risk: the 5 BLOCKED tasks (tasks 119, 133, 126, 112, 105, 098) are past due.\n• Identify and resolve the unrecorded blocker cause for the 5 BLOCKED acceptance tasks today.",
        });

        expect(parseSummaryResponse(observedBadResponse)).toBeNull();
    });

    it("keeps computed count fields out of the qualitative generation prompt", () => {
        const prompt = buildSummaryPrompt([{ id: "task-1", title: "Prepare the brief", status: "TODO", dueAt: "2026-10-16T09:00:00Z" }]);
        expect(prompt).not.toContain('"selectedCount"');
        expect(prompt).toContain("Do not count source rows");
        expect(prompt).not.toContain("2026-10-16");
    });

    it("regenerates an invalid summary once without replaying the rejected model text", async () => {
        glm.callGLMText.mockResolvedValueOnce(JSON.stringify({ summary: "• 8 TODO tasks\n• Review blockers\n• Prepare next steps" })).mockResolvedValueOnce(JSON.stringify({
            summary: ["Start with the brief", "Clarify the recorded blocker", "Keep the next decision visible"],
        }));
        const options = { signal: new AbortController().signal };
        const result = await requestTaskSummary([{ id: "task-1", title: "Prepare the brief", status: "TODO" }], options, undefined, "plan");
        expect(result).toEqual({
            summary: "• Start with the brief\n• Clarify the recorded blocker\n• Keep the next decision visible",
            facts: { scope: "selected_sample", selectedCount: 1, statusCounts: { TODO: 1 } },
        });
        expect(glm.callGLMText).toHaveBeenCalledTimes(2);
        expect(glm.callGLMText.mock.calls[1][0]).not.toContain("8 TODO tasks");
        expect(glm.callGLMText.mock.calls[1][1]).toBe(options);
    });

    it("fails closed after the bounded regeneration also violates the summary contract", async () => {
        glm.callGLMText.mockResolvedValue(JSON.stringify({ summary: "• 8 TODO tasks\n• Review blockers\n• Prepare next steps" }));
        expect(await requestTaskSummary([{ id: "task-1", title: "Prepare the brief", status: "TODO" }])).toBeNull();
        expect(glm.callGLMText).toHaveBeenCalledTimes(2);
    });

    it("does not regenerate an already valid summary", async () => {
        glm.callGLMText.mockResolvedValue(JSON.stringify({ summary: ["Start with the brief", "Clarify blockers", "Keep the next step visible"] }));
        expect(await requestTaskSummary([{ id: "task-1", title: "Prepare the brief", status: "TODO" }])).not.toBeNull();
        expect(glm.callGLMText).toHaveBeenCalledOnce();
    });

    it("does not regenerate after the caller's deadline has expired", async () => {
        const controller = new AbortController();
        glm.callGLMText.mockImplementationOnce(async () => { controller.abort(); return "invalid JSON"; });
        expect(await requestTaskSummary([{ id: "task-1", title: "Prepare the brief", status: "TODO" }], { signal: controller.signal })).toBeNull();
        expect(glm.callGLMText).toHaveBeenCalledOnce();
    });

    it.each(["Pick one blocked task", "Start by investigating one blocked item"])("allows a singular next-action selection: %s", (action) => {
        const summary = `${action}\nClarify its specific blocker\nKeep the next step visible`;
        expect(parseSummaryResponse(JSON.stringify({ summary }))).not.toBeNull();
    });

    it.each(["Pick one blocked task from 5", "Pick one blocked task (5 total)"])("does not hide another count behind a singular action: %s", (action) => {
        expect(parseSummaryResponse(JSON.stringify({ summary: [action, "Clarify its blocker", "Keep the next step visible"] }))).toBeNull();
    });

    it("allows a singular selection followed by a task reference, not a count", () => {
        expect(parseSummaryResponse(JSON.stringify({ summary: ["Pick one blocked task, such as task 119", "Give it attention from someone", "Keep the next step visible"] }))).not.toBeNull();
    });

    it("does not mistake numeric substrings inside qualitative words for counts", () => {
        const summary = "• Blocked tasks need attention from someone\n• Review what is done before choosing the next task\n• Keep the next decision visible";
        expect(parseSummaryResponse(JSON.stringify({ summary }))).toBe(summary);
    });

    it.each(["7 TODOs", "three in progress", "a dozen tasks", "إحدى مهام", "BLOCKED: 5", "٥ مهام"])("rejects an adjacent aggregate phrase: %s", (claim) => {
        expect(parseSummaryResponse(JSON.stringify({ summary: `• ${claim}\n• Review task-119\n• Keep the next decision visible` }))).toBeNull();
    });

    it("allows a numbered next action and ordinary hyphenated task IDs", () => {
        const summary = "• Choose one clear next action for the blocked item\n• Review task-119 before task #098\n• Keep the next decision visible";
        expect(parseSummaryResponse(JSON.stringify({ summary }))).toBe(summary);
    });

    it("keeps ordinary task-number references while formatting server facts in English and Arabic", () => {
        const facts = buildTaskSummaryFacts([
            ...Array.from({ length: 7 }, (_, index) => ({ id: `todo-${index}`, title: `Task ${index}`, status: "TODO", dueAt: null })),
            ...Array.from({ length: 6 }, (_, index) => ({ id: `blocked-${index}`, title: `Task ${index}`, status: "BLOCKED", dueAt: null })),
        ]);

        expect(parseSummaryResponse(JSON.stringify({
            summary: "• Review task 119 and task 098 first\n• Resolve the blocker with its owner\n• Keep the next decision visible",
        }))).toBe("• Review task 119 and task 098 first\n• Resolve the blocker with its owner\n• Keep the next decision visible");
        expect(facts).toEqual({ scope: "selected_sample", selectedCount: 13, statusCounts: { TODO: 7, BLOCKED: 6 } });
        expect(formatTaskSummaryFacts(facts, "en")).toContain("7 to do");
        expect(formatTaskSummaryFacts(facts, "en")).toContain("6 blocked");
        expect(formatTaskSummaryFacts(facts, "ar")).toMatch(/[٠-٩]/);
    });
});
