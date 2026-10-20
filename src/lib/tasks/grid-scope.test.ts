import { describe, expect, it } from "vitest";
import { buildTaskGridQuery } from "./grid-query";
import { parseTaskGridSearchParams } from "./grid-search-params";

const viewer = { id: "actor-one", role: "MEMBER" };
function query(search: string) { return buildTaskGridQuery(parseTaskGridSearchParams(new URLSearchParams(search)), viewer); }
describe("task workspace personal scopes", () => {
    it("paginates non-update sorts using their ordered row cursor, not an unrelated timestamp", () => {
        const params = new URLSearchParams({ sortBy: "dueDate", dir: "asc", cursor: JSON.stringify({ id: "previous-page-last", updatedAt: "2026-10-01T00:00:00Z" }) });
        const result = buildTaskGridQuery(parseTaskGridSearchParams(params), viewer);
        expect(result).toMatchObject({ cursor: { id: "previous-page-last" }, skip: 1 });
        expect(JSON.stringify(result.where)).not.toContain("2026-10-01");
    });
    it("resolves assigned tasks from the authenticated actor, not a supplied user id", () => {
        const input = parseTaskGridSearchParams(new URLSearchParams("scope=assigned"));
        expect(input.filters).toMatchObject({ scope: "assigned" });
        expect(query("scope=assigned").where.AND).toContainEqual({ assignments: { some: { userId: viewer.id } } });
    });
    it("finds work related to the actor through assignment or creation", () => {
        expect(query("scope=related").where.AND).toContainEqual({ OR: [{ assignments: { some: { userId: viewer.id } } }, { createdById: viewer.id }] });
    });
    it("supports created work and genuinely unassigned work", () => {
        expect(query("scope=created").where.AND).toContainEqual({ createdById: viewer.id });
        expect(query("scope=unassigned").where.AND).toContainEqual({ assignments: { none: {} } });
    });
    it("combines a person filter with scope and existing permission constraints", () => {
        const where = query("scope=related&assigneeIds=other-person").where;
        expect(where.AND).toContainEqual({ assignments: { some: { userId: { in: ["other-person"] } } } });
        expect(JSON.stringify(where)).toContain('"createdById":"actor-one"');
        expect(JSON.stringify(where)).toContain('"isPrivate":false');
    });
    it("rejects unrecognized scopes instead of widening to all work", () => {
        expect(() => query("scope=everyone-private")).toThrow();
    });
});
