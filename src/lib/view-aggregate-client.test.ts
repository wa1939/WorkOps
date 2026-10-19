import { describe, expect, it } from "vitest";
import type { Block } from "@/components/view-blocks/block-editor";
import {
    buildViewAggregateUrl,
    parseViewAggregateResponse,
} from "./view-aggregate-client";

const taskMetricBlock = (overrides: Partial<Block> = {}): Block => ({
    id: "aggregate-task",
    type: "statTile",
    metric: "my-open",
    assigneeIds: [],
    projectIds: ["project-1"],
    tagIds: ["tag-1"],
    dueRange: "today",
    sortBy: "dueAt",
    sortDir: "asc",
    groupBy: "status",
    filters: {
        status: "TODO,DONE",
        search: "release",
        includeArchived: "false",
    },
    ...overrides,
});

const metricResponse = (overrides: Record<string, unknown> = {}) => ({
    kind: "metric",
    key: "my-open",
    scope: "task",
    value: 137,
    totalCount: 137,
    timeZone: "Asia/Riyadh",
    ...overrides,
});

describe("view aggregate client", () => {
    it("serializes task scope through the reviewed allowlist and applies transient chips", () => {
        const result = buildViewAggregateUrl(
            taskMetricBlock(),
            new Set(["me", "high-priority"]),
        );

        expect(result.conflict).toBeNull();
        const params = new URL(result.url, "http://localhost").searchParams;
        expect(params.get("metric")).toBe("my-open");
        expect(params.getAll("assigneeIds")).toEqual(["@me"]);
        expect(params.getAll("priority")).toEqual(["HIGH", "URGENT"]);
        expect(params.getAll("status")).toEqual(["TODO", "DONE"]);
        expect(params.getAll("projectIds")).toEqual(["project-1"]);
        expect(params.getAll("tagIds")).toEqual(["tag-1"]);
        expect(params.get("dueRange")).toBe("today");
        expect(params.get("search")).toBe("release");
        expect(params.get("includeArchived")).toBe("false");
        expect(params.has("offset")).toBe(false);
        expect(params.has("sortBy")).toBe(false);
        expect(params.has("sortDir")).toBe(false);
        expect(params.has("groupBy")).toBe(false);
    });

    it("serializes overdue and this-week chips through the existing task filter intersection", () => {
        const savedBlock = taskMetricBlock({ dueRange: undefined, filters: {} });
        const overdue = buildViewAggregateUrl(savedBlock, new Set(["overdue"]));
        const thisWeek = buildViewAggregateUrl(savedBlock, new Set(["this-week"]));

        expect(new URL(overdue.url, "http://localhost").searchParams.get("dueRange")).toBe("overdue");
        expect(new URL(thisWeek.url, "http://localhost").searchParams.get("dueRange")).toBe("this-week");
        expect(savedBlock.dueRange).toBeUndefined();
        expect(savedBlock.filters).toEqual({});
    });

    it("returns a conflict without a URL when transient task scope has no intersection", () => {
        const result = buildViewAggregateUrl(
            taskMetricBlock({ assigneeIds: ["user-2"] }),
            new Set(["me"]),
        );

        expect(result.url).toBe("");
        expect(result.conflict).toMatch(/cannot be combined|no tasks match/i);
    });

    it("omits all task scope for project and KPI selectors", () => {
        const project = buildViewAggregateUrl(
            taskMetricBlock({ metric: "active-projects", chartKind: undefined }),
            new Set(["me", "overdue", "high-priority"]),
        );
        const kpi = buildViewAggregateUrl(
            taskMetricBlock({ metric: undefined, chartKind: "kpi-status" }),
            new Set(["me", "overdue", "high-priority"]),
        );

        expect(Array.from(new URL(project.url, "http://localhost").searchParams.entries())).toEqual([
            ["metric", "active-projects"],
        ]);
        expect(Array.from(new URL(kpi.url, "http://localhost").searchParams.entries())).toEqual([
            ["chartKind", "kpi-status"],
        ]);
    });

    it("strictly validates the requested metric response and preserves server values", () => {
        const parsed = parseViewAggregateResponse(metricResponse(), {
            kind: "metric",
            key: "my-open",
            scope: "task",
        });

        expect(parsed.kind).toBe("metric");
        if (parsed.kind !== "metric") throw new Error("expected metric response");
        expect(parsed.value).toBe(137);
        expect(parsed.totalCount).toBe(137);
    });

    it("rejects malformed or mismatched successful payloads instead of inventing empty data", () => {
        const expected = { kind: "metric" as const, key: "my-open" as const, scope: "task" as const };
        const malformed = [
            null,
            {},
            metricResponse({ kind: "chart" }),
            metricResponse({ key: "team-overdue" }),
            metricResponse({ scope: "kpi" }),
            metricResponse({ value: -1 }),
            metricResponse({ totalCount: 136 }),
        ];

        for (const payload of malformed) {
            expect(() => parseViewAggregateResponse(payload, expected)).toThrow();
        }
    });

    it("keeps duplicate labels as distinct chart points and preserves server order", () => {
        const parsed = parseViewAggregateResponse({
            kind: "chart",
            key: "task-by-project",
            scope: "task",
            points: [
                { key: "p1", label: "Same name", value: 4 },
                { key: "p2", label: "Same name", value: 3 },
            ],
            totalCount: 7,
            timeZone: "Asia/Riyadh",
        }, {
            kind: "chart",
            key: "task-by-project",
            scope: "task",
        });

        expect(parsed.kind).toBe("chart");
        if (parsed.kind !== "chart") throw new Error("expected chart response");
        expect(parsed.points).toEqual([
            { key: "p1", label: "Same name", value: 4 },
            { key: "p2", label: "Same name", value: 3 },
        ]);
    });
});
