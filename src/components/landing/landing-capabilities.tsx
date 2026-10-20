/**
 * The capability ledger: every line is a real, codebase-evidenced feature —
 * no invented metrics, testimonials, or pricing. Typographic rows with
 * hairline dividers instead of card grids.
 */

import { productCapabilities } from "@/lib/product-marketing";
import { brand } from "@/lib/brand";

export function LandingCapabilities() {
    return (
        <section id="capabilities" className="scroll-mt-16">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
                <div className="max-w-2xl">
                    <h2 className="text-3xl font-semibold tracking-tight text-[hsl(210_20%_98%)] md:text-4xl">
                        What WorkOps does
                    </h2>
                    <p className="mt-4 text-lg leading-relaxed text-[hsl(218_11%_65%)]">
                        One hub for the whole operating rhythm of a department —
                        everything below ships in the source you can read today.
                    </p>
                </div>

                <div className="mt-14 space-y-16">
                    {productCapabilities.map((group) => (
                        <div key={group.heading}>
                            <h3 className="text-lg font-semibold tracking-tight text-[hsl(210_20%_98%)]">
                                {group.heading}
                            </h3>
                            <p className="mt-1 text-sm text-[hsl(218_11%_60%)]">
                                {group.framing}
                            </p>
                            <ul className="mt-6">
                                {group.items.map((item) => (
                                    <li
                                        key={item.name}
                                        className="grid gap-1 border-b border-[hsl(215_28%_17%)] py-5 md:grid-cols-[minmax(180px,240px)_1fr] md:gap-10"
                                    >
                                        <h4 className="text-[15px] font-semibold text-[hsl(210_20%_98%)]">
                                            {item.name}
                                        </h4>
                                        <p className="text-[15px] leading-relaxed text-[hsl(218_11%_65%)]">
                                            {item.description}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <a href={`${brand.repository.url}/blob/main/docs/capabilities.md`} className="mt-10 inline-flex min-h-11 items-center text-sm text-violet-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                    Explore the complete feature guide
                </a>
            </div>
        </section>
    );
}
