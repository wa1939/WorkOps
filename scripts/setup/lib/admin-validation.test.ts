import { describe, expect, it } from "vitest";
import { validateAdminInput } from "./admin-validation";

const base = {
    email: "Admin@Example.COM",
    name: "Demo Admin",
    password: "correct horse battery 9",
};

describe("validateAdminInput", () => {
    it("normalizes email casing and whitespace", () => {
        const result = validateAdminInput(base);
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.normalized.email).toBe("admin@example.com");
            expect(result.normalized.name).toBe("Demo Admin");
        }
    });

    it("defaults an empty name for scripted installs", () => {
        const result = validateAdminInput({ ...base, name: "" });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.normalized.name).toBe("WorkOps Admin");
    });

    it("rejects missing or malformed email", () => {
        expect(validateAdminInput({ ...base, email: "" }).ok).toBe(false);
        expect(validateAdminInput({ ...base, email: "not-an-email" }).ok).toBe(false);
    });

    it("enforces password length and composition", () => {
        expect(validateAdminInput({ ...base, password: "short1" }).ok).toBe(false);
        expect(validateAdminInput({ ...base, password: "nodigitsatall" }).ok).toBe(false);
        expect(validateAdminInput({ ...base, password: "123456789012" }).ok).toBe(false);
    });

    it("rejects common and email-derived passwords", () => {
        expect(validateAdminInput({ ...base, password: "password1234" }).ok).toBe(false);
        expect(validateAdminInput({ ...base, password: "admin@example.com1" }).ok).toBe(false);
    });
});
