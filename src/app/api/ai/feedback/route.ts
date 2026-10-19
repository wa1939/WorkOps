import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createFeedbackService, createPrismaFeedbackRepository } from "@/lib/sabah/feedback/service";
import type { FeedbackActor } from "@/lib/sabah/feedback/contracts";

const fieldNamePattern = /^[A-Za-z0-9_.-]{1,80}$/;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const actor: FeedbackActor = { id: session.user.id, scope: "PERSONAL", scopeId: session.user.id };
    const feedback = createFeedbackService(createPrismaFeedbackRepository(), {
      // Entity field feedback is deliberately fail-closed here: this generic
      // route has no safe universal entity authorizer. Forms with no dedicated
      // server adapter receive a pending/unavailable capture status.
      authorizeSource: async (source, sourceActor) => (source.kind === "CAPABILITY" && source.id === `personal:${sourceActor.id}`) || (source.kind === "FIELD" && typeof source.fieldName === "string" && fieldNamePattern.test(source.fieldName) && source.id === `personal:field:${source.fieldName}`),
      authorizeScope: async (scope, scopeId, sourceActor) => scope === "PERSONAL" && scopeId === sourceActor.id,
    });
    const event = await feedback.recordFeedback(await request.json(), actor);
    return NextResponse.json({ id: event.id, captured: true }, { status: 201 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && "message" in error && (error.code === "INVALID_FEEDBACK" || error.code === "FEEDBACK_FORBIDDEN")) return NextResponse.json({ error: String(error.message) }, { status: error.code === "FEEDBACK_FORBIDDEN" ? 403 : 400 });
    return NextResponse.json({ error: "Unable to capture feedback" }, { status: 500 });
  }
}
