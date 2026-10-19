import { NextResponse } from "next/server";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { PmoForbiddenError } from "@/lib/pmo/authorization";
import { PmoLifecycleError, removeEvidence, updateEvidence } from "@/lib/pmo/lifecycle-service";
import { evidenceSchema } from "@/lib/pmo/schemas";

function handle(error: unknown) {
    if (error instanceof PmoForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (error instanceof PmoLifecycleError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.name === "ZodError") return NextResponse.json({ error: "Invalid evidence" }, { status: 400 });
    throw error;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string; evidenceId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { taskId, evidenceId } = await params;
        return NextResponse.json(await updateEvidence(taskId, evidenceId, evidenceSchema.parse(await request.json()), actor));
    } catch (error) {
        return handle(error);
    }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ taskId: string; evidenceId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    try {
        const { taskId, evidenceId } = await params;
        await removeEvidence(taskId, evidenceId, actor);
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return handle(error);
    }
}
