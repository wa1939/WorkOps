import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { getLearningDependencies, learningErrorResponse } from "@/lib/sabah/capabilities/modules/learning";
import { submitPlaybookReview } from "@/lib/sabah/playbooks/service";

export const dynamic = "force-dynamic";
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Advance one immutable DRAFT version to IN_REVIEW through the CAS service seam. */
export async function POST(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!SAFE_ID.test(params.id)) return NextResponse.json({ error: "Invalid playbook version id" }, { status: 400 });
    try {
        const actor = await toSabahActor(session.user);
        const deps = getLearningDependencies();
        const result = await submitPlaybookReview(params.id, actor, { ...deps.playbookOptions, adapter: deps.playbooks });
        return NextResponse.json({ id: result.id, playbookId: result.playbookId, version: result.version, state: result.state, checksum: result.checksum });
    } catch (error) {
        const failure = learningErrorResponse(error);
        return NextResponse.json(failure.body, { status: failure.status });
    }
}
