import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { cancelJob, createPrismaJobDb } from "@/lib/sabah/jobs/queue";

const validId = (id: string) => /^[A-Za-z0-9:_./-]{1,160}$/.test(id);
const terminal = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);
export async function POST(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let actor;
    try { actor = await toSabahActor(session.user); } catch { return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); }
    if (!validId(params.id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const job = await prisma.aiJob.findUnique({ where: { id: params.id, actorId: actor.id }, select: { id: true, actorId: true, status: true } });
    if (!job || job.actorId !== actor.id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (terminal.has(job.status)) return NextResponse.json({ id: job.id, status: job.status, cancellation: "terminal" }, { status: 409 });
    try {
        const updated = await cancelJob(createPrismaJobDb(), job.id);
        return NextResponse.json({ id: updated.id, status: updated.status, cancellation: updated.cancelRequestedAt ? "requested" : "canceled" });
    } catch { return NextResponse.json({ id: job.id, status: job.status, cancellation: "unavailable" }, { status: 409 }); }
}
