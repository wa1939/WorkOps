import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { bootstrapReportHistory, getReportHistoryForActor, getReportStyleProposalsForActor, reportHistoryBootstrapSchema } from "@/lib/reports/history";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function errorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const status = typeof candidate?.status === "number" && candidate.status >= 400 && candidate.status < 500 ? candidate.status : 500;
  if (status < 500 && typeof candidate?.message === "string") return NextResponse.json({ error: candidate.message, code: typeof candidate.code === "string" ? candidate.code : undefined }, { status });
  return NextResponse.json({ error: "Report history bootstrap failed" }, { status: 500 });
}

async function authenticatedActor() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const actor = await toSabahActor(session.user);
  if (actor.role === "VIEWER") return { error: NextResponse.json({ error: "Report history import is not available to viewers" }, { status: 403 }) };
  return { actor };
}

/**
 * Lists only the authenticated actor's approved history metadata. Source text is
 * deliberately omitted from this response; generation reads it server-side.
 */
export async function GET() {
  try {
    const gate = await authenticatedActor();
    if (gate.error) return gate.error;
    const [history, proposals] = await Promise.all([
      getReportHistoryForActor(gate.actor.id),
      getReportStyleProposalsForActor(gate.actor.id),
    ]);
    return NextResponse.json({ history: history.map(({ id, content: _content, ...entry }) => ({ id, ...entry })), proposals });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Imports caller-supplied dated reports into personal approved memory. The
 * owner always comes from the authenticated actor; `approved: true` is the
 * explicit authority, and the service makes replays source-idempotent.
 */
export async function POST(request: Request) {
  try {
    const gate = await authenticatedActor();
    if (gate.error) return gate.error;
    const input = reportHistoryBootstrapSchema.parse(await request.json());
    const result = await bootstrapReportHistory(input, gate.actor.id);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
