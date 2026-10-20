import type { MetadataRoute } from "next";
import { getOptionalSiteUrl } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * The public sitemap indexes only the public marketing page. Authenticated
 * areas and auth flows are excluded here AND carry route-level noindex
 * metadata. When no canonical base URL is configured (APP_BASE_URL or
 * NEXTAUTH_URL) the sitemap is empty, so a half-configured deployment never
 * publishes placeholder or wrong-domain URLs to search engines.
 */
export default function sitemap(): MetadataRoute.Sitemap {
    if (process.env.VERCEL_ENV === "preview") return [];
    const siteUrl = getOptionalSiteUrl();
    if (!siteUrl) {
        return [];
    }

    return [
        {
            url: `${siteUrl}/`,
            changeFrequency: "weekly",
            priority: 1,
        },
    ];
}
