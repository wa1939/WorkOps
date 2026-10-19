import { callGLMText } from "@/lib/glm";
import { parseStrictJson, type TaskActionTextOptions } from "./task-actions";

export interface PlannerInsightDigestInput {
    members: ReadonlyArray<{
        name: string | null;
        periodUtilizationPercent: number | null;
        state: string;
    }>;
    teamTotal: {
        days: ReadonlyArray<{
            datePart: string;
            allocatedHours: number;
            capacityHours: number;
            utilizationPercent: number | null;
        }>;
    };
    backlog: readonly unknown[];
}

export interface PlannerInsight {
    headline: string;
    recommendations: string[];
    rebalance: string;
}

function rounded(value: number): number {
    return Math.round(value * 100) / 100;
}

/** Serialize only the planner signals needed for a useful risk explanation. */
export function serializePlannerDigest(model: PlannerInsightDigestInput): string {
    const members = model.members.map((member) => ({
        name: member.name ?? "Unnamed member",
        utilizationPercent: member.periodUtilizationPercent,
        state: member.state,
    }));
    const overloadedNames = members
        .filter((member) => member.state === "overloaded" || (member.utilizationPercent ?? 0) > 100)
        .map((member) => member.name);
    const topOverCapacityDays = model.teamTotal.days
        .filter((day) => day.capacityHours > 0 && day.allocatedHours > day.capacityHours)
        .map((day) => ({
            datePart: day.datePart,
            allocatedHours: rounded(day.allocatedHours),
            capacityHours: rounded(day.capacityHours),
            utilizationPercent: day.utilizationPercent,
            excessHours: rounded(day.allocatedHours - day.capacityHours),
        }))
        .sort((left, right) => right.excessHours - left.excessHours || left.datePart.localeCompare(right.datePart))
        .slice(0, 5);

    return JSON.stringify({
        members,
        overloadedNames,
        backlogCount: model.backlog.length,
        topOverCapacityDays,
    });
}

export function buildPlannerInsightPrompt(model: PlannerInsightDigestInput): string {
    const digest = serializePlannerDigest(model);
    return `You are Sabah, an operations planning assistant. Review this compact workload digest and identify the most important delivery risk.\n\nDigest:\n${digest}\n\nReturn ONLY valid JSON with exactly this shape: {"headline":"one headline risk","recommendations":["recommendation one","recommendation two"],"rebalance":"one concrete rebalance suggestion"}. Do not use markdown, code fences, or extra commentary. Recommendations must be practical and grounded in the digest; do not invent people or tasks.`;
}

export function parsePlannerInsightResponse(raw: string): PlannerInsight | null {
    const value = parseStrictJson(raw);
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (typeof record.headline !== "string" || typeof record.rebalance !== "string" || !Array.isArray(record.recommendations)) return null;
    const headline = record.headline.trim();
    const rebalance = record.rebalance.trim();
    const recommendations = record.recommendations
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 500)
        .slice(0, 2);
    if (!headline || headline.length > 500 || !rebalance || rebalance.length > 500 || recommendations.length !== 2) return null;
    return { headline, recommendations, rebalance };
}

export async function requestPlannerInsight(model: PlannerInsightDigestInput, options: TaskActionTextOptions = {}): Promise<PlannerInsight | null> {
    const raw = await callGLMText(buildPlannerInsightPrompt(model), options);
    return parsePlannerInsightResponse(raw);
}
