import { z } from "zod";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { compressConversation, type CompressionDb } from "@/lib/sabah/continuity/compression";

const optionsSchema = z.object({ maxMessages: z.number().int().min(21).max(500).optional() }).strict().default({});
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const actor = await toSabahActor({ id: session.user.id, role: (session.user as { role?: string }).role });
    let options: z.infer<typeof optionsSchema>;
    try { options = optionsSchema.parse(await request.json()); } catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }
    const { id } = await params;
    const result = await compressConversation(id, actor, prisma as unknown as CompressionDb, { maxMessages: options.maxMessages });
    if (result.status === "uncompressed" && result.reason === "conversation_not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (result.status === "uncompressed" && result.reason === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ status: result.status, version: "version" in result ? result.version : null, summaryId: "summaryId" in result ? result.summaryId : null, boundaryMessageId: "boundaryMessageId" in result ? result.boundaryMessageId : null, endMessageId: "endMessageId" in result ? result.endMessageId : null, reason: result.status === "uncompressed" ? result.reason : null });
  } catch (error) {
    if (error instanceof SabahForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json({ error: "Compression unavailable" }, { status: 503 });
  }
}
