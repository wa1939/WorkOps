import { describe, expect, it } from "vitest";
import { externalContactInputSchema, normalizeContactEmail } from "./contacts";

describe("external contacts", () => {
    it("normalizes email for reuse", () => {
        expect(normalizeContactEmail("  Ahmed.Example@Company.COM ")).toBe("ahmed.example@company.com");
    });

    it("requires a real email and permits optional organization fields", () => {
        expect(externalContactInputSchema.safeParse({ name: "Ahmed", email: "ahmed@example.com" }).success).toBe(true);
        expect(externalContactInputSchema.safeParse({ name: "Ahmed", email: "not-an-email" }).success).toBe(false);
    });
});
