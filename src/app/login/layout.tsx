import type { Metadata } from "next";

/**
 * Auth flow: never indexed (route-level noindex; robots.txt disallow is the
 * second layer).
 */
export const metadata: Metadata = {
    title: "Sign in",
    robots: { index: false, follow: false },
};

export default function LoginLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return children;
}
