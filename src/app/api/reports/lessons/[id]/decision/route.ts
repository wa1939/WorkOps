import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { approveReportStyleMemo, rejectReportStyleMemo } from "@/lib/reports/history";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  approved: z.boolean(),
  reason: z.string().trim().min(1).max(500),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof candidate?.status === "number" && candidate.status >= 400 && candidate.status < 500 ? candidate.status : 500;
  return NextResponse.json({ error: status < 500 && typeof candidate?.message === "string" ? candidate.message : "Report style decision failed" }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const actor = await toSabahActor(session.user);
    if (actor.role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const { id } = await params;
    const input = bodySchema.parse(await request.json());
    const result = input.approved
      ? await approveReportStyleMemo({ memoryId: id, ownerId: actor.id, reason: input.reason })
      : await rejectReportStyleMemo({ memoryId: id, ownerId: actor.id, reason: input.reason });
    return NextResponse.json({ success: true, learned: result.learned, disabled: result.disabled, memoryId: result.memoryId, auditId: result.auditId, supersededCount: result.supersededCount });
  } catch (error) {
    return errorResponse(error);
  }
}
