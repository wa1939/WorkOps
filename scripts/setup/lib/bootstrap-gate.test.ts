import { describe, expect, it } from "vitest";
import { shouldBootstrapAdminOnBuild } from "./build-gates";

describe("explicit first-admin build gate", () => {
    it("is off by default and does not infer consent from credentials", () => {
        expect(shouldBootstrapAdminOnBuild({ ADMIN_EMAIL: "owner@example.test", ADMIN_PASSWORD: "synthetic-test-input" })).toBe(false);
    });
    it("requires the exact opt-in value", () => {
        expect(shouldBootstrapAdminOnBuild({ WORKOPS_BOOTSTRAP_ADMIN_ON_BUILD: "1" })).toBe(true);
        expect(shouldBootstrapAdminOnBuild({ WORKOPS_BOOTSTRAP_ADMIN_ON_BUILD: "true" })).toBe(false);
    });
});
