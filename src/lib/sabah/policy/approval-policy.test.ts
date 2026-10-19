import { describe, it, expect } from "vitest";
import { evaluateApproval } from "./approval-policy";

const base = {
    explicitUserRequest: true,
    hasInferredReplacement: false,
    confidence: 1,
    itemCount: 1,
};

describe("evaluateApproval", () => {
    describe("approval matrix: mode × risk", () => {
        it.each([
            ["SMART", "READ", "ALLOW"],
            ["SMART", "DRAFT", "ALLOW"],
            ["SMART", "REVERSIBLE_WRITE", "ALLOW"],
            ["SMART", "BULK_WRITE", "REQUIRE_APPROVAL"],
            ["SMART", "SENSITIVE_WRITE", "REQUIRE_APPROVAL"],
            ["SMART", "BLOCKED", "BLOCK"],
            ["MANUAL", "READ", "ALLOW"],
            ["MANUAL", "DRAFT", "ALLOW"],
            ["MANUAL", "REVERSIBLE_WRITE", "REQUIRE_APPROVAL"],
            ["MANUAL", "BULK_WRITE", "REQUIRE_APPROVAL"],
            ["MANUAL", "SENSITIVE_WRITE", "REQUIRE_APPROVAL"],
            ["MANUAL", "BLOCKED", "BLOCK"],
            ["FAST", "READ", "ALLOW"],
            ["FAST", "DRAFT", "ALLOW"],
            ["FAST", "REVERSIBLE_WRITE", "ALLOW"],
            ["FAST", "BULK_WRITE", "REQUIRE_APPROVAL"],
            ["FAST", "SENSITIVE_WRITE", "REQUIRE_APPROVAL"],
            ["FAST", "BLOCKED", "BLOCK"],
        ])("maps %s/%s to %s", (mode, risk, expected) => {
            expect(evaluateApproval({ ...base, mode: mode as any, risk: risk as any })).toBe(expected);
        });
    });

    describe("inferred replacement", () => {
        it("requires approval for any inferred replacement", () => {
            expect(evaluateApproval({ ...base, mode: "FAST", risk: "REVERSIBLE_WRITE", hasInferredReplacement: true }))
                .toBe("REQUIRE_APPROVAL");
        });

        it("requires approval for inferred replacement even with SMART mode", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "READ", hasInferredReplacement: true }))
                .toBe("REQUIRE_APPROVAL");
        });
    });

    describe("confidence threshold", () => {
        it("requires approval for confidence below 0.85", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "READ", confidence: 0.84 }))
                .toBe("REQUIRE_APPROVAL");
        });

        it("requires approval for confidence at 0.84", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "DRAFT", confidence: 0.84 }))
                .toBe("REQUIRE_APPROVAL");
        });

        it("allows when confidence is exactly 0.85", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "READ", confidence: 0.85 }))
                .toBe("ALLOW");
        });

        it("allows when confidence is above 0.85", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "READ", confidence: 0.9 }))
                .toBe("ALLOW");
        });
    });

    describe("item count threshold", () => {
        it("requires approval for item count above 1", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "READ", itemCount: 2 }))
                .toBe("REQUIRE_APPROVAL");
        });

        it("requires approval for multiple items", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "DRAFT", itemCount: 5 }))
                .toBe("REQUIRE_APPROVAL");
        });

        it("allows when item count is exactly 1", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "READ", itemCount: 1 }))
                .toBe("ALLOW");
        });
    });

    describe("explicit user request", () => {
        it("requires approval for non-explicit write request", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "REVERSIBLE_WRITE", explicitUserRequest: false }))
                .toBe("REQUIRE_APPROVAL");
        });

        it("allows read operations without explicit request", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "READ", explicitUserRequest: false }))
                .toBe("ALLOW");
        });

        it("allows draft operations without explicit request", () => {
            expect(evaluateApproval({ ...base, mode: "SMART", risk: "DRAFT", explicitUserRequest: false }))
                .toBe("ALLOW");
        });
    });

    describe("blocking rules take precedence", () => {
        it("blocks even when other conditions suggest approval", () => {
            expect(evaluateApproval({
                ...base,
                mode: "SMART",
                risk: "BLOCKED",
                explicitUserRequest: true,
                hasInferredReplacement: false,
                confidence: 1,
                itemCount: 1,
            })).toBe("BLOCK");
        });
    });
});