import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { SabahActor } from "@/lib/sabah/capabilities/contracts";
import { clearHomePreference, getHomePreference, HomePreferenceError, setHomePreference } from "@/lib/home-preference";

const bodySchema = z.object({ viewId: z.string().trim().min(1).max(128) }).strict();

function actor(user: { id: string; role?: string; departmentIds?: string[] }): SabahActor {
    return {
        id: user.id,
        role: user.role as SabahActor["role"],
        departmentIds: user.departmentIds ?? [],
    };
}

function failure(error: unknown) {
    if (error instanceof HomePreferenceError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("Home preference request failed", error);
    return NextResponse.json({ error: "Unable to update home view" }, { status: 500 });
}

export async function GET() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        return NextResponse.json({ viewId: await getHomePreference(actor(session.user)) });
    } catch (error) {
        return failure(error);
    }
}

export async function PUT(request: Request) {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return NextResponse.json({ error: "Invalid saved view id", code: "INVALID_INPUT" }, { status: 400 });
        }
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: "Invalid saved view id", code: "INVALID_INPUT" }, { status: 400 });
        return NextResponse.json(await setHomePreference(parsed.data.viewId, actor(session.user)));
    } catch (error) {
        return failure(error);
    }
}

export async function DELETE() {
    try {
        const session = await auth();
        if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        return NextResponse.json(await clearHomePreference(actor(session.user)));
    } catch (error) {
        return failure(error);
    }
}
