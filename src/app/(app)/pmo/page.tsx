import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExternalActionsList } from "@/components/pmo/external-actions-list";
import { PmoFilters } from "@/components/pmo/pmo-filters";
import { prisma } from "@/lib/prisma";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { toRiyadhDate } from "@/lib/pmo/date";
import { parsePmoFilters } from "@/lib/pmo/portfolio";
import { loadPmoPortfolio } from "@/lib/pmo/portfolio-query";
import { cn } from "@/lib/utils";

export default async function PmoPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const actor = await getCurrentPmoActor();
    if (!actor) return null;
    const filters = parsePmoFilters(await searchParams);
    const data = await loadPmoPortfolio(filters, actor, toRiyadhDate(new Date()));
    const orphanedCount = await prisma.externalAction.count({
        where: { owner: { isActive: false }, task: { status: { notIn: ["DONE", "CANCELED"] } } },
    });
    const counts = {
        overdue: data.rows.filter((item) => item.dueBucket === "OVERDUE").length,
        due7: data.rows.filter((item) => item.dueBucket === "DUE_7").length,
        due30: data.rows.filter((item) => item.dueBucket === "DUE_30").length,
    };
    const buckets: Array<{ label: string; count: number; bucket: string }> = [
        { label: "Overdue", count: counts.overdue, bucket: "OVERDUE" },
        { label: "Due in 7 days", count: counts.due7, bucket: "DUE_7" },
        { label: "Due in 30 days", count: counts.due30, bucket: "DUE_30" },
    ];
    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <p className="font-medium text-primary">Priority Inbox</p>
                    <h1 className="text-3xl font-bold">PMO Follow-up</h1>
                    <p className="text-muted-foreground">Owner-focused external actions, ordered by deadline.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" asChild>
                        <Link href="/pmo/portfolio">Portfolio</Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link href="/pmo/timeline">Timeline</Link>
                    </Button>
                    <Button variant="outline" asChild>
                        <Link href="/pmo/settings">Settings</Link>
                    </Button>
                    {actor.role !== "VIEWER" && (
                        <Button asChild className="max-sm:w-full">
                            <Link href="/pmo/actions/new">New external action</Link>
                        </Button>
                    )}
                </div>
            </header>
            {orphanedCount > 0 && (
                <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                        {orphanedCount} open action{orphanedCount === 1 ? "" : "s"} have a deactivated owner — reassign
                        an owner before they stall.
                    </span>
                </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
                {buckets.map(({ label, count, bucket }) => {
                    const emphasize = bucket === "OVERDUE" && count > 0;
                    return (
                        <Link
                            key={bucket}
                            href={`/pmo?dueBucket=${bucket}`}
                            className={cn(
                                "rounded-xl border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                emphasize ? "border-red-500/50 bg-red-500/5" : "bg-card",
                            )}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <p className="text-sm text-muted-foreground">{label}</p>
                                {bucket === "OVERDUE" && (
                                    <AlertTriangle
                                        className={cn(
                                            "h-4 w-4 shrink-0",
                                            count > 0 ? "text-red-500" : "text-muted-foreground",
                                        )}
                                    />
                                )}
                            </div>
                            <p className={cn("text-3xl font-bold", emphasize && "text-red-500")}>{count}</p>
                        </Link>
                    );
                })}
            </div>
            <PmoFilters filters={filters} {...data.options} />
            <ExternalActionsList actions={data.rows} />
        </div>
    );
}
