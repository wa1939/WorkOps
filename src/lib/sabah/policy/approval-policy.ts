import type { ApprovalMode, CapabilityRisk } from "../capabilities/contracts";

export type ApprovalDecision = "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";

export function evaluateApproval(input: {
    mode: ApprovalMode;
    risk: CapabilityRisk;
    explicitUserRequest: boolean;
    hasInferredReplacement: boolean;
    confidence: number;
    itemCount: number;
}): ApprovalDecision {
    const { mode, risk, explicitUserRequest, hasInferredReplacement, confidence, itemCount } = input;

    // Rule 1: BLOCKED is always blocked
    if (risk === "BLOCKED") {
        return "BLOCK";
    }

    // Rule 2: SENSITIVE_WRITE always requires approval
    if (risk === "SENSITIVE_WRITE") {
        return "REQUIRE_APPROVAL";
    }

    // Rule 3: BULK_WRITE always requires approval
    if (risk === "BULK_WRITE") {
        return "REQUIRE_APPROVAL";
    }

    // Rule 4: Inferred replacement requires approval
    if (hasInferredReplacement) {
        return "REQUIRE_APPROVAL";
    }

    // Rule 5: Low confidence requires approval
    if (confidence < 0.85) {
        return "REQUIRE_APPROVAL";
    }

    // Rule 6: Multiple items require approval
    if (itemCount > 1) {
        return "REQUIRE_APPROVAL";
    }

    // Rule 7: Non-explicit write requires approval (but not for READ or DRAFT)
    if (!explicitUserRequest && risk !== "READ" && risk !== "DRAFT") {
        return "REQUIRE_APPROVAL";
    }

    // Rule 8: MANUAL mode with REVERSIBLE_WRITE requires approval
    if (mode === "MANUAL" && risk === "REVERSIBLE_WRITE") {
        return "REQUIRE_APPROVAL";
    }

    // Default: ALLOW (SMART and FAST routine operations, READ/DRAFT)
    return "ALLOW";
}