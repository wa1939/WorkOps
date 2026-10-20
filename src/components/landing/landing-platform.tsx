import { brand } from "@/lib/brand";

const stackFacts = [
    { term: "Runtime", detail: "Next.js 15 (App Router) on Node.js" },
    { term: "Database", detail: "PostgreSQL, schema managed by Prisma migrations" },
    {
        term: "Authentication",
        detail: "NextAuth v5 — email + password, with optional Microsoft Entra ID for org sign-in",
    },
    { term: "Email", detail: "Optional transactional mail through Resend" },
    { term: "Installable", detail: "PWA manifest and service worker for desktop and mobile" },
    { term: "Access", detail: "Admin, manager, member and viewer roles, plus scoped workspace membership" },
] as const;

export function LandingPlatform() {
    return (
        <section
            id="how-it-runs"
            className="scroll-mt-16 border-t border-[hsl(215_28%_12%)]"
        >
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
                <div className="grid gap-12 lg:grid-cols-2 lg:gap-16">
                    <div>
                        <h2 className="text-3xl font-semibold tracking-tight text-[hsl(210_20%_98%)] md:text-4xl">
                            Self-hosted, standard, yours
                        </h2>
                        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-[hsl(218_11%_65%)] md:text-base">
                            <p>
                                WorkOps is a standard Next.js application on your own
                                PostgreSQL database. Deploy it next to your other internal
                                tools, keep the backups, and adapt the source when your
                                department&rsquo;s process differs from the defaults.
                            </p>
                            <p>
                                There is no hosted service, no paid tier, and nothing to
                                cancel. The MIT license is the whole deal — the code in the
                                repository is the product.
                            </p>
                        </div>

                        <div className="mt-10 rounded-2xl border border-[hsl(262_70%_28%)] bg-[hsl(262.4_70%_10%)] p-6 md:p-8">
                            <h3 className="text-xl font-semibold tracking-tight text-[hsl(210_20%_98%)]">
                                Open source under the MIT license
                            </h3>
                            <p className="mt-2 max-w-md text-[15px] leading-relaxed text-[hsl(218_11%_70%)]">
                                Read the source, self-host it, adapt it to your department,
                                and send improvements upstream.
                            </p>
                            <a
                                href={brand.repository.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-6 inline-flex items-center rounded-lg bg-[hsl(263.4_70%_50.4%)] px-5 py-2.5 text-sm font-medium text-[hsl(210_20%_98%)] transition-colors hover:bg-[hsl(262_70%_56%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(263.4_70%_70%)] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(262.4_70%_10%)]"
                            >
                                {brand.repository.owner}/{brand.repository.repo} on GitHub
                            </a>
                        </div>
                    </div>

                    <dl className="lg:pt-2">
                        {stackFacts.map((fact) => (
                            <div
                                key={fact.term}
                                className="grid gap-1 border-b border-[hsl(215_28%_17%)] py-5 md:grid-cols-[minmax(140px,180px)_1fr] md:gap-8"
                            >
                                <dt className="text-[15px] font-semibold text-[hsl(210_20%_98%)]">
                                    {fact.term}
                                </dt>
                                <dd className="text-[15px] leading-relaxed text-[hsl(218_11%_65%)]">
                                    {fact.detail}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>
        </section>
    );
}
