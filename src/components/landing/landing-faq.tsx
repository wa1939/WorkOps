import { brand } from "@/lib/brand";
import { productFaqs } from "@/lib/product-marketing";

export function LandingFaq() {
    return (
        <section id="faq" className="scroll-mt-16 border-t border-slate-800">
            <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 md:py-28">
                <h2 className="text-3xl font-semibold tracking-tight text-slate-50 md:text-4xl">Before you install</h2>
                <div className="mt-10 max-w-3xl divide-y divide-slate-800">
                    {productFaqs.map(item => (
                        <details key={item.question} className="group py-4">
                            <summary className="min-h-11 cursor-pointer content-center rounded text-base font-medium text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                                {item.question}
                            </summary>
                            <p className="mt-3 max-w-[70ch] text-[15px] leading-relaxed text-slate-400">{item.answer}</p>
                        </details>
                    ))}
                </div>
                <a href={`${brand.repository.url}/blob/main/docs/getting-started.md`} className="mt-8 inline-flex min-h-11 items-center text-sm text-violet-300 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400">
                    Read the installation guide
                </a>
            </div>
        </section>
    );
}
