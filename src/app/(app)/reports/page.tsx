import React from "react";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GenerateReportButton } from "@/components/generate-report-button";
import { SundayDigestSendButton } from "@/components/sunday-digest-send-button";
import { BarChart3, Calendar, FileText, Sparkles, Send } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { searchReports } from "@/lib/reports/commands";
import { getReportHistoryForActor, getReportStyleProposalsForActor } from "@/lib/reports/history";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { ReportHistoryBootstrap } from "@/components/reports/report-history-bootstrap";

export default async function ReportsPage() {
    const session = await auth();
    if (!session?.user) return null;

    const actor = await toSabahActor(session.user);
    const reports = await searchReports(actor);
    const history = actor.role === "VIEWER" ? [] : await getReportHistoryForActor(actor.id);
    const pendingProposals = actor.role === "VIEWER" ? [] : await getReportStyleProposalsForActor(actor.id);

    return (
        <div className="space-y-6 animate-fade-in">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight sm:text-3xl" dir="auto">Reports</h1>
                    <p className="text-muted-foreground">Weekly summaries and the Sunday executive digest</p>
                </div>
                <div className="flex items-center gap-2">
                    {actor.role === "ADMIN" && <SundayDigestSendButton />}
                    <GenerateReportButton />
                </div>
            </div>

            {actor.role !== "VIEWER" && <ReportHistoryBootstrap history={history.map(({ id, date, sourceId, checksum, provenance }) => ({ id, date, sourceId, checksum, provenance }))} pendingProposals={pendingProposals} />}

            {reports.length === 0 ? (
                <EmptyState
                    icon={BarChart3}
                    title="No reports yet"
                    description="Weekly reports are generated automatically. The Sunday executive digest ships every Sunday morning. You can also trigger either one manually."
                    actions={[
                        { label: "Generate weekly report", href: "#", icon: Sparkles, variant: "primary" },
                        { label: "Send Sunday digest now", href: "/admin/settings/reporting", icon: Send, variant: "secondary" },
                        { label: "Configure recipients", href: "/admin/settings/reporting", icon: FileText, variant: "secondary" },
                    ]}
                />
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {reports.map((report) => (
                        <Link key={report.id} href={`/reports/${report.id}`}>
                            <Card className="h-full hover:shadow-lg transition-shadow cursor-pointer">
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <FileText className="h-8 w-8 text-primary" />
                                        <div className="flex flex-col items-end gap-1">
                                            {report.type === "SUNDAY_DIGEST" && (
                                                <Badge className="text-xs bg-purple-500/15 text-purple-600 border-purple-500/30">
                                                    Sunday digest
                                                </Badge>
                                            )}
                                            {report.submittedAt && (
                                                <Badge className="text-xs bg-emerald-500/15 text-emerald-600 border-emerald-500/30">
                                                    Submitted
                                                </Badge>
                                            )}
                                            <Badge variant="outline" className="text-xs">
                                                <Calendar className="h-3 w-3 mr-1" />
                                                {formatDate(report.weekStart)}
                                            </Badge>
                                        </div>
                                    </div>
                                    <CardTitle className="text-lg mt-2">{report.title}</CardTitle>
                                    <CardDescription>
                                        Week of {formatDate(report.weekStart)} - {formatDate(report.weekEnd)}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-sm text-muted-foreground line-clamp-4">
                                        {report.body.slice(0, 250).replace(/[#*`]/g, "")}...
                                    </p>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
