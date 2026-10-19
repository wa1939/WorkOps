import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

describe("buildSecurityHeaders", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("includes every baseline security header", () => {
        expect(buildSecurityHeaders()).toMatchObject({
            "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "strict-origin-when-cross-origin",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "X-Frame-Options": "DENY",
        });
    });

    it("includes the required CSP directives and strict connection sources", () => {
        const csp = buildSecurityHeaders()["Content-Security-Policy"];

        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("img-src 'self' data: blob: https:");
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
        expect(csp).toContain("connect-src 'self' https://api.z.ai");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toMatch(/(?:^|;)\s*[^;]*\*/);
        expect(csp).not.toMatch(/\*[^;]*(?:credential|credentials)/i);
    });

    it("allows Next development evaluation without weakening production defaults", () => {
        vi.stubEnv("NODE_ENV", "development");
        expect(buildSecurityHeaders()["Content-Security-Policy"]).toContain(
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        );

        vi.stubEnv("NODE_ENV", "production");
        expect(buildSecurityHeaders()["Content-Security-Policy"]).toContain(
            "script-src 'self' 'unsafe-inline'",
        );
        expect(buildSecurityHeaders()["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    });

    it("adds a nonce and strict-dynamic when nonce wiring is enabled", () => {
        vi.stubEnv("NODE_ENV", "production");
        const csp = buildSecurityHeaders("test-nonce")["Content-Security-Policy"];

        expect(csp).toContain("'nonce-test-nonce'");
        expect(csp).toContain("'strict-dynamic'");
    });
});
