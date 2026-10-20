/**
 * WorkOps product brand — single source of truth for public identity strings
 * and canonical URL configuration.
 *
 * The canonical base URL always comes from the deployment environment
 * (APP_BASE_URL, then NEXTAUTH_URL — mirroring src/lib/email.ts). It is never
 * hardcoded here, so no corporate or placeholder domain can leak into
 * metadata, robots.txt or the sitemap.
 */

export const brand = {
    name: "WorkOps",
    tagline: "Self-hosted task and workload management",
    description:
        "Open-source task and project management with workload planning, team capacity, time tracking, shared KPIs and optional AI. Self-host WorkOps on your infrastructure.",
    author: { name: "Waleed Alhamed" },
    license: { name: "MIT", url: "https://opensource.org/licenses/MIT" },
    repository: {
        url: "https://github.com/wa1939/WorkOps",
        owner: "wa1939",
        repo: "WorkOps",
    },
} as const;

type SiteUrlEnv = {
    APP_BASE_URL?: string;
    NEXTAUTH_URL?: string;
    VERCEL_PROJECT_PRODUCTION_URL?: string;
    VERCEL_ENV?: string;
};

function siteEnvironment(): SiteUrlEnv {
    return {
        APP_BASE_URL: process.env.APP_BASE_URL,
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
        VERCEL_ENV: process.env.VERCEL_ENV,
    };
}

/**
 * Resolve the canonical public site base URL, or null when the deployment
 * has not configured one. Callers should omit canonical metadata, sitemap
 * entries and robots host/sitemap fields instead of publishing a placeholder.
 */
export function getOptionalSiteUrl(
    env: SiteUrlEnv = siteEnvironment(),
): string | null {
    const raw = (env.APP_BASE_URL || env.NEXTAUTH_URL || (env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).trim();
    const withoutTrailingSlashes = raw.replace(/\/+$/, "");
    return withoutTrailingSlashes.length > 0 ? withoutTrailingSlashes : null;
}

/**
 * Canonical base URL with a localhost fallback so Next.js metadataBase and
 * local metadata resolution always have an absolute origin. SEO-bearing
 * output (sitemap, robots host) should prefer getOptionalSiteUrl().
 */
export function getSiteUrl(env: SiteUrlEnv = siteEnvironment()): string {
    return getOptionalSiteUrl(env) ?? "http://localhost:3000";
}
