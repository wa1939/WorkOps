import { describe, it, expect } from "vitest";
import { resolveAssigneeIds, assigneesForCreate, taskCommandRole, teamMemberWhere } from "./executors";
import { canReassignTask } from "@/lib/tasks/authorization";

describe("resolveAssigneeIds", () => {
    it("maps @me/me/myself/current user to the caller id and dedupes", () => {
        expect(resolveAssigneeIds(["@me", "ME", "myself", "u2", "current user"], "u1")).toEqual(["u1", "u2"]);
    });
    it("returns undefined for empty/absent (reassign unassign contract)", () => {
        expect(resolveAssigneeIds(undefined, "u1")).toBeUndefined();
        expect(resolveAssigneeIds([], "u1")).toBeUndefined();
    });
});

describe("assigneesForCreate", () => {
    it("defaults to the requester when no assignee is given", () => {
        expect(assigneesForCreate(undefined, "u1")).toEqual(["u1"]);
        expect(assigneesForCreate([], "u1")).toEqual(["u1"]);
    });
    it("keeps explicit assignees untouched", () => {
        expect(assigneesForCreate(["u2"], "u1")).toEqual(["u2"]);
        expect(assigneesForCreate(["@me", "u2"], "u1")).toEqual(["u1", "u2"]);
    });
});

describe("teamMemberWhere", () => {
    it("searches name, email, AND aliases when a query is given", () => {
        const where = teamMemberWhere("أبو دانة") as { isActive: boolean; OR?: unknown[] };
        expect(where.isActive).toBe(true);
        expect(where.OR).toHaveLength(3);
        expect(JSON.stringify(where.OR)).toContain("aliases");
    });
    it("has no OR clause without a query", () => {
        expect(teamMemberWhere(undefined)).toEqual({ isActive: true });
    });
});

describe("legacy AI task actor mapping", () => {
    it("maps MANAGER to Sabah LEAD instead of ADMIN", () => {
        const role = taskCommandRole("MANAGER");
        expect(role).toBe("LEAD");
        expect(canReassignTask({ createdById: "other" }, { id: "manager", role: role as any })).toBe(false);
    });
});
