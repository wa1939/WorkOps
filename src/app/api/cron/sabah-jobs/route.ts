import { NextRequest, NextResponse } from "next/server";
import { createPrismaJobDb, requeueExpiredLeases } from "@/lib/sabah/jobs/queue";
import { processJobTick } from "@/lib/sabah/jobs/worker";
import { getSabahFlags } from "@/lib/sabah/flags";

export const maxDuration = 60;
const WORKER_ID = "sabah-cron-recovery-v1";

async function recoverExpiredJobs(request: NextRequest) {
    const secret = process.env.CRON_SECRET;
    const authorization = request.headers.get("authorization");
    if (!secret || authorization !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Durable jobs only exist for the Sabah platform; while it is dark this
    // endpoint reports an honest skip instead of processing the queue.
    if (!getSabahFlags().platform) return NextResponse.json({ ok: true, skipped: true, reason: "PLATFORM_DISABLED" });
    try {
        const db = createPrismaJobDb();
        const requeued = await requeueExpiredLeases(db);
        const result = await processJobTick({ db, workerId: WORKER_ID, limit: 10, budgetMs: 45_000 });
        return NextResponse.json({ ok: true, requeued: requeued.length, ...result });
    } catch { return NextResponse.json({ error: "Job recovery failed" }, { status: 500 }); }
}

export async function POST(request: NextRequest) { return recoverExpiredJobs(request); }
export async function GET(request: NextRequest) { return recoverExpiredJobs(request); }
