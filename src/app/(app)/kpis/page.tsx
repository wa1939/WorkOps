import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Plus, Target, AlertCircle, CheckCircle, TrendingUp, BarChart3 } from "lucide-react";
import Link from "next/link";
import { getInitials, cn, formatDate } from "@/lib/utils";
import { QuarterFocus } from "@/components/quarter-focus";
import { KpiSparkline } from "@/components/kpi-sparkline";
import { EmptyState } from "@/components/ui/empty-state";
import { currentQuarter as getCurrentQuarter, previousQuarter, nextQuarter as getNextQuarter, targetForQuarter, daysRemainingInQuarter } from "@/lib/quarter";

async function getKPIs() {
    const kpis = await prisma.kPI.findMany({
        include: {
            owner: true,
            updates: {
                orderBy: { createdAt: "desc" },
                take: 20,
            },
            tasks: { select: { status: true } },
        },
        orderBy: [
            { status: "asc" },
            { updatedAt: "desc" },
        ],
    });

    return kpis;
}

const statusConfig = {
    ON_TRACK: { label: "On Track", color: "bg-green-500/10 text-green-600", icon: CheckCircle },
    AT_RISK: { label: "At Risk", color: "bg-yellow-500/10 text-yellow-600", icon: AlertCircle },
    OFF_TRACK: { label: "Off Track", color: "bg-red-500/10 text-red-600", icon: AlertCircle },
};

export default async function KPIsPage() {
    const session = await auth();
    if (!session?.user) return null;

    const kpis = await getKPIs();

    // Group by perspective
    const kpisByPerspective = kpis.reduce<Record<string, typeof kpis>>((acc, kpi) => {
        const perspective = kpi.perspective || "Other";
        if (!acc[perspective]) acc[perspective] = [];
        acc[perspective].push(kpi);
        return acc;
    }, {});

    // Stats
    const onTrack = kpis.filter((k) => k.status === "ON_TRACK").length;
    const atRisk = kpis.filter((k) => k.status === "AT_RISK").length;
    const offTrack = kpis.filter((k) => k.status === "OFF_TRACK").length;

    // Quarter focus buckets
    const now = new Date();
    const nowQ = getCurrentQuarter(now);
    const prevQ = previousQuarter(nowQ);
    const nextQ = getNextQuarter(nowQ);
    const daysLeft = daysRemainingInQuarter(now);

    const kpisForFocus = kpis.map((kpi) => {
        const hasScoreFor = (q: typeof nowQ) =>
            kpi.updates.some((u) => u.quarter === q && u.score !== null && u.score !== undefined);

        return {
            id: kpi.id,
            name: kpi.name,
            perspective: kpi.perspective,
            unit: kpi.unit,
            needsPrevScore: !hasScoreFor(prevQ),
            needsCurrentUpdate: !hasScoreFor(nowQ),
            prevTarget: targetForQuarter(kpi, prevQ),
            currentTarget: targetForQuarter(kpi, nowQ),
            nextTarget: targetForQuarter(kpi, nextQ),
        };
    });

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">KPIs</h1>
                    <p className="text-muted-foreground">Department key performance indicators</p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" asChild>
                        <Link href="/kpis/score">
                            <BarChart3 className="mr-2 h-4 w-4" />
                            Score quarter
                        </Link>
                    </Button>
                    <Button asChild className="max-sm:w-full">
                        <Link href="/kpis/new">
                            <Plus className="mr-2 h-4 w-4" />
                            New KPI
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total KPIs</CardTitle>
                        <Target className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.length}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">On Track</CardTitle>
                        <CheckCircle className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{onTrack}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">At Risk</CardTitle>
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-600">{atRisk}</div>
                    </CardContent>
                </Card>
                <Card className={cn(offTrack > 0 && "border-red-500/50")}>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Off Track</CardTitle>
                        <AlertCircle className="h-4 w-4 text-red-500" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">{offTrack}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Quarter focus — current + backlog + planning */}
            <QuarterFocus
                kpis={kpisForFocus}
                prevQuarter={prevQ}
                currentQuarter={nowQ}
                nextQuarter={nextQ}
                daysRemaining={daysLeft}
            />

            {/* KPIs by Perspective */}
            {Object.entries(kpisByPerspective).map(([perspective, perspectiveKpis]) => (
                <div key={perspective} className="space-y-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        {perspective}
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {perspectiveKpis.map((kpi) => {
                            const config = statusConfig[kpi.status];
                            const lastUpdate = kpi.updates[0];
                            const currentValue = lastUpdate?.value;
                            const progress = kpi.annualTarget && currentValue
                                ? Math.min(Math.round((currentValue / kpi.annualTarget) * 100), 100)
                                : 0;

                            return (
                                <Link key={kpi.id} href={`/kpis/${kpi.id}`}>
                                    <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
                                        <CardHeader className="pb-3">
                                            <div className="flex items-start justify-between gap-2">
                                                <CardTitle className="text-lg line-clamp-2">{kpi.name}</CardTitle>
                                                <Badge className={config.color}>{config.label}</Badge>
                                            </div>
                                            <CardDescription className="line-clamp-1">{kpi.objective}</CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            {kpi.annualTarget && (
                                                <div className="space-y-2">
                                                    <div className="flex justify-between text-sm">
                                                        <span className="text-muted-foreground">Progress to Target</span>
                                                        <span className="font-medium">
                                                            {currentValue || 0} / {kpi.annualTarget} {kpi.unit}
                                                        </span>
                                                    </div>
                                                    <Progress value={progress} className="h-2" />
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex-1 min-w-0 text-xs text-muted-foreground">Trend</div>
                                                <KpiSparkline updates={kpi.updates} />
                                            </div>

                                            <div className="flex items-center justify-between text-sm">
                                                <div className="text-muted-foreground">
                                                    {lastUpdate ? (
                                                        <span>Updated {formatDate(lastUpdate.createdAt)}</span>
                                                    ) : (
                                                        <span className="text-yellow-600">No updates yet</span>
                                                    )}
                                                </div>
                                                {kpi.owner && (
                                                    <Avatar className="h-6 w-6">
                                                        <AvatarImage src={kpi.owner.image || ""} />
                                                        <AvatarFallback className="text-xs">{getInitials(kpi.owner.name)}</AvatarFallback>
                                                    </Avatar>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            ))}

            {kpis.length === 0 && (
                <EmptyState
                    icon={Target}
                    title="No KPIs defined yet"
                    description="KPIs are the department's compass. The 2026 BSC ships with 24 shared indicators — you can also add your own."
                    actions={[
                        { label: "Create a KPI", href: "/kpis/new", icon: Plus, variant: "primary" },
                        { label: "Import 2026 BSC (Admin)", href: "/admin", icon: BarChart3, variant: "secondary" },
                    ]}
                />
            )}
        </div>
    );
}
