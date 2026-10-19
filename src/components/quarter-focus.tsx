"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, Sparkles, ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Quarter } from "@/lib/quarter";

export interface KpiQuarterRow {
    id: string;
    name: string;
    perspective: string;
    unit: string | null;
    needsPrevScore: boolean;
    needsCurrentUpdate: boolean;
    prevTarget: number | null;
    currentTarget: number | null;
    nextTarget: number | null;
}

interface QuarterFocusProps {
    kpis: KpiQuarterRow[];
    prevQuarter: Quarter;
    currentQuarter: Quarter;
    nextQuarter: Quarter;
    daysRemaining: number;
}

export function QuarterFocus({ kpis, prevQuarter, currentQuarter, nextQuarter, daysRemaining }: QuarterFocusProps) {
    const currentFocus = kpis.filter((k) => k.needsCurrentUpdate);
    const prevBacklog = kpis.filter((k) => k.needsPrevScore);
    const nextPlanning = kpis.filter((k) => k.nextTarget !== null);

    return (
        <div className="space-y-4">
            <FocusCard
                tone="current"
                icon={<AlertTriangle className="h-5 w-5 text-yellow-500" />}
                title={`${currentQuarter} — Needs Update`}
                description={
                    currentFocus.length === 0
                        ? "All current-quarter KPIs are up to date. Nice work."
                        : `${currentFocus.length} KPI${currentFocus.length > 1 ? "s" : ""} still need ${currentQuarter} scores. ${daysRemaining} day${daysRemaining !== 1 ? "s" : ""} left in the quarter.`
                }
                rows={currentFocus}
                targetKey="currentTarget"
                cta={`Enter ${currentQuarter} score`}
                emptyHidden={false}
            />

            <FocusCard
                tone="backlog"
                icon={<AlertCircle className="h-5 w-5 text-red-500" />}
                title={`${prevQuarter} — Backlog`}
                description={`${prevBacklog.length} KPI${prevBacklog.length > 1 ? "s" : ""} without a ${prevQuarter} score. Closing these keeps the record clean.`}
                rows={prevBacklog}
                targetKey="prevTarget"
                cta={`Fill ${prevQuarter} score`}
                emptyHidden={true}
            />

            <FocusCard
                tone="planning"
                icon={<Sparkles className="h-5 w-5 text-violet-400" />}
                title={`${nextQuarter} — Planning Ahead`}
                description={`${nextPlanning.length} KPI${nextPlanning.length > 1 ? "s" : ""} with ${nextQuarter} targets set. Review early to stay ahead.`}
                rows={nextPlanning}
                targetKey="nextTarget"
                cta={`Preview ${nextQuarter}`}
                emptyHidden={true}
                collapsible
            />
        </div>
    );
}

interface FocusCardProps {
    tone: "current" | "backlog" | "planning";
    icon: React.ReactNode;
    title: string;
    description: string;
    rows: KpiQuarterRow[];
    targetKey: "prevTarget" | "currentTarget" | "nextTarget";
    cta: string;
    emptyHidden: boolean;
    collapsible?: boolean;
}

function FocusCard({ tone, icon, title, description, rows, targetKey, cta, emptyHidden, collapsible }: FocusCardProps) {
    if (rows.length === 0 && emptyHidden) return null;

    const borderClass = tone === "current"
        ? "border-yellow-500/40"
        : tone === "backlog"
            ? "border-red-500/40"
            : "border-violet-500/30";

    return (
        <Card className={cn(borderClass)}>
            {collapsible ? (
                <details>
                    <summary className="cursor-pointer list-none">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                {icon}
                                {title}
                                <ChevronRight className="ml-auto h-4 w-4 transition-transform [details[open]_&]:rotate-90" />
                            </CardTitle>
                            <CardDescription>{description}</CardDescription>
                        </CardHeader>
                    </summary>
                    <CardContent>
                        <RowList rows={rows} targetKey={targetKey} cta={cta} />
                    </CardContent>
                </details>
            ) : (
                <>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            {icon}
                            {title}
                        </CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </CardHeader>
                    {rows.length > 0 && (
                        <CardContent>
                            <RowList rows={rows} targetKey={targetKey} cta={cta} />
                        </CardContent>
                    )}
                </>
            )}
        </Card>
    );
}

function RowList({ rows, targetKey, cta }: { rows: KpiQuarterRow[]; targetKey: "prevTarget" | "currentTarget" | "nextTarget"; cta: string }) {
    return (
        <div className="space-y-2">
            {rows.slice(0, 12).map((kpi) => {
                const target = kpi[targetKey];
                return (
                    <Link key={kpi.id} href={`/kpis/${kpi.id}`}>
                        <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors group">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-medium truncate">{kpi.name}</span>
                                    <Badge variant="outline" className="text-xs flex-shrink-0">
                                        {kpi.perspective}
                                    </Badge>
                                </div>
                                {target !== null && (
                                    <p className="text-xs text-muted-foreground">
                                        Target: {target} {kpi.unit ?? ""}
                                    </p>
                                )}
                            </div>
                            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors flex items-center gap-1">
                                {cta}
                                <ChevronRight className="h-3 w-3" />
                            </span>
                        </div>
                    </Link>
                );
            })}
            {rows.length > 12 && (
                <p className="text-xs text-muted-foreground pt-1">+{rows.length - 12} more</p>
            )}
        </div>
    );
}
