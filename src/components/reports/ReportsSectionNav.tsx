import Link from "next/link";

const links = [
    ["Reports home", "/reports"],
    ["Estimate vs actual", "/reports/time"],
    ["Utilization", "/reports/utilization"],
] as const;

export function ReportsSectionNav() {
    return <nav aria-label="Reports" className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/20 p-1 text-sm">{links.map(([label, href]) => <Link key={href} href={href} className="rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground">{label}</Link>)}</nav>;
}
