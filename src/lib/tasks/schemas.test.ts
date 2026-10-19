import { describe, expect, it } from "vitest";
import { taskDueDateInputSchema, taskDueTimeInputSchema } from "./schemas";

describe("task due date and time input schemas", () => {
    it("rejects impossible calendar dates and clock times before date construction", () => {
        expect(taskDueDateInputSchema.safeParse("2026-99-99").success).toBe(false);
        expect(taskDueDateInputSchema.safeParse("2026-02-29").success).toBe(false);
        expect(taskDueTimeInputSchema.safeParse("99:99").success).toBe(false);
        expect(taskDueTimeInputSchema.safeParse("24:00").success).toBe(false);
    });

    it("accepts real dates, valid times, and an empty optional date", () => {
        expect(taskDueDateInputSchema.safeParse("").success).toBe(true);
        expect(taskDueDateInputSchema.safeParse("2028-02-29").success).toBe(true);
        expect(taskDueTimeInputSchema.safeParse("23:59").success).toBe(true);
    });
});
