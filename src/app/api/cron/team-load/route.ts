import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor, SabahForbiddenError } from "@/lib/sabah/auth/actor";
import { prisma } from "@/lib/prisma";
import { computeTeamLoadSnapshot, getTeamLoadVersions } from "@/lib/team-load";
import { publishSnapshot } from "@/lib/workload/snapshot";

export const maxDuration = 60;

const TEAM_LOAD_SCOPE = "team-load";

type TeamLoadRefresh = Awaited<ReturnType<typeof publishTeamLoad>>;

async function publishTeamLoad() {
    const versions = await getTeamLoadVersions();
    return publishSnapshot(prisma, TEAM_LOAD_SCOPE, async () => {
        const computed = await computeTeamLoadSnapshot();
        return { rows: computed.rows, result: computed.summary };
    }, versions);
}

function refreshResponse(result: TeamLoadRefresh) {
    return {
        success: true,
        ...(result.skipped ? {} : result.result ?? {}),
        run: result.skipped ? "skipped" : "published",
        inputVersion: result.inputVersion,
        calendarVersion: result.calendarVersion,
    };
}

function computationFailure(method: string, error: unknown): NextResponse {
    console.error(`${method} /api/cron/team-load error:`, error);
    return NextResponse.json({ error: "Team load computation failed" }, { status: 500 });
}

// Vercel cron (nightly): Bearer CRON_SECRET.
export async function GET(request: Request) {
    try {
        const configuredSecret = process.env.CRON_SECRET?.trim();
        const authHeader = request.headers.get("authorization");
        if (!configuredSecret || authHeader !== `Bearer ${configuredSecret}`) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const result = await publishTeamLoad();
        return NextResponse.json(refreshResponse(result));
    } catch (error) {
        return computationFailure("GET", error);
    }
}

// Manual "Compute now" from the /team page — ADMIN/LEAD only.
export async function POST() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // The persisted actor is the authorization source. The session role can
        // be stale until JWT expiry and must not authorize a load computation.
        let actor;
        try {
            actor = await toSabahActor(session.user);
        } catch (error) {
            if (error instanceof SabahForbiddenError) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
            return computationFailure("POST", error);
        }
        if (actor.role !== "ADMIN" && actor.role !== "LEAD") {
            return NextResponse.json({ error: "Admin or lead only" }, { status: 403 });
        }

        const result = await publishTeamLoad();
        return NextResponse.json(refreshResponse(result));
    } catch (error) {
        return computationFailure("POST", error);
    }
}
