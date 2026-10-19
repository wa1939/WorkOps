import { beforeEach, describe, expect, it, vi } from "vitest";

const glm = vi.hoisted(() => ({ callGLMText: vi.fn() }));
vi.mock("@/lib/glm", () => glm);

import {
    parsePlannerInsightResponse,
    requestPlannerInsight,
    serializePlannerDigest,
} from "./planner-insight";

const plannerDigestInput = {
    members: [
        { name: "Aisha", state: "overloaded", periodUtilizationPercent: 125 },
        { name: "Omar", state: "available", periodUtilizationPercent: 42 },
    ],
    teamTotal: {
        days: [
            { datePart: "2026-09-14", allocatedHours: 10, capacityHours: 8, utilizationPercent: 125 },
            { datePart: "2026-09-15", allocatedHours: 4, capacityHours: 8, utilizationPercent: 50 },
        ],
    },
    backlog: [{ taskId: "task-1", reason: "capacity" }],
};

describe("planner insight", () => {
    beforeEach(() => glm.callGLMText.mockReset());

    it("serializes only compact utilization, backlog, and overload signals", () => {
        const digest = JSON.parse(serializePlannerDigest(plannerDigestInput));
        expect(digest).toEqual({
            members: [
                { name: "Aisha", utilizationPercent: 125, state: "overloaded" },
                { name: "Omar", utilizationPercent: 42, state: "available" },
            ],
            overloadedNames: ["Aisha"],
            backlogCount: 1,
            topOverCapacityDays: [
                { datePart: "2026-09-14", allocatedHours: 10, capacityHours: 8, utilizationPercent: 125, excessHours: 2 },
            ],
        });
    });

    it("parses a strict insight response and rejects malformed fallback data", async () => {
        glm.callGLMText.mockResolvedValueOnce(JSON.stringify({
            headline: "Aisha is over capacity on Monday",
            recommendations: ["Move the review task", "Use Omar's open capacity"],
            rebalance: "Move task-1 from Aisha to Omar.",
        }));
        await expect(requestPlannerInsight(plannerDigestInput)).resolves.toEqual({
            headline: "Aisha is over capacity on Monday",
            recommendations: ["Move the review task", "Use Omar's open capacity"],
            rebalance: "Move task-1 from Aisha to Omar.",
        });
        expect(parsePlannerInsightResponse("not JSON")).toBeNull();
    });
});
