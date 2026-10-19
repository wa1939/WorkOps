import { EstimateVsActual } from "@/components/reports/EstimateVsActual";
import { ReportsSectionNav } from "@/components/reports/ReportsSectionNav";

function datePart(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export default function TimeReportPage() {
    const today = new Date();
    const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1));
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return <div className="mx-auto max-w-7xl space-y-6"><header><p className="text-primary">Reports</p><h1 className="text-3xl font-bold">Estimate vs actual</h1><p className="text-muted-foreground">See where planned effort and logged time diverge.</p></header><ReportsSectionNav /><EstimateVsActual initialFrom={datePart(from)} initialTo={datePart(to)} /></div>;
}
