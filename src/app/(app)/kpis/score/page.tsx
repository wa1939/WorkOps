import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { KpiBulkScoreForm } from "@/components/kpi-bulk-score-form";


async function getKpis() {
    return prisma.kPI.findMany({
        orderBy: [{ perspective: "asc" }, { name: "asc" }],
        include: {
            updates: { orderBy: { createdAt: "desc" }, take: 8 },
        },
    });
}

export default async function KpiScorePage() {
    const session = await auth();
    if (!session?.user) return null;

    const kpis = await getKpis();

    const serialized = kpis.map((k) => ({
        id: k.id,
        name: k.name,
        perspective: k.perspective,
        unit: k.unit,
        q1Target: k.q1Target,
        q2Target: k.q2Target,
        q3Target: k.q3Target,
        q4Target: k.q4Target,
        annualTarget: k.annualTarget,
        updatedAt: k.updatedAt.toISOString(),
        updates: k.updates.map((u) => ({ quarter: u.quarter, value: u.value })),
    }));

    return (
        <div className="max-w-4xl mx-auto animate-fade-in">
            <div className="mb-4">
                <Button variant="ghost" size="sm" asChild>
                    <Link href="/kpis">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Back to KPIs
                    </Link>
                </Button>
            </div>

            <div className="mb-6">
                <h1 className="text-3xl font-bold tracking-tight">Score a quarter</h1>
                <p className="text-muted-foreground">
                    Enter this quarter&apos;s value for every KPI in one pass. Press Enter to jump to the next row, then Save all.
                </p>
            </div>

            {kpis.length === 0 ? (
                <p className="text-muted-foreground">No KPIs defined yet.</p>
            ) : (
                <KpiBulkScoreForm kpis={serialized} />
            )}
        </div>
    );
}
