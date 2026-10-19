import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { createMemoryService } from "@/lib/sabah/memory/service";
import { getLearningDependencies, learningErrorResponse } from "@/lib/sabah/capabilities/modules/learning";
export const dynamic = "force-dynamic";
const bodySchema = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), reason: z.string().trim().min(1).max(500) }).strict();
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });try { const deps = getLearningDependencies(); const actor = await toSabahActor(session.user); if (actor.role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 }); const body = bodySchema.parse(await request.json()); const service = createMemoryService(deps.memory, { sourceVerifier: deps.verifySource, sourceChecksumVerifier: deps.verifyChecksum, canApproveSharedScope: deps.sharedMemoryApprovalPolicy ?? deps.sharedMemoryPolicy }); const result = body.decision === "APPROVED" ? await service.approveMemory(params.id, actor, body.reason) : await service.rejectMemory(params.id, actor, body.reason); return NextResponse.json({ id: result.id, state: result.state }); } catch (error) { const mapped = learningErrorResponse(error); return NextResponse.json(mapped.body, { status: mapped.status }); }
}
