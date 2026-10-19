"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectReport } from "@/lib/reports/project-report";
import { statusFillColor } from "@/lib/ui/status-tokens";

function formatDue(value: string | null): string {
    return value ? new Date(value).toLocaleDateString() : "—";
}

export type ProjectReportDrawerProps = { projectId: string; projectName?: string };

export function ProjectReportDrawer({ projectId, projectName }: ProjectReportDrawerProps) {
    const [open, setOpen] = useState(false);
    const [report, setReport] = useState<ProjectReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        let active = true;
        setLoading(true);
        setError(null);
        fetch(`/api/reports/project/${encodeURIComponent(projectId)}`, { signal: controller.signal })
            .then(async (response) => {
                if (!response.ok) throw new Error(response.status === 404 ? "Project report not found" : "Unable to load project report");
                return response.json() as Promise<ProjectReport>;
            })
            .then((nextReport) => { if (active) setReport(nextReport); })
            .catch((reason: unknown) => { if (active && (reason as { name?: string }).name !== "AbortError") setError(reason instanceof Error ? reason.message : "Unable to load project report"); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; controller.abort(); };
    }, [open, projectId]);

    async function exportWorkbook(): Promise<void> {
        setExporting(true);
        setError(null);
        try {
            const response = await fetch(`/api/reports/project/${encodeURIComponent(projectId)}/export`, { method: "POST" });
            if (!response.ok) throw new Error("Unable to export project report");
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `${(report?.project.name ?? projectName ?? "project").replace(/[^a-z0-9]+/gi, "_")}_report.xlsx`;
            anchor.click();
            window.URL.revokeObjectURL(url);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Unable to export project report");
        } finally {
            setExporting(false);
        }
    }

    return (
        <>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Report</Button>
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetContent className="w-full min-w-0 overflow-y-auto sm:max-w-[900px]">
                    <SheetHeader className="pr-8">
                        <SheetTitle>{report?.project.name ?? projectName ?? "Project report"}</SheetTitle>
                        <SheetDescription>Overview, member time, and task detail.</SheetDescription>
                    </SheetHeader>
                    {loading && <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading report…</div>}
                    {error && <div role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>}
                    {!loading && report && (
                        <Tabs defaultValue="overview" className="mt-5">
                            <TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="members">Members</TabsTrigger><TabsTrigger value="tasks">Tasks</TabsTrigger></TabsList>
                            <TabsContent value="overview" className="space-y-5">
                                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                    <StatCard label="Tasks" value={String(report.summary.taskCount)} />
                                    <StatCard label="Done" value={`${report.summary.donePercent}%`} />
                                    <StatCard label="Overdue" value={String(report.summary.overdueTaskCount)} />
                                    <StatCard label="Est. / logged" value={`${report.summary.estimatedHours}h / ${report.summary.loggedHours}h`} />
                                </div>
                                <div className="grid gap-5 lg:grid-cols-2">
                                    <Card><CardHeader><CardTitle className="text-base">Status mix</CardTitle></CardHeader><CardContent><div className="min-w-0 h-56"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={report.statusMix} dataKey="count" nameKey="status" innerRadius={52} outerRadius={78} paddingAngle={2}>{report.statusMix.map((item) => <Cell key={item.status} fill={statusFillColor(item.status)} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div></CardContent></Card>
                                    <Card><CardHeader><CardTitle className="text-base">Priority mix</CardTitle></CardHeader><CardContent><div className="min-w-0 h-56"><ResponsiveContainer width="100%" height="100%"><BarChart data={report.priorityMix} layout="vertical" margin={{ top: 4, right: 12, left: 12, bottom: 4 }}><XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} /><YAxis type="category" dataKey="priority" width={56} tick={{ fontSize: 10 }} /><Tooltip /><Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} /></BarChart></ResponsiveContainer></div></CardContent></Card>
                                </div>
                                <details className="rounded-lg border">
                                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">View data</summary>
                                    <div className="overflow-x-auto px-3 pb-3">
                                        <table className="w-full min-w-[20rem] text-sm">
                                            <caption className="sr-only">Counts shown in the status and priority mix charts</caption>
                                            <thead className="border-b bg-muted/30">
                                                <tr><th scope="col" className="px-3 py-2 text-left">Type</th><th scope="col" className="px-3 py-2 text-left">Value</th><th scope="col" className="px-3 py-2 text-right">Count</th></tr>
                                            </thead>
                                            <tbody>
                                                {report.statusMix.map((item) => <tr key={`status-${item.status}`} className="border-b last:border-0"><th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">Status</th><td className="px-3 py-2">{item.status}</td><td className="px-3 py-2 text-right">{item.count}</td></tr>)}
                                                {report.priorityMix.map((item) => <tr key={`priority-${item.priority}`} className="border-b last:border-0"><th scope="row" className="px-3 py-2 text-left font-normal text-muted-foreground">Priority</th><td className="px-3 py-2">{item.priority}</td><td className="px-3 py-2 text-right">{item.count}</td></tr>)}
                                            </tbody>
                                        </table>
                                    </div>
                                    <p className="px-3 pb-3 text-xs text-muted-foreground md:hidden">Scroll for more →</p>
                                </details>
                            </TabsContent>
                            <TabsContent value="members" className="space-y-4">
                                <div className="flex justify-end"><Button size="sm" variant="outline" onClick={exportWorkbook} disabled={exporting}><Download className="mr-2 h-4 w-4" /> {exporting ? "Exporting…" : "Export XLSX"}</Button></div>
                                <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[34rem] text-sm"><thead className="border-b bg-muted/30"><tr><th className="px-3 py-2 text-left">Member</th><th className="px-3 py-2 text-left">Email</th><th className="px-3 py-2 text-left">Role</th><th className="px-3 py-2 text-right">Logged hours</th><th className="px-3 py-2 text-right">Tasks</th></tr></thead><tbody>{report.members.map((member) => <tr key={member.memberId} className="border-b last:border-0"><td className="px-3 py-2 font-medium">{member.memberName}</td><td className="px-3 py-2 text-muted-foreground">{member.memberEmail}</td><td className="px-3 py-2">{member.role ?? "—"}</td><td className="px-3 py-2 text-right">{member.loggedHours}</td><td className="px-3 py-2 text-right">{member.taskCount}</td></tr>)}</tbody></table></div><p className="px-3 text-xs text-muted-foreground md:hidden">Scroll for more →</p>
                            </TabsContent>
                            <TabsContent value="tasks" className="space-y-4">
                                <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[48rem] text-sm"><thead className="border-b bg-muted/30"><tr><th className="px-3 py-2 text-left">Task</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">Priority</th><th className="px-3 py-2 text-right">Estimate</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Due</th></tr></thead><tbody>{report.tasks.map((task) => <tr key={task.id} className="border-b last:border-0"><td className="px-3 py-2"><div className="font-medium">{task.title}</div><div className="text-xs text-muted-foreground">{task.taskKey ?? task.id}</div></td><td className="px-3 py-2">{task.status}</td><td className="px-3 py-2">{task.priority}</td><td className="px-3 py-2 text-right">{task.estimatedHours}h</td><td className="px-3 py-2 text-right">{task.loggedHours}h</td><td className="px-3 py-2 text-right">{formatDue(task.dueAt)}</td></tr>)}</tbody></table></div><p className="px-3 text-xs text-muted-foreground md:hidden">Scroll for more →</p>
                            </TabsContent>
                        </Tabs>
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return <div className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>;
}
