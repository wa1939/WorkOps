import { describe, expect, it } from "vitest";
import { assertGenericTaskMutationAllowed, buildAiUndoWhere, isPmoQuickCompleteAllowed } from "./task-mutation-policy";

describe("generic task PMO guard", () => {
    const task = { type: "EXTERNAL_ACTION", ownerId: "owner" };
    it.each([{ status: "DONE" }, { status: "CANCELED" }, { status: "WAITING" }, { status: "DOING" }, { dueAt: null }, { dueAt: "2026-08-01T09:00:00.000Z" }, { isPrivate: true }, { projectId: "other" }, { caseStudyId: "case" }])("rejects protected mutation %#", (payload) => {
        expect(() => assertGenericTaskMutationAllowed(task, payload)).toThrow("Use the PMO action workflow");
    });
    it("allows safe metadata through the generic endpoint", () => { expect(() => assertGenericTaskMutationAllowed(task, { priority: "HIGH" })).not.toThrow(); });
    it("hides quick completion for external actions", () => { expect(isPmoQuickCompleteAllowed("EXTERNAL_ACTION")).toBe(false); });
    it("restricts AI undo atomically to standard tasks", () => {
        const cutoff = new Date("2026-07-15T12:00:00Z");
        expect(buildAiUndoWhere(["one", "two"], "creator", cutoff)).toEqual({
            id: { in: ["one", "two"] },
            type: "STANDARD",
            createdById: "creator",
            createdAt: { gte: cutoff },
            status: { notIn: ["DONE", "CANCELED"] },
        });
    });
});
