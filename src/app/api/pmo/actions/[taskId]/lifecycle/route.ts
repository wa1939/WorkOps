import { NextResponse } from "next/server";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { PmoForbiddenError } from "@/lib/pmo/authorization";
import { PmoLifecycleError, transitionExternalAction } from "@/lib/pmo/lifecycle-service";
import { lifecycleSchema } from "@/lib/pmo/schemas";

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { taskId } = await params;
        return NextResponse.json(await transitionExternalAction(taskId, lifecycleSchema.parse(await request.json()), actor));
    } catch (error) {
        if (error instanceof PmoForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        if (error instanceof PmoLifecycleError) return NextResponse.json({ error: error.message }, { status: error.status });
        if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid transition" }, { status: 400 });
        throw error;
    }
}
