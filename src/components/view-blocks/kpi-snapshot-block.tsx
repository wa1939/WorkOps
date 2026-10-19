"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Target, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { Block } from "./block-editor";
import { currentQuarter, targetForQuarter } from "@/lib/quarter";

type Kpi = {
    id: string;
    name: string;
    perspective: string;
    unit: string | null;
    q1Target: number | null;
    q2Target: number | null;
    q3Target: number | null;
    q4Target: number | null;
    updates: { score: number | null; value: number | null; quarter: string }[];
};

export function KpiSnapshotBlock({ block }: { block: Block }) {
    const id = block.kpiId as string | undefined;
    const [kpi, setKpi] = useState<Kpi | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!id) { setLoading(false); return; }
        fetch(`/api/kpis/${id}`)
            .then((r) => r.ok ? r.json() : null)
            .then((data: Kpi | null) => setKpi(data))
            .finally(() => setLoading(false));
    }, [id]);

    if (!id) {
        return (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Pick a KPI in the editor.
            </div>
        );
    }

    if (loading) {
        return (
            <div className="rounded-xl border border-border bg-card p-5 flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!kpi) {
        return (
            <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                KPI not found.
            </div>
        );
    }

    const q = currentQuarter();
    const target = targetForQuarter(kpi, q);
    const latest = kpi.updates[0];
    const score = latest?.score ?? null;
    const value = latest?.value ?? null;
    const progress = target && value != null ? Math.min(100, (value / target) * 100) : null;

    return (
        <Link href={`/kpis/${kpi.id}`}>
            <div className="rounded-xl border border-border bg-gradient-to-br from-emerald-500/10 to-transparent p-4 hover:border-emerald-500/40 transition-colors">
                <div className="flex items-start gap-2 mb-2">
                    <Target className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">{kpi.perspective}</p>
                        <p className="font-medium text-sm truncate">{kpi.name}</p>
                    </div>
                </div>
                <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between text-sm">
                        <span className="text-muted-foreground">{q} target</span>
                        <span className="font-medium">
                            {target ?? "—"} {kpi.unit ?? ""}
                        </span>
                    </div>
                    {progress !== null && (
                        <>
                            <Progress value={progress} className="h-1.5" />
                            <div className="flex items-baseline justify-between text-xs text-muted-foreground">
                                <span>{value} {kpi.unit ?? ""}</span>
                                <span>{Math.round(progress)}%</span>
                            </div>
                        </>
                    )}
                    {score !== null && (
                        <p className="text-xs text-muted-foreground">Score: {score}/5</p>
                    )}
                </div>
            </div>
        </Link>
    );
}
