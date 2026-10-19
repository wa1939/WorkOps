import { describe, expect, it } from "vitest";
import { redactDiagnosticPayload, redactDiagnosticText } from "./redact";

describe("diagnostic redaction", () => {
    it("preserves boolean metadata instead of classifying it as non-finite", () => {
        expect(redactDiagnosticPayload({ enabled: true, disabled: false })).toEqual({ enabled: true, disabled: false });
    });

    it("redacts secret-bearing Error.code values", () => {
        const error = new Error("request failed") as Error & { code: string };
        error.code = "token=error-code-secret";
        const payload = redactDiagnosticPayload(error) as { code?: unknown };
        expect(payload.code).not.toContain("error-code-secret");
        expect(payload.code).toBe("token=[REDACTED]");
    });

    it("redacts credentials in database URLs as well as HTTP URLs", () => {
        const value = redactDiagnosticText("db=postgresql://dbuser:db-password-secret@db.internal:5432/app");
        expect(value).not.toContain("db-password-secret");
        expect(value).toContain("postgresql://[REDACTED]@db.internal:5432/app");
    });
});
