/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'node:url';

const staticScriptSource = process.env.NODE_ENV === 'development'
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";

// Keep these values in sync with buildSecurityHeaders(). A static Next config
// cannot attach a request-scoped nonce; middleware can enable that upgrade later.
const staticSecurityHeaders = [
    { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    { key: 'X-Frame-Options', value: 'DENY' },
    {
        key: 'Content-Security-Policy',
        value: [
            "default-src 'self'",
            "img-src 'self' data: blob: https:",
            "style-src 'self' 'unsafe-inline'",
            `script-src ${staticScriptSource}`,
            "worker-src 'self' blob:",
            "connect-src 'self' https://api.z.ai",
            "frame-ancestors 'none'",
        ].join('; '),
    },
];

const nextConfig = {
    outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
    devIndicators: false,
    serverExternalPackages: ['@prisma/client', 'bcrypt'],
    // Docker-only opt-in (`NEXT_OUTPUT_STANDALONE=1` in the Dockerfile).
    // Keeps the default build output byte-identical for Vercel and local dev.
    ...(process.env.NEXT_OUTPUT_STANDALONE === '1'
        ? {
              output: 'standalone',
              // Prisma query/migration engines are native binaries that Next's
              // file tracing can miss; include them explicitly.
              outputFileTracingIncludes: {
                  '/**': ['./node_modules/.prisma/client/**', './node_modules/@prisma/client/**'],
              },
          }
        : {}),
    async headers() {
        return [
            ...['/api/:path*', '/login', '/signup', '/forgot-password', '/reset-password', '/verify-email'].map(source => ({
                source,
                headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
            })),
            {
                source: '/:path*',
                headers: staticSecurityHeaders,
            },
            {
                source: '/sw.js',
                headers: [
                    { key: 'Content-Type', value: 'application/javascript' },
                    { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
                    { key: 'Service-Worker-Allowed', value: '/' },
                ],
            },
        ];
    },
};

export default nextConfig;
