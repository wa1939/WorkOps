import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { KpiCommandError } from "@/lib/kpis/authorization";
import { aggregateViewBlock, parseViewAggregateSearchParams } from "@/lib/view-aggregate";
import { SabahForbiddenError, toSabahActor } from "@/lib/sabah/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const actor = await toSabahActor(session.user);
        const parsed = parseViewAggregateSearchParams(new URL(request.url).searchParams);
        const aggregate = await aggregateViewBlock({
            ...parsed,
            actor,
            now: new Date(),
        });
        return NextResponse.json(aggregate);
    } catch (error) {
        if (error instanceof SabahForbiddenError) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        if (error instanceof KpiCommandError) {
            return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
        }

        console.error(
            "GET /api/views/aggregate error",
            error instanceof Error ? error.name : "unknown error",
        );
        return NextResponse.json({ error: "Failed to fetch view aggregate" }, { status: 500 });
    }
}
