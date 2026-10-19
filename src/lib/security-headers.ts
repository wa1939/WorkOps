export type SecurityHeaders = Record<string, string>;

/**
 * Build the security headers shared by the application and its static config.
 *
 * Next 14 emits inline bootstrap scripts. Static headers therefore use the
 * conservative production policy (`unsafe-inline`) until middleware can add a
 * per-request nonce. Passing a nonce opts into the stricter CSP path.
 */
export function buildSecurityHeaders(nonce?: string): SecurityHeaders {
    const scriptSources = ["'self'", "'unsafe-inline'"];

    if (process.env.NODE_ENV === "development") {
        // Next's development runtime evaluates generated scripts.
        scriptSources.push("'unsafe-eval'");
    }

    if (nonce) {
        // Upgrade path for request-scoped nonce wiring in middleware.
        scriptSources.push(`'nonce-${nonce}'`, "'strict-dynamic'");
    }

    const contentSecurityPolicy = [
        "default-src 'self'",
        "img-src 'self' data: blob: https:",
        "style-src 'self' 'unsafe-inline'",
        `script-src ${scriptSources.join(" ")}`,
        "worker-src 'self' blob:",
        // Resend and file uploads are server-side in .env.example; no browser
        // origin is exposed for either. GLM is the only external API origin.
        "connect-src 'self' https://api.z.ai",
        "frame-ancestors 'none'",
    ].join("; ");

    return {
        "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy": contentSecurityPolicy,
    };
}
