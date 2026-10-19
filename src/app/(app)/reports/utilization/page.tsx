import { ReportsSectionNav } from "@/components/reports/ReportsSectionNav";
import { Utilization } from "@/components/reports/Utilization";

function datePart(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export default function UtilizationReportPage() {
    const today = new Date();
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return <div className="mx-auto max-w-7xl space-y-6"><header><p className="text-primary">Reports</p><h1 className="text-3xl font-bold">Utilization</h1><p className="text-muted-foreground">Compare capacity and actual time across the team.</p></header><ReportsSectionNav /><Utilization initialFrom={datePart(from)} initialTo={datePart(to)} /></div>;
}
