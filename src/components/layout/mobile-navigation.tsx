"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type MobileDestination = {
    href: string;
    label: string;
    /** Inline SVG path data from the existing icon set (lucide-style). */
    iconPath: string;
};

const DESTINATIONS: MobileDestination[] = [
    { href: "/", label: "Home", iconPath: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
    { href: "/tasks", label: "My work", iconPath: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
    { href: "/inbox", label: "Inbox", iconPath: "M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" },
    { href: "/dashboard#sabah", label: "Sabah", iconPath: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
];

function isActive(pathname: string, href: string): boolean {
    // The Sabah tab deep-links to the launcher on the dashboard; strip the
    // hash when deciding the active destination.
    const base = href.split("#")[0];
    return pathname === base || pathname.startsWith(`${base}/`);
}

/** Floating capsule bottom navigation for small screens; hidden on md+ like the plan's layout. */
export function MobileNavigation() {
    const pathname = usePathname();

    return (
        <nav
            aria-label="Primary"
            className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-border bg-background/90 shadow-lg shadow-black/20 backdrop-blur-xl md:hidden"
            style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
            data-testid="mobile-navigation"
        >
            {DESTINATIONS.map((destination) => {
                const active = isActive(pathname, destination.href);
                return (
                    <Link
                        key={destination.href}
                        href={destination.href}
                        aria-current={active ? "page" : undefined}
                        aria-label={destination.label}
                        className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${
                            active ? "text-foreground font-medium" : "text-muted-foreground"
                        }`}
                        data-testid={`mobile-nav-${destination.label.toLowerCase()}`}
                        data-active={active ? "true" : "false"}
                    >
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-5 w-5"
                        >
                            <path d={destination.iconPath} />
                        </svg>
                        <span>{destination.label}</span>
                    </Link>
                );
            })}
        </nav>
    );
}
