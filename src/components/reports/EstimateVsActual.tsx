"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { serializeCsv } from "@/lib/reports/csv";

type VarianceState = "under" | "over" | "on";

type Variance = { state: VarianceState; deltaHours: number; ratio: number };

type ProjectRow = {
    projectId: string;
    projectName: string;
    estimatedMinutes: number;
    loggedMinutes: number;
    estimatedHours: number;
    loggedHours: number;
    taskCount: number;
    completedTaskCount: number;
    variance: Variance;
};

type MemberRow = {
    memberId: string;
    memberName: string;
    memberEmail: string;
    estimatedMinutes: number;
    loggedMinutes: number;
    estimatedHours: number;
    loggedHours: number;
    taskCount: number;
    variance: Variance;
};

type EstimateReport = {
    projects: ProjectRow[];
    members: MemberRow[];
    totals: {
        estimatedMinutes: number;
        loggedMinutes: number;
        taskCount: number;
        completedTaskCount: number;
        variance: Variance;
    };
};

type EstimateVsActualProps = {
    initialFrom?: string;
    initialTo?: string;
};

function varianceTone(state: VarianceState): string {
    if (state === "over") return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
    if (state === "under") return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
}

function varianceLabel(state: VarianceState): string {
    if (state === "over") return "Over estimate";
    if (state === "under") return "Under estimate";
    return "On estimate";
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

export function EstimateVsActual({ initialFrom = "2026-01-01", initialTo = "2026-02-01" }: EstimateVsActualProps) {
    const router = useRouter();
    const [from, setFrom] = useState(initialFrom);
    const [to, setTo] = useState(initialTo);
    const [projectId, setProjectId] = useState("");
    const [memberId, setMemberId] = useState("");
    const [report, setReport] = useState<EstimateReport | null>(null);
    const [projectOptions, setProjectOptions] = useState<ProjectRow[]>([]);
    const [memberOptions, setMemberOptions] = useState<MemberRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        const query = new URLSearchParams({ from, to });
        if (projectId) query.set("projectId", projectId);
        if (memberId) query.set("memberId", memberId);
        setLoading(true);
        setError(null);
        fetch(`/api/reports/estimate-vs-actual?${query.toString()}`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error("Unable to load estimate vs actual data");
                return response.json() as Promise<EstimateReport>;
            })
            .then((nextReport) => {
                if (!active) return;
                setReport(nextReport);
                setProjectOptions((current) => {
                    const merged = new Map(current.map((row) => [row.projectId, row]));
                    for (const row of nextReport.projects) merged.set(row.projectId, row);
                    return Array.from(merged.values()).sort((left, right) => left.projectName.localeCompare(right.projectName));
                });
                setMemberOptions((current) => {
                    const merged = new Map(current.map((row) => [row.memberId, row]));
                    for (const row of nextReport.members) merged.set(row.memberId, row);
                    return Array.from(merged.values()).sort((left, right) => left.memberName.localeCompare(right.memberName));
                });
            })
            .catch((reason: unknown) => {
                if (active && (reason as { name?: string }).name !== "AbortError") {
                    setError(reason instanceof Error ? reason.message : "Unable to load report");
                }
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
            controller.abort();
        };
    }, [from, to, projectId, memberId]);

    const chartData = useMemo(() => (report?.projects ?? []).map((row) => ({
        projectId: row.projectId,
        projectName: row.projectName,
        Estimated: row.estimatedHours,
        Logged: row.loggedHours,
    })), [report]);
    const totalVariance = report?.totals.variance;
    const selectedMember = memberOptions.find((member) => member.memberId === memberId);

    function exportCsv(): void {
        if (!report) return;
        const rows = report.projects.map((row) => [
            row.projectName,
            row.taskCount,
            row.completedTaskCount,
            row.estimatedHours,
            row.loggedHours,
            row.variance.deltaHours,
            varianceLabel(row.variance.state),
        ]);
        downloadTextFile(
            serializeCsv(["Project", "Tasks", "Done tasks", "Estimated hours", "Logged hours", "Variance hours", "State"], rows),
            "estimate-vs-actual.csv",
            "text/csv;charset=utf-8",
        );
    }

    function openProjectTasks(entry: unknown): void {
        const payload = (entry as { payload?: { projectId?: string } } | undefined)?.payload;
        if (payload?.projectId) router.push(`/tasks?projectId=${encodeURIComponent(payload.projectId)}`);
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader className="pb-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <CardTitle>Estimate vs actual</CardTitle>
                            <CardDescription>Compare task estimates with time logged in the selected range.</CardDescription>
                        </div>
                        <Button variant="outline" onClick={exportCsv} disabled={!report || loading}>
                            <Download className="mr-2 h-4 w-4" /> CSV
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-3">
                        <label className="min-w-[min(100%,12rem)] flex-1 space-y-1 text-sm">
                            <span className="font-medium">From</span>
                            <input className="min-h-11 w-full rounded-md border border-input bg-background px-3" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
                        </label>
                        <label className="min-w-[min(100%,12rem)] flex-1 space-y-1 text-sm">
                            <span className="font-medium">To</span>
                            <input className="min-h-11 w-full rounded-md border border-input bg-background px-3" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
                        </label>
                        <label className="min-w-[min(100%,12rem)] flex-1 space-y-1 text-sm">
                            <span className="font-medium">Project</span>
                            <select className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                                <option value="">All projects</option>
                                {projectOptions.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}
                            </select>
                        </label>
                        <label className="min-w-[min(100%,12rem)] flex-1 space-y-1 text-sm">
                            <span className="font-medium">Member</span>
                            <select className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3" value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                                <option value="">All members</option>
                                {memberOptions.map((member) => <option key={member.memberId} value={member.memberId}>{member.memberName}</option>)}
                            </select>
                        </label>
                    </div>
                </CardContent>
            </Card>

            {error && <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</div>}
            {loading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading report…</div>}
            {!loading && report && (
                <>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Estimated</p><p className="text-2xl font-semibold">{report.totals.estimatedMinutes / 60}h</p></CardContent></Card>
                        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Logged</p><p className="text-2xl font-semibold">{report.totals.loggedMinutes / 60}h</p></CardContent></Card>
                        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Tasks</p><p className="text-2xl font-semibold">{report.totals.taskCount}</p><p className="text-xs text-muted-foreground">{report.totals.completedTaskCount} done</p></CardContent></Card>
                        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Variance</p><p className="text-2xl font-semibold">{totalVariance?.deltaHours ?? 0}h</p><p className="text-xs text-muted-foreground">{totalVariance ? varianceLabel(totalVariance.state) : "No data"}</p></CardContent></Card>
                    </div>
                    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
                        <Card>
                            <CardHeader>
                                <CardTitle>Projects</CardTitle>
                                <CardDescription>{selectedMember ? `Showing ${selectedMember.memberName}` : "All visible members"}. Click a bar to open the filtered task list.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {chartData.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">No project activity in this range.</p> : (
                                    <div className="min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
                                        <div className="h-[22rem] min-w-0 md:min-w-[36rem]">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 40 }} onClick={openProjectTasks}>
                                                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                                    <XAxis dataKey="projectName" angle={-30} textAnchor="end" interval="preserveStartEnd" height={64} tick={{ fontSize: 10 }} />
                                                    <YAxis unit="h" tick={{ fontSize: 10 }} />
                                                    <Tooltip />
                                                    <Legend />
                                                    <Bar dataKey="Estimated" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} cursor="pointer" />
                                                    <Bar dataKey="Logged" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} cursor="pointer" />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader><CardTitle>Variance callouts</CardTitle><CardDescription>Hours logged minus hours estimated.</CardDescription></CardHeader>
                            <CardContent className="space-y-2">
                                {report.projects.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to call out.</p> : report.projects.map((project) => (
                                    <button key={project.projectId} type="button" className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${varianceTone(project.variance.state)}`} onClick={() => router.push(`/tasks?projectId=${encodeURIComponent(project.projectId)}`)}>
                                        <span className="min-w-0 truncate">{project.projectName}</span>
                                        <span className="ml-2 shrink-0 font-medium">{project.variance.deltaHours}h</span>
                                    </button>
                                ))}
                            </CardContent>
                        </Card>
                    </div>
                    <details className="rounded-xl border">
                        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">View data</summary>
                        <div className="overflow-x-auto px-4 pb-4">
                            <table className="w-full min-w-[36rem] text-sm">
                                <caption className="sr-only">Estimated, logged, and variance hours for each project</caption>
                                <thead className="border-b bg-muted/30">
                                    <tr><th scope="col" className="px-3 py-2 text-left">Project</th><th scope="col" className="px-3 py-2 text-right">Estimated hours</th><th scope="col" className="px-3 py-2 text-right">Logged hours</th><th scope="col" className="px-3 py-2 text-right">Variance hours</th></tr>
                                </thead>
                                <tbody>
                                    {report.projects.length === 0 ? <tr><td colSpan={4} className="px-3 py-3 text-center text-muted-foreground">No project activity in this range.</td></tr> : report.projects.map((project) => <tr key={project.projectId} className="border-b last:border-0"><th scope="row" className="px-3 py-2 text-left font-medium">{project.projectName}</th><td className="px-3 py-2 text-right">{project.estimatedHours}</td><td className="px-3 py-2 text-right">{project.loggedHours}</td><td className="px-3 py-2 text-right">{project.variance.deltaHours}</td></tr>)}
                                </tbody>
                            </table>
                        </div>
                        <p className="px-4 pb-3 text-xs text-muted-foreground md:hidden">Scroll for more →</p>
                    </details>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><ExternalLink className="h-3.5 w-3.5" /> Task drill-down preserves the project filter in the URL.</div>
                </>
            )}
        </div>
    );
}
