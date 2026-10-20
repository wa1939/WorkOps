import Image from "next/image";
import Link from "next/link";
import { Github } from "lucide-react";
import { brand } from "@/lib/brand";
import workopsLogo from "../../../public/brand/workops-logo.png";

/**
 * Public landing navigation. Static server component — no session, no client JS.
 * The primary user-supplied ribbon mark sits in its own black tile (the artwork
 * keeps its original black background by design; see BRAND.md).
 */
export function LandingNav() {
    return (
        <header className="relative z-10">
            <nav
                aria-label="Main"
                className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
            >
                <Link
                    href="/"
                    className="flex items-center gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)]"
                >
                    <span className="flex items-center overflow-hidden rounded-lg bg-black ring-1 ring-white/15">
                        <Image
                            src={workopsLogo}
                            alt="WorkOps"
                            className="h-9 w-auto"
                            sizes="72px"
                        />
                    </span>
                    <span className="text-[15px] font-semibold tracking-tight text-[hsl(210_20%_98%)]">
                        {brand.name}
                    </span>
                </Link>

                <div className="flex items-center gap-2 sm:gap-6">
                    <a
                        href="#capabilities"
                        className="hidden rounded-md px-2 py-1 text-sm text-[hsl(218_11%_65%)] transition-colors hover:text-[hsl(210_20%_98%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)] md:inline-block"
                    >
                        Capabilities
                    </a>
                    <a
                        href="#how-it-runs"
                        className="hidden rounded-md px-2 py-1 text-sm text-[hsl(218_11%_65%)] transition-colors hover:text-[hsl(210_20%_98%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)] md:inline-block"
                    >
                        How it runs
                    </a>
                    <Link
                        href="/login"
                        className="inline-flex min-h-11 items-center rounded-md px-2 py-1 text-sm text-[hsl(213_31%_91%)] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)]"
                    >
                        Sign in
                    </Link>
                    <a
                        href={brand.repository.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="WorkOps source on GitHub"
                        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[hsl(215_28%_24%)] px-3 py-1.5 text-sm text-[hsl(213_31%_91%)] transition-colors hover:border-[hsl(215_28%_35%)] hover:bg-[hsl(215_28%_10%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)]"
                    >
                        <Github className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden sm:inline">GitHub</span>
                    </a>
                </div>
            </nav>
        </header>
    );
}
