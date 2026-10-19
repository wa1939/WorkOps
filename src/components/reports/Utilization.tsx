"use client";

import { useEffect, useState } from "react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serializeCsv } from "@/lib/reports/csv";

type State = "under" | "healthy" | "over";

type WeekRow = {
    weekStart: string;
    capacityHours: number;
    loggedHours: number;
    plannedHours: number;
    utilizationPercent: number;
    state: State;
};

type MemberRow = {
    memberId: string;
    memberName: string;
    memberEmail: string;
    capacityHours: number;
    loggedHours: number;
    plannedHours: number;
    utilizationPercent: number;
    state: State;
    weeks: WeekRow[];
};

type UtilizationReport = {
    from: string;
    to: string;
    dataSource: string;
    weeks: WeekRow[];
    members: MemberRow[];
};

type UtilizationProps = { initialFrom?: string; initialTo?: string };

function stateTone(state: State): string {
    if (state === "over") return "bg-rose-500/20 text-rose-800 dark:text-rose-200";
    if (state === "healthy") return "bg-emerald-500/20 text-emerald-800 dark:text-emerald-200";
    return "bg-amber-500/20 text-amber-800 dark:text-amber-200";
}

function downloadTextFile(content: string, fileName: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.URL.revokeObjectURL(url);
}

export function Utilization({ initialFrom = "2026-01-01", initialTo = "2026-02-01" }: UtilizationProps) {
    const [from, setFrom] = useState(initialFrom);
    const [to, setTo] = useState(initialTo);
    const [report, setReport] = useState<UtilizationReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        setLoading(true);
        setError(null);
        const query = new URLSearchParams({ from, to });
        fetch(`/api/reports/utilization?${query.toString()}`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error("Unable to load utilization data");
                return response.json() as Promise<UtilizationReport>;
            })
            .then((nextReport) => { if (active) setReport(nextReport); })
            .catch((reason: unknown) => {
                if (active && (reason as { name?: string }).name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load report");
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; controller.abort(); };
    }, [from, to]);

    function exportCsv(): void {
        if (!report) return;
        const rows: unknown[][] = [];
        for (const member of report.members) {
            for (const week of member.weeks) {
                rows.push([member.memberName, member.memberEmail, week.weekStart, week.capacityHours, week.loggedHours, week.plannedHours, week.utilizationPercent, week.state]);
            }
        }
        downloadTextFile(
            serializeCsv(["Member", "Email", "Week", "Capacity hours", "Logged hours", "Planned hours", "Utilization %", "State"], rows),
            "utilization.csv",
            "text/csv;charset=utf-8",
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="pb-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><CardTitle>Utilization</CardTitle><CardDescription>Capacity, logged time, and planned load by member and week.</CardDescription></div>
                        <Button variant="outline" onClick={exportCsv} disabled={!report || loading}><Download className="mr-2 h-4 w-4" /> CSV</Button>
                    </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                    <label className="min-w-[min(100%,14rem)] flex-1 space-y-1 text-sm"><span className="font-medium">From</span><input className="min-h-11 w-full rounded-md border border-input bg-background px-3" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
                    <label className="min-w-[min(100%,14rem)] flex-1 space-y-1 text-sm"><span className="font-medium">To</span><input className="min-h-11 w-full rounded-md border border-input bg-background px-3" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
                </CardContent>
            </Card>
            {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</div>}
            {loading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading utilization…</div>}
            {!loading && report && (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><span>{report.members.length} members · {report.weeks.length} weeks</span><span>Source: {report.dataSource === "live+snapshot" ? "live actuals + workload snapshots" : "live actuals"}</span></div>
                    <Card>
                        <CardHeader><CardTitle>Weekly trend</CardTitle><CardDescription>Team logged hours divided by team capacity.</CardDescription></CardHeader>
                        <CardContent>
                            {report.weeks.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">No weeks in this range.</p> : <div className="min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x"><div className="h-72 min-w-0 md:min-w-[32rem]"><ResponsiveContainer width="100%" height="100%"><LineChart data={report.weeks} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}><CartesianGrid strokeDasharray="3 3" opacity={0.2} /><XAxis dataKey="weekStart" interval="preserveStartEnd" tick={{ fontSize: 10 }} /><YAxis unit="%" tick={{ fontSize: 10 }} /><Tooltip formatter={(value: number) => [`${value}%`, "Utilization"]} /><Line type="monotone" dataKey="utilizationPercent" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 4 }} /></LineChart></ResponsiveContainer></div></div>}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>Capacity heat table</CardTitle><CardDescription>Each cell is member utilization for that week. Under 80% is under capacity; over 100% is overloaded.</CardDescription></CardHeader>
                        <CardContent className="overflow-x-auto overscroll-x-contain p-0 touch-pan-x">
                            {report.members.length === 0 ? <p className="p-6 text-sm text-muted-foreground">No members in this range.</p> : <table className="w-full min-w-[42rem] text-sm"><thead className="border-b bg-muted/30"><tr><th className="sticky left-0 z-10 bg-muted/30 px-4 py-3 text-left font-medium">Member</th>{report.weeks.map((week) => <th key={week.weekStart} className="px-3 py-3 text-center font-medium">{week.weekStart}</th>)}<th className="px-4 py-3 text-right font-medium">Range</th></tr></thead><tbody>{report.members.map((member) => <tr key={member.memberId} className="border-b last:border-0"><th className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-medium"><div>{member.memberName}</div><div className="text-xs font-normal text-muted-foreground">{member.loggedHours}h / {member.capacityHours}h</div></th>{report.weeks.map((week) => { const cell = member.weeks.find((row) => row.weekStart === week.weekStart); return <td key={week.weekStart} className="px-2 py-3 text-center"><span className={`inline-flex min-w-16 justify-center rounded-md px-2 py-1 text-xs font-medium ${stateTone(cell?.state ?? "under")}`}>{cell?.utilizationPercent ?? 0}%</span></td>; })}<td className={`px-4 py-3 text-right font-medium ${member.state === "over" ? "text-rose-700 dark:text-rose-300" : ""}`}>{member.utilizationPercent}%</td></tr>)}</tbody></table>}
                            {report.members.length > 0 && <p className="px-4 pb-3 text-xs text-muted-foreground md:hidden">Scroll for more →</p>}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
}
