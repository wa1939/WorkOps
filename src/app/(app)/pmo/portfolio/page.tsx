import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExternalActionsList } from "@/components/pmo/external-actions-list";
import { PmoBackButton } from "@/components/pmo/pmo-back-button";
import { PmoFilters } from "@/components/pmo/pmo-filters";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { toRiyadhDate } from "@/lib/pmo/date";
import { groupPortfolioRows, parsePmoFilters } from "@/lib/pmo/portfolio";
import { loadPmoPortfolio } from "@/lib/pmo/portfolio-query";
import { cn } from "@/lib/utils";
import { TableCellAssist } from "@/components/sabah/forms/table-cell-assist";

export default async function PortfolioPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const actor = await getCurrentPmoActor();
    if (!actor) return null;
    const raw = await searchParams;
    const filters = parsePmoFilters(raw);
    const data = await loadPmoPortfolio(filters, actor, toRiyadhDate(new Date()));
    const groups = groupPortfolioRows(data.rows);
    const query = new URLSearchParams(
        Object.entries(raw).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : [])),
    ).toString();
    const cards = {
        Open: data.metrics.open,
        "Due soon": data.metrics.dueSoon,
        Overdue: data.metrics.overdue,
        Completed: data.metrics.completed,
        "On time": data.metrics.completedOnTime,
        "On-time rate": data.metrics.onTimeCompletionRate == null ? "N/A" : `${data.metrics.onTimeCompletionRate}%`,
    };
    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-primary">PMO Follow-up</p>
                    <h1 className="text-3xl font-bold">Portfolio</h1>
                </div>
                <div className="flex gap-2">
                    <PmoBackButton />
                    <Button variant="outline" asChild>
                        <Link href="/pmo/timeline">Timeline</Link>
                    </Button>
                    <Button asChild>
                        <a href={`/api/pmo/export?${query}`}>Export CSV</a>
                    </Button>
                </div>
            </header>
            <PmoFilters filters={filters} {...data.options} clearHref="/pmo/portfolio" />
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {Object.entries(cards).map(([label, value]) => {
                    const emphasize = label === "Overdue" && data.metrics.overdue > 0;
                    return (
                        <div
                            key={label}
                            className={cn(
                                "rounded-xl border p-4",
                                emphasize ? "border-red-500/50 bg-red-500/5" : "bg-card",
                            )}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm text-muted-foreground">{label}</p>
                                {label === "Overdue" && (
                                    <AlertTriangle
                                        className={cn(
                                            "h-4 w-4 shrink-0",
                                            data.metrics.overdue > 0 ? "text-red-500" : "text-muted-foreground",
                                        )}
                                    />
                                )}
                            </div>
                            <p className={cn("text-2xl font-bold", emphasize && "text-red-500")}>{value}</p>
                        </div>
                    );
                })}
            </div>
            {Object.entries(groups).map(([workArea, rows]) => (
                <section key={workArea} className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold">{workArea}</h2>
                        <span className="text-sm text-muted-foreground">{rows.length} actions</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1" aria-label={`Sabah PMO action context for ${workArea}`}>
                        {rows.map((row) => <TableCellAssist key={row.id} entityId={row.id} columnKey="status" />)}
                    </div>
                    <ExternalActionsList actions={rows} />
                </section>
            ))}
        </div>
    );
}
