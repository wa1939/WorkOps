import Image from "next/image";
import Link from "next/link";
import { Github } from "lucide-react";
import localFont from "next/font/local";
import { brand } from "@/lib/brand";
import workspacePreview from "../../../public/images/workops-dashboard.png";

const displayFont = localFont({ src: "../../../public/fonts/geist/geist-latin-variable.woff2", display: "swap", weight: "100 900" });

/**
 * The one authored motion moment on the page: a single staggered fade-rise on
 * the first viewport, ease-out, fully disabled under prefers-reduced-motion.
 */
const heroStyles = `
@keyframes workops-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}
.workops-rise {
  animation: workops-rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}
.workops-rise-1 { animation-delay: 0.06s; }
.workops-rise-2 { animation-delay: 0.12s; }
.workops-rise-3 { animation-delay: 0.18s; }
.workops-mark-rise { animation-delay: 0.1s; }
.workops-public ::selection {
  background: hsl(263.4 70% 50.4% / 0.4);
  color: hsl(210 20% 98%);
}
@media (prefers-reduced-motion: reduce) {
  .workops-rise { animation: none; }
}
`;

export function LandingHero() {
    return (
        <section className="bg-black">
            <style>{heroStyles}</style>
            <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-14 sm:px-6 md:pb-28 md:pt-20 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
                <div>
                    <h1 className={`${displayFont.className} workops-rise text-4xl font-semibold leading-[1.06] tracking-[-0.03em] text-[hsl(210_20%_98%)] [text-wrap:balance] sm:text-5xl lg:text-6xl`}>
                        Make work visible. Keep the team in sync.
                    </h1>
                    <p className="workops-rise workops-rise-1 mt-6 max-w-xl text-lg leading-relaxed text-[hsl(218_11%_65%)]">
                        WorkOps pulls tasks, project timelines, shared KPIs, notes, and
                        announcements into a single self-hosted hub — so the whole team
                        reads from the same page, every week. Open source under the MIT
                        license, running on your own infrastructure.
                    </p>
                    <div className="workops-rise workops-rise-2 mt-8 flex flex-wrap items-center gap-3">
                        <a
                            href={brand.repository.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg bg-[hsl(263.4_70%_50.4%)] px-5 py-3 text-sm font-medium text-[hsl(210_20%_98%)] transition-colors hover:bg-[hsl(262_70%_56%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)] focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                        >
                            <Github className="h-4 w-4" aria-hidden="true" />
                            View the source on GitHub
                        </a>
                        <Link
                            href="/login"
                            className="inline-flex items-center rounded-lg border border-[hsl(215_28%_24%)] px-5 py-3 text-sm font-medium text-[hsl(213_31%_91%)] transition-colors hover:border-[hsl(215_28%_35%)] hover:bg-[hsl(215_28%_10%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)]"
                        >
                            Team sign in
                        </Link>
                    </div>
                    <p className="workops-rise workops-rise-3 mt-8 text-[13px] text-[hsl(218_11%_55%)]">
                        MIT licensed&ensp;·&ensp;Self-hosted&ensp;·&ensp;Next.js + PostgreSQL
                    </p>
                </div>

                <figure className="workops-rise workops-mark-rise relative mx-auto w-full max-w-[720px] overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-[0_24px_70px_-24px_rgba(0,0,0,0.7)]">
                    <Image
                        src={workspacePreview}
                        alt="The actual WorkOps dashboard with a personal focus list, project-linked tasks, and shared KPIs, populated with synthetic demo data"
                        priority
                        className="h-auto w-full"
                        sizes="(max-width: 1024px) 94vw, 720px"
                    />
                    <figcaption className="border-t border-slate-800 px-4 py-3 text-xs text-slate-400">Actual product screen · Synthetic demo data</figcaption>
                </figure>
            </div>
        </section>
    );
}
