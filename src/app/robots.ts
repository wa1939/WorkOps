import type { MetadataRoute } from "next";
import { getOptionalSiteUrl } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * Route prefixes that must never be crawled or indexed: auth flows, APIs, and
 * every authenticated application area. Defense in depth — each of these also
 * carries route-level `robots: noindex` metadata; robots.txt is the second
 * layer, not the only one.
 */
const PRIVATE_PREFIXES = [
    "/api/",
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/dashboard",
    "/tasks",
    "/projects",
    "/kpis",
    "/notes",
    "/announcements",
    "/team",
    "/reports",
    "/planner",
    "/pmo",
    "/inbox",
    "/support",
    "/leave",
    "/time-entries",
    "/views",
    "/settings",
    "/admin",
    "/case-studies",
];

/**
 * The public robots policy: everything may be requested, private prefixes are
 * disallowed, and the sitemap/host are only advertised when the deployment
 * has configured a canonical base URL (APP_BASE_URL or NEXTAUTH_URL) — so a
 * half-configured or corporate-mispointed deployment never leaks a wrong
 * domain into search engines.
 */
export default function robots(): MetadataRoute.Robots {
    if (process.env.VERCEL_ENV === "preview") return { rules: [{ userAgent: "*", disallow: "/" }] };
    const siteUrl = getOptionalSiteUrl();

    return {
        rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PREFIXES }],
        ...(siteUrl
            ? { sitemap: `${siteUrl}/sitemap.xml`, host: siteUrl }
            : {}),
    };
}
