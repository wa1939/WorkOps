import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SabahForbiddenError, toSabahActor } from "@/lib/sabah/auth/actor";
import { ConversationNotFoundError, InvalidConversationSearchCursorError, searchConversationHistory } from "@/lib/sabah/continuity/search";

export const dynamic = "force-dynamic";
const inputSchema = z.object({
  query: z.string().min(1).max(512), conversationId: z.string().max(200).optional(),
  entityType: z.string().max(100).optional(), entityId: z.string().max(200).optional(), workflowId: z.string().max(200).optional(),
  before: z.coerce.date().optional(), after: z.coerce.date().optional(), limit: z.coerce.number().int().min(1).max(10000).optional(), cursor: z.string().max(512).optional(),
}).strict();

function errorResponse(error: unknown) {
  if (error instanceof ConversationNotFoundError) return NextResponse.json({ error: "Conversation not found", code: error.code }, { status: 404 });
  if (error instanceof InvalidConversationSearchCursorError) return NextResponse.json({ error: "Invalid search cursor", code: error.code }, { status: 400 });
  if (error instanceof SabahForbiddenError) return NextResponse.json({ error: "Forbidden", code: error.code }, { status: 403 });
  if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid search request", issues: error.issues }, { status: 400 });
  return NextResponse.json({ error: "Failed to search conversation history" }, { status: 500 });
}
async function authorized() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return toSabahActor(session.user);
}
async function run(input: unknown) {
  const actor = await authorized();
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.parse(input);
  return NextResponse.json(await searchConversationHistory(parsed.query, actor, prisma, { ...parsed, limit: parsed.limit === undefined ? undefined : Math.min(parsed.limit, 50) }));
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    return await run(Object.fromEntries(params.entries()));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    return await run(body);
  } catch (error) { return errorResponse(error); }
}
