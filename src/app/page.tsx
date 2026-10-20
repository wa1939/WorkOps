import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getHomePath } from "@/lib/home-preference";
import type { SabahActor } from "@/lib/sabah/capabilities/contracts";
import { brand } from "@/lib/brand";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingHero } from "@/components/landing/landing-hero";
import { LandingCapabilities } from "@/components/landing/landing-capabilities";
import { LandingPlatform } from "@/components/landing/landing-platform";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingFaq } from "@/components/landing/landing-faq";
import { createProductStructuredData } from "@/lib/product-marketing";

/**
 * Public marketing page metadata. Only this signed-out view is intended for
 * search engines; every authenticated area, auth flow, and API route carries
 * route-level noindex (and is disallowed in robots.txt).
 */
export const metadata: Metadata = {
    title: { absolute: `${brand.name} — ${brand.tagline}` },
    description: brand.description,
    alternates: { canonical: "/" },
    openGraph: {
        type: "website",
        siteName: brand.name,
        title: `${brand.name} — ${brand.tagline}`,
        description: brand.description,
        url: "/",
    },
    twitter: {
        card: "summary_large_image",
        title: `${brand.name} — ${brand.tagline}`,
        description: brand.description,
    },
};

/**
 * Structured data for the open-source application. Honest facts only: author,
 * license, repository, and free-of-charge — no ratings or adoption claims.
 */
function StructuredData() {
    const data = createProductStructuredData();

    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
        />
    );
}

export default async function HomePage() {
    const session = await auth();

    if (session?.user) {
        // Signed-in behavior is unchanged: the root goes to the user's
        // personal home according to their saved home preference.
        const actor: SabahActor = {
            id: session.user.id,
            role: (session.user.role ?? "MEMBER") as SabahActor["role"],
            departmentIds: (session.user as { departmentIds?: string[] }).departmentIds ?? [],
        };
        redirect(await getHomePath(actor));
    }

    // Signed-out visitors get the public product page: fully server-rendered
    // static content so crawlers see the marketing page without a session.
    return (
        <div className="workops-public min-h-screen bg-[hsl(224_71%_4%)] text-[hsl(213_31%_91%)]">
            <StructuredData />
            <div className="bg-black">
                <LandingNav />
            </div>
            <main id="main-content">
                <LandingHero />
                <LandingCapabilities />
                <LandingPlatform />
                <LandingFaq />
            </main>
            <LandingFooter />
        </div>
    );
}
