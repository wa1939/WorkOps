import type { Metadata, Viewport } from "next";
import "./globals.css";
import "gantt-task-react/dist/index.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/toaster";
import { Analytics } from "@vercel/analytics/next";
import { brand, getSiteUrl } from "@/lib/brand";

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: "#090f18",
};

export const metadata: Metadata = {
    // Canonical origin comes from the deployment environment (APP_BASE_URL,
    // then NEXTAUTH_URL) — never a hardcoded domain. See src/lib/brand.ts.
    metadataBase: new URL(getSiteUrl()),
    title: {
        default: `${brand.name} — ${brand.tagline}`,
        template: `%s · ${brand.name}`,
    },
    description: brand.description,
    applicationName: brand.name,
    robots: process.env.VERCEL_ENV === "preview" ? { index: false, follow: false } : undefined,
    authors: [{ name: brand.author.name, url: brand.repository.url }],
    manifest: "/manifest.webmanifest",
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
    icons: {
        icon: [
            { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
            { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
        ],
        apple: "/icons/apple-touch-icon.png",
    },
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className="font-sans antialiased">
                <Providers>{children}</Providers>
                <Toaster />
                <Analytics />
            </body>
        </html>
    );
}
