import { Priority, TaskStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
    DUE_TOKEN_CLASSES,
    PRIORITY_TOKEN_CLASSES,
    STATUS_TOKEN_CLASSES,
    dueClass,
    dueDateSemantics,
    priorityClass,
    statusClass,
} from "./status-tokens";

describe("semantic status and priority classes", () => {
    it("maps every TaskStatus enum member to a CSS-variable class", () => {
        for (const status of Object.values(TaskStatus)) {
            expect(STATUS_TOKEN_CLASSES[status]).toBeTruthy();
            expect(STATUS_TOKEN_CLASSES[status]).toContain(`var(--status-${status.toLowerCase()})`);
            expect(statusClass(status)).toBe(STATUS_TOKEN_CLASSES[status]);
        }
    });

    it("maps every Priority enum member to a CSS-variable class", () => {
        for (const priority of Object.values(Priority)) {
            expect(PRIORITY_TOKEN_CLASSES[priority]).toBeTruthy();
            expect(PRIORITY_TOKEN_CLASSES[priority]).toContain(`var(--priority-${priority.toLowerCase()})`);
            expect(priorityClass(priority)).toBe(PRIORITY_TOKEN_CLASSES[priority]);
        }
    });

    it("maps every due-date semantic to a CSS-variable class", () => {
        for (const semantic of ["overdue", "today", "tomorrow", "upcoming"] as const) {
            expect(DUE_TOKEN_CLASSES[semantic]).toBeTruthy();
            expect(DUE_TOKEN_CLASSES[semantic]).toContain(`var(--due-${semantic})`);
        }
    });
});

describe("Riyadh due-date semantics", () => {
    const now = new Date("2026-07-14T12:00:00.000Z");

    it("classifies dates by Riyadh calendar day", () => {
        expect(dueDateSemantics(new Date("2026-07-13T20:59:59.999Z"), now)).toBe("overdue");
        expect(dueDateSemantics(new Date("2026-07-14T12:00:00.000Z"), now)).toBe("today");
        expect(dueDateSemantics("2026-07-15", now)).toBe("tomorrow");
        expect(dueDateSemantics(new Date("2026-07-16T21:00:00.000Z"), now)).toBe("upcoming");
    });

    it("handles the Riyadh midnight boundary", () => {
        const beforeMidnight = new Date("2026-07-14T20:59:59.999Z");
        const atMidnight = new Date("2026-07-14T21:00:00.000Z");

        expect(dueDateSemantics(atMidnight, beforeMidnight)).toBe("tomorrow");
        expect(dueDateSemantics(beforeMidnight, atMidnight)).toBe("overdue");
    });

    it("returns the matching class and no class for an absent due date", () => {
        expect(dueClass("2026-07-13", now)).toBe(DUE_TOKEN_CLASSES.overdue);
        expect(dueClass(undefined, now)).toBe("");
        expect(dueClass(null, now)).toBe("");
    });
});
