import { describe, it, expect } from "vitest";
import { buildEffortPrompt, parseEffortEstimates, MIN_AI_EFFORT, MAX_AI_EFFORT } from "./effort-estimate";

describe("buildEffortPrompt", () => {
    it("lists tasks with ids and demands a strict JSON object", () => {
        const p = buildEffortPrompt([{ id: "t1", title: "مراجعة العرض", description: null, project: "الاندماج" }]);
        expect(p).toContain("t1");
        expect(p).toContain("مراجعة العرض");
        expect(p).toContain("JSON");
    });
});

describe("parseEffortEstimates", () => {
    const valid = new Set(["t1", "t2"]);
    it("parses plain and fenced JSON, keeps only valid ids", () => {
        expect(parseEffortEstimates('{"t1": 3, "tX": 9}', valid)).toEqual(new Map([["t1", 3]]));
        expect(parseEffortEstimates('```json\n{"t2": 6}\n```', valid)).toEqual(new Map([["t2", 6]]));
    });
    it("clamps to [0.5, 40] and drops non-numeric", () => {
        const out = parseEffortEstimates('{"t1": 100, "t2": 0.1}', valid);
        expect(out.get("t1")).toBe(MAX_AI_EFFORT);
        expect(out.get("t2")).toBe(MIN_AI_EFFORT);
        expect(parseEffortEstimates('{"t1": "cheap"}', valid).size).toBe(0);
    });
    it("returns empty on garbage", () => {
        expect(parseEffortEstimates("sorry, no JSON here", valid).size).toBe(0);
    });
});
