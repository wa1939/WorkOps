import { NextResponse } from "next/server";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { toRiyadhDate } from "@/lib/pmo/date";
import { parsePmoFilters } from "@/lib/pmo/portfolio";
import { loadPmoPortfolio } from "@/lib/pmo/portfolio-query";

export async function GET(request: Request) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json(await loadPmoPortfolio(parsePmoFilters(new URL(request.url).searchParams), actor, toRiyadhDate(new Date())));
}
