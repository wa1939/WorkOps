import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { getLearningDependencies, learningErrorResponse } from "@/lib/sabah/capabilities/modules/learning";
import { approvePlaybookVersion, archivePlaybook } from "@/lib/sabah/playbooks/service";
export const dynamic = "force-dynamic";
const bodySchema = z.object({ decision: z.enum(["APPROVED", "ARCHIVED"]), reason: z.string().trim().min(1).max(128).optional() }).strict().superRefine((body, ctx) => { if (body.decision === "APPROVED" && !body.reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "reason is required" }); });
export async function POST(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });try { const deps = getLearningDependencies(); const actor = await toSabahActor(session.user); if (actor.role !== "ADMIN" && actor.role !== "LEAD") return NextResponse.json({ error: "Forbidden" }, { status: 403 }); const body = bodySchema.parse(await request.json()); const options = { ...deps.playbookOptions, adapter: deps.playbooks }; const result = body.decision === "APPROVED" ? await approvePlaybookVersion(params.id, actor, body.reason!, options) : await archivePlaybook(params.id, actor, options); return NextResponse.json({ id: result.id, playbookId: result.playbookId, version: result.version, state: result.state, checksum: result.checksum }); } catch (e) { const x = learningErrorResponse(e); return NextResponse.json(x.body, { status: x.status }); }
}
