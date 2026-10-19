import { NextResponse } from "next/server";
import { getCurrentPmoActor } from "@/lib/pmo/current-actor";
import { assembleFollowUpDraft } from "@/lib/pmo/draft-assembly";

export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
    const actor = await getCurrentPmoActor();
    if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { taskId } = await params;
    const draft = await assembleFollowUpDraft(taskId);
    if (!draft) {
        return NextResponse.json({ error: "External action not found" }, { status: 404 });
    }
    return NextResponse.json({
        to: draft.to,
        subject: draft.subject,
        body: draft.body,
        scheduledEventId: draft.scheduledEventId,
    });
}
