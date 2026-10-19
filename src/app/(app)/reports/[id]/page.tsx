import { auth } from "@/lib/auth";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PrintButton } from "@/components/print-button";
import { DeleteReportButton } from "@/components/delete-report-button";
import { FinalReportEditor } from "@/components/reports/final-report-editor";
import { getReportStyleMemo, getWeeklyReportForActor, resolveReportEditorBody } from "@/lib/reports/commands";
import { getReportStyleProposalsForActor } from "@/lib/reports/history";
import type { ReportStyleProposalMetadata } from "@/components/reports/report-style-proposals";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { ArrowLeft, Calendar, FileText } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";


export default async function ReportDetailPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const session = await auth();
    if (!session?.user) return null;
    const actor = await toSabahActor(session.user);

    const { id } = await params;
    const report = await getWeeklyReportForActor(id, actor);

    if (!report) {
        notFound();
    }

    const isAdmin = actor.role === "ADMIN";

    let styleMemo: string | null = null;
    let pendingProposals: ReportStyleProposalMetadata[] = [];
    if (isAdmin) {
        styleMemo = await getReportStyleMemo(actor.id).catch(() => null);
        pendingProposals = await getReportStyleProposalsForActor(actor.id).catch(() => []);
    }
    const initialFinal = resolveReportEditorBody(report);

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-6 flex items-center justify-between print:hidden">
                <Button variant="ghost" asChild>
                    <Link href="/reports">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to Reports
                    </Link>
                </Button>
                <div className="flex items-center gap-2">
                    {isAdmin && (
                        <DeleteReportButton reportId={report.id} reportTitle={report.title} />
                    )}
                    <PrintButton />
                </div>
            </div>

            {/* Header */}
            <div className="mb-6 print-section">
                <div className="flex items-center gap-2 mb-2">
                    <FileText className="h-6 w-6 text-primary" />
                    <Badge variant="outline" className="gap-1">
                        <Calendar className="h-3 w-3" />
                        Week of {formatDate(report.weekStart)}
                    </Badge>
                    {report.submittedAt && (
                        <Badge variant="outline" className="text-xs">
                            Submitted {formatDate(report.submittedAt)}
                        </Badge>
                    )}
                </div>
                <h1 className="text-3xl font-bold">{report.title}</h1>
                <p className="text-muted-foreground mt-2">
                    {formatDate(report.weekStart)} - {formatDate(report.weekEnd)}
                </p>
            </div>

            {/* Content */}
            <Card className="print-section">
                <CardContent className="pt-6 prose prose-neutral dark:prose-invert max-w-none">
                    <div className="whitespace-pre-line" dir="auto">{initialFinal}</div>
                </CardContent>
            </Card>

            {isAdmin && (
                <FinalReportEditor
                    reportId={report.id}
                    initialFinal={initialFinal}
                    submittedAt={report.submittedAt ? report.submittedAt.toISOString() : null}
                    styleMemo={styleMemo}
                    pendingProposals={pendingProposals}
                />
            )}

            <div className="mt-6 text-center text-sm text-muted-foreground print:hidden">
                Generated on {formatDate(report.createdAt)}
            </div>
        </div>
    );
}
