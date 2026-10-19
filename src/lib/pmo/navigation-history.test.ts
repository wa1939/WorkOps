import { describe, expect, it } from "vitest";
import {
    appendPmoHistory,
    popPreviousPmoUrl,
    sanitizePmoHistory,
    type PmoHistoryEntry,
} from "./navigation-history";

describe("PMO navigation history", () => {
    it("accepts PMO routes and explicitly typed external actions", () => {
        expect(
            sanitizePmoHistory([
                { url: "/pmo/settings?tab=contacts", kind: "pmo" },
                { url: "/tasks/task-1#follow-up", kind: "external-action" },
            ]),
        ).toEqual([
            { url: "/pmo/settings?tab=contacts", kind: "pmo" },
            { url: "/tasks/task-1", kind: "external-action" },
        ]);
    });

    it.each([
        ["https://evil.example/pmo", "pmo"],
        ["//evil.example/pmo", "pmo"],
        ["/projects/project-1", "pmo"],
        ["/tasks/task-1", "pmo"],
        ["/%2f%2fevil.example", "pmo"],
        ["/pmo/settings", "external-action"],
    ] as const)("rejects disallowed input %s", (url, kind) => {
        expect(sanitizePmoHistory([{ url, kind }])).toEqual([]);
    });

    it("deduplicates consecutive entries and caps history at twenty", () => {
        expect(
            sanitizePmoHistory([
                { url: "/pmo/settings", kind: "pmo" },
                { url: "/pmo/settings", kind: "pmo" },
            ]),
        ).toEqual([{ url: "/pmo/settings", kind: "pmo" }]);

        let history: PmoHistoryEntry[] = [];
        for (let index = 0; index < 22; index += 1) {
            history = appendPmoHistory(history, {
                url: `/pmo?offset=${index}`,
                kind: "pmo",
            });
        }
        history = appendPmoHistory(history, history.at(-1)!);

        expect(history).toHaveLength(20);
        expect(history[0].url).toBe("/pmo?offset=2");
        expect(history.at(-1)?.url).toBe("/pmo?offset=21");
    });

    it("pops the current route and returns the prior exact URL", () => {
        const result = popPreviousPmoUrl(
            [
                { url: "/pmo/settings?tab=contacts", kind: "pmo" },
                {
                    url: "/pmo/actions/new?projectId=p1",
                    kind: "pmo",
                },
            ],
            "/pmo/actions/new?projectId=p1",
        );

        expect(result).toEqual({
            url: "/pmo/settings?tab=contacts",
            history: [
                { url: "/pmo/settings?tab=contacts", kind: "pmo" },
            ],
        });
    });

    it("falls back for malformed or empty history", () => {
        expect(sanitizePmoHistory("not-an-array")).toEqual([]);
        expect(popPreviousPmoUrl([], "/pmo/settings")).toEqual({
            url: "/pmo",
            history: [],
        });
    });
});
