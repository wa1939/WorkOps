import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    ArrowLeft,
    Target,
    TrendingUp,
    AlertCircle,
    CheckCircle
} from "lucide-react";
import Link from "next/link";
import { formatDate, getInitials, cn } from "@/lib/utils";
import { QuarterlyScores } from "@/components/quarterly-scores";
import { KpiTrendChart } from "@/components/kpi-trend-chart";

async function getKPI(id: string) {
    const kpi = await prisma.kPI.findUnique({
        where: { id },
        include: {
            owner: true,
            updates: {
                orderBy: { createdAt: "desc" },
                include: { createdBy: true }
            },
            tasks: {
                include: { assignments: { include: { user: true } } },
                take: 5,
            },
        },
    });

    return kpi;
}

const statusConfig = {
    ON_TRACK: { label: "On Track", color: "bg-green-500/10 text-green-600", icon: CheckCircle },
    AT_RISK: { label: "At Risk", color: "bg-yellow-500/10 text-yellow-600", icon: AlertCircle },
    OFF_TRACK: { label: "Off Track", color: "bg-red-500/10 text-red-600", icon: AlertCircle },
};

export default async function KPIDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) return null;

    const { id } = await params;
    const kpi = await getKPI(id);

    if (!kpi) {
        notFound();
    }

    const config = statusConfig[kpi.status];
    const latestUpdate = kpi.updates[0];
    const currentValue = latestUpdate?.value || 0;
    const progress = kpi.annualTarget
        ? Math.min(Math.round((currentValue / kpi.annualTarget) * 100), 100)
        : 0;

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6">
                <Button variant="ghost" asChild>
                    <Link href="/kpis">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to KPIs
                    </Link>
                </Button>
            </div>

            {/* Header */}
            <div className="mb-6">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <Badge variant="outline">{kpi.perspective}</Badge>
                            <Badge className={config.color}>{config.label}</Badge>
                        </div>
                        <h1 className="text-3xl font-bold">{kpi.name}</h1>
                        <p className="text-muted-foreground mt-2">{kpi.objective}</p>
                    </div>
                    <Button asChild>
                        <Link href={`/kpis/${kpi.id}/edit`}>Edit KPI</Link>
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Progress Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Target className="h-5 w-5" />
                                Progress to Annual Target
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                <div className="flex items-end justify-between">
                                    <div>
                                        <p className="text-4xl font-bold">{currentValue}</p>
                                        <p className="text-sm text-muted-foreground">{kpi.unit}</p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-lg font-medium text-muted-foreground">
                                            / {kpi.annualTarget} {kpi.unit}
                                        </p>
                                        <p className="text-sm text-muted-foreground">Annual Target</p>
                                    </div>
                                </div>
                                <Progress value={progress} className="h-4" />
                                <p className="text-sm text-muted-foreground">{progress}% of target reached</p>
                            </div>

                            {/* Quarterly Targets */}
                            {(kpi.q1Target || kpi.q2Target || kpi.q3Target || kpi.q4Target) && (
                                <div className="mt-6 pt-6 border-t">
                                    <h4 className="font-medium mb-3">Quarterly Targets</h4>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                                        <div className="p-3 rounded-lg bg-muted/50">
                                            <p className="text-lg font-bold">{kpi.q1Target || "-"}</p>
                                            <p className="text-xs text-muted-foreground">Q1</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-muted/50">
                                            <p className="text-lg font-bold">{kpi.q2Target || "-"}</p>
                                            <p className="text-xs text-muted-foreground">Q2</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-muted/50">
                                            <p className="text-lg font-bold">{kpi.q3Target || "-"}</p>
                                            <p className="text-xs text-muted-foreground">Q3</p>
                                        </div>
                                        <div className="p-3 rounded-lg bg-muted/50">
                                            <p className="text-lg font-bold">{kpi.q4Target || "-"}</p>
                                            <p className="text-xs text-muted-foreground">Q4</p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Trend Chart */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5" />
                                Trend
                            </CardTitle>
                            <CardDescription>Historical updates with target overlays and performance-band shading.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <KpiTrendChart
                                updates={kpi.updates}
                                level1={kpi.level1}
                                level2={kpi.level2}
                                level3={kpi.level3}
                                level4={kpi.level4}
                                level5={kpi.level5}
                                annualTarget={kpi.annualTarget}
                                unit={kpi.unit}
                            />
                        </CardContent>
                    </Card>

                    {/* Quarterly Scores */}
                    <QuarterlyScores
                        kpiId={kpi.id}
                        kpiName={kpi.name}
                        expectedUpdatedAt={kpi.updatedAt.toISOString()}
                        unit={kpi.unit}
                        trackingPeriod={kpi.trackingPeriod}
                        q1Target={kpi.q1Target}
                        q2Target={kpi.q2Target}
                        q3Target={kpi.q3Target}
                        q4Target={kpi.q4Target}
                        updates={kpi.updates || []}
                    />

                    {/* Updates History */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5" />
                                Update History
                            </CardTitle>
                            <CardDescription>Track progress over time</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {kpi.updates.length === 0 ? (
                                <p className="text-center text-muted-foreground py-8">No updates yet</p>
                            ) : (
                                <div className="space-y-4">
                                    {kpi.updates.map((update) => (
                                        <div key={update.id} className="flex items-start gap-4 p-3 rounded-lg border">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-bold text-lg">{update.value} {kpi.unit}</span>
                                                    {update.period && (
                                                        <Badge variant="outline" className="text-xs">{update.period}</Badge>
                                                    )}
                                                </div>
                                                {update.note && (
                                                    <p className="text-sm text-muted-foreground">{update.note}</p>
                                                )}
                                                <p className="text-xs text-muted-foreground mt-2">
                                                    {formatDate(update.createdAt)} by {update.createdBy?.name || "Unknown"}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Sidebar */}
                <div className="space-y-6">
                    {/* Owner */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Owner</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {kpi.owner ? (
                                <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10">
                                        <AvatarImage src={kpi.owner.image || ""} />
                                        <AvatarFallback>{getInitials(kpi.owner.name)}</AvatarFallback>
                                    </Avatar>
                                    <div>
                                        <p className="font-medium">{kpi.owner.name}</p>
                                        <p className="text-sm text-muted-foreground">{kpi.owner.email}</p>
                                    </div>
                                </div>
                            ) : (
                                <p className="text-muted-foreground">No owner assigned</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Definition */}
                    {kpi.definition && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Definition</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm">{kpi.definition}</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Details */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Details</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm space-y-2">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Reminder</span>
                                <span>{kpi.reminderRule || "None"}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Created</span>
                                <span>{formatDate(kpi.createdAt)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Updated</span>
                                <span>{formatDate(kpi.updatedAt)}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
