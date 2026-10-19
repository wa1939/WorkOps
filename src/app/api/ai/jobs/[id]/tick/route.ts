import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { createPrismaJobDb } from "@/lib/sabah/jobs/queue";
import { processJobTick } from "@/lib/sabah/jobs/worker";

const validId = (id: string) => /^[A-Za-z0-9:_./-]{1,160}$/.test(id);
export async function POST(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let actor;
    try { actor = await toSabahActor(session.user); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
    if (!validId(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const job = await prisma.aiJob.findUnique({ where: { id: params.id, actorId: actor.id }, select: { id: true, actorId: true } });
    if (!job || job.actorId !== actor.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    try {
        const result = await processJobTick({ db: createPrismaJobDb(), workerId: `actor-${actor.id}-tick`, limit: 1, budgetMs: 8_000, heartbeatSafetyMs: 1_000, heartbeatIntervalMs: 1_000, actorId: actor.id, jobId: params.id });
        return NextResponse.json({ id: params.id, ...result });
    } catch { return NextResponse.json({ error: "Job tick failed" }, { status: 500 }); }
}
