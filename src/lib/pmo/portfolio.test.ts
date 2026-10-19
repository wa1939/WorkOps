import { describe, expect, it } from "vitest";
import {
    calculatePortfolioMetrics,
    escapeCsvCell,
    groupPortfolioRows,
    parsePmoFilters,
    type PmoFilters,
} from "./portfolio";
import { scopePmoFiltersToActor } from "./portfolio-query";

describe("PMO portfolio", () => {
    it("calculates due and completion metrics without overlap", () => {
        const rows = [
            { status: "WAITING", dueDate: "2026-07-13", closedDate: null },
            { status: "WAITING", dueDate: "2026-07-21", closedDate: null },
            { status: "DONE", dueDate: "2026-07-10", closedDate: "2026-07-09" },
            { status: "DONE", dueDate: "2026-07-10", closedDate: "2026-07-11" },
        ];
        expect(calculatePortfolioMetrics(rows, "2026-07-14")).toEqual({ open: 2, dueSoon: 1, overdue: 1, completed: 2, completedOnTime: 1, onTimeCompletionRate: 50 });
    });

    it("parses every supported filter", () => {
        const filters = parsePmoFilters(new URLSearchParams({
            ownerId: "owner-2",
            workAreaId: "area-1",
            parentType: "case-study",
            parentId: "case-1",
            contactId: "contact-1",
            status: "WAITING",
            dueBucket: "DUE_7",
            dueStart: "2026-07-01",
            dueEnd: "2026-07-31",
            evidence: "missing",
        }));
        expect(filters).toMatchObject({ ownerId: "owner-2", workAreaId: "area-1", parentType: "case-study", parentId: "case-1", contactId: "contact-1", status: "WAITING", dueBucket: "DUE_7", dueStart: "2026-07-01", dueEnd: "2026-07-31", evidence: "missing" });
    });

    it("groups rows by work area", () => {
        expect(Object.keys(groupPortfolioRows([
            { id: "1", workAreaName: "Area B" },
            { id: "2", workAreaName: "Area A" },
            { id: "3", workAreaName: "Area B" },
        ]))).toEqual(["Area A", "Area B"]);
    });

    it("uses N/A when nothing is completed", () => {
        expect(calculatePortfolioMetrics([], "2026-07-14").onTimeCompletionRate).toBeNull();
    });

    it("escapes spreadsheet formulas and CSV quotes", () => {
        expect(escapeCsvCell("=1+1")).toBe("'=1+1");
        expect(escapeCsvCell('a,"b"')).toBe('"a,""b"""');
    });
});

describe("scopePmoFiltersToActor (plan 017)", () => {
    function baseFilters(ownerId: PmoFilters["ownerId"]): PmoFilters {
        return {
            ownerId, workAreaId: null, parentType: null, parentId: null, contactId: null,
            status: null, dueBucket: null, dueStart: null, dueEnd: null, evidence: null, page: 1,
        };
    }

    it("forces a VIEWER's broad view (ownerId=all → null) back to their own scope", () => {
        expect(scopePmoFiltersToActor(baseFilters(null), { id: "viewer", role: "VIEWER" }).ownerId).toBe("me");
    });

    it("forces a VIEWER browsing another owner back to their own scope", () => {
        expect(scopePmoFiltersToActor(baseFilters("other"), { id: "viewer", role: "VIEWER" }).ownerId).toBe("me");
    });

    it("leaves a VIEWER's own scope untouched", () => {
        expect(scopePmoFiltersToActor(baseFilters("me"), { id: "viewer", role: "VIEWER" }).ownerId).toBe("me");
        expect(scopePmoFiltersToActor(baseFilters("viewer"), { id: "viewer", role: "VIEWER" }).ownerId).toBe("viewer");
    });

    it("also scopes a plain MEMBER's broad view to self", () => {
        expect(scopePmoFiltersToActor(baseFilters(null), { id: "member", role: "MEMBER" }).ownerId).toBe("me");
    });

    it("lets a MANAGER keep the broad view across all owners", () => {
        expect(scopePmoFiltersToActor(baseFilters(null), { id: "mgr", role: "MANAGER" }).ownerId).toBeNull();
    });

    it("lets an ADMIN browse any specific owner", () => {
        expect(scopePmoFiltersToActor(baseFilters("other"), { id: "admin", role: "ADMIN" }).ownerId).toBe("other");
    });

    it("does not mutate the input filters", () => {
        const input = baseFilters(null);
        scopePmoFiltersToActor(input, { id: "viewer", role: "VIEWER" });
        expect(input.ownerId).toBeNull();
    });
});
