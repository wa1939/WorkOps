import Image from "next/image";
import Link from "next/link";
import { brand } from "@/lib/brand";
import workopsLogo from "../../../public/brand/workops-logo.png";

export function LandingFooter() {
    return (
        <footer className="border-t border-[hsl(215_28%_12%)]">
            <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
                <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center overflow-hidden rounded-lg bg-black ring-1 ring-white/15">
                            <Image
                                src={workopsLogo}
                                alt="WorkOps"
                                className="h-8 w-auto"
                                sizes="64px"
                            />
                        </span>
                        <div>
                            <p className="text-sm font-semibold tracking-tight text-[hsl(210_20%_98%)]">
                                {brand.name}
                            </p>
                            <p className="text-[13px] text-[hsl(218_11%_55%)]">
                                Built and maintained by {brand.author.name}
                            </p>
                        </div>
                    </div>

                    <nav aria-label="Footer" className="flex items-center gap-6 text-sm">
                        <a
                            href={brand.repository.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[hsl(218_11%_65%)] transition-colors hover:text-[hsl(210_20%_98%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)]"
                        >
                            GitHub
                        </a>
                        <Link
                            href="/login"
                            className="text-[hsl(218_11%_65%)] transition-colors hover:text-[hsl(210_20%_98%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)]"
                        >
                            Sign in
                        </Link>
                        <a
                            href={brand.license.url}
                            className="text-[hsl(218_11%_65%)] transition-colors hover:text-[hsl(210_20%_98%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)]"
                        >
                            MIT License
                        </a>
                    </nav>
                </div>

                <p className="mt-10 text-[13px] text-[hsl(218_11%_45%)]">
                    © 2026 {brand.author.name}. {brand.name} is open source under the{" "}
                    {brand.license.name} license.
                </p>
            </div>
        </footer>
    );
}
