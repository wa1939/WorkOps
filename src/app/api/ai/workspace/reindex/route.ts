import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SabahForbiddenError, toSabahActor } from "@/lib/sabah/auth/actor";
import { reconcileEntityBatch } from "@/lib/sabah/intelligence/indexer";
import type { WorkspaceEntityType } from "@/lib/sabah/intelligence/contracts";

const entityTypes = ["PROJECT", "TASK", "KPI", "PMO_ACTION", "NOTE", "LEAVE", "CASE_STUDY", "REPORT", "SUPPORT_REQUEST"] as const;
const reindexSchema = z.object({ entityTypes: z.array(z.enum(entityTypes)).min(1).max(entityTypes.length).refine((values) => new Set(values).size === values.length, "invalid entity types"), cursor: z.string().max(256).optional().nullable(), limit: z.number().int().min(1).max(100) });

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Authorize from the persisted role, not the session JWT.
  try {
    const actor = await toSabahActor(session.user);
    if (actor.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } catch (error) {
    if (error instanceof SabahForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw error;
  }
  try {
    const input = reindexSchema.parse(await request.json());
    const result = await reconcileEntityBatch(input.cursor ?? undefined, input.limit, prisma, { entityTypes: input.entityTypes as WorkspaceEntityType[] });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    console.error("POST /api/ai/workspace/reindex failed", error instanceof Error ? error.name : "UNKNOWN_ERROR");
    return NextResponse.json({ error: "Failed to reindex workspace" }, { status: 500 });
  }
}
