import { NextResponse } from "next/server";
import { assignmentHasCredential, configuredAiTarget, hasConfiguredAi } from "@/lib/ai/provider-config";
import { DEFAULT_OPERATIONAL_MODEL } from "@/lib/ai/provider-resolution";
import { resolveModelForRole } from "@/lib/sabah/providers/roles";
import { resolveRuntimeProviderCredentials, type RuntimeProviderCredentials } from "@/lib/sabah/providers/admin-service";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { gatherWeekContext, gatherPromptExtras, generateExecutiveSummary, projectVisibilityWhere } from "@/lib/executive-summary";
import { toSabahActor } from "@/lib/sabah/auth/actor";

export const maxDuration = 60;

/**
 * POST /api/projects/[id]/brief — an executive-style weekly brief scoped to a
 * single project, in the GM's own voice (shared executive-summary module).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { id } = await params;
        let actor;
        try {
            actor = await toSabahActor(session.user);
        } catch {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const project = await prisma.project.findFirst({ where: { id, ...projectVisibilityWhere(actor) }, select: { id: true } });
        if (!project) {
            return NextResponse.json({ error: "Project not found" }, { status: 404 });
        }

        // Availability preflight. Resolve the saved CHAT assignment before the
        // gate: an assignment may select a provider whose stored or environment
        // credential exists even when the deployment default (legacy GLM/Nuha
        // keys) is unconfigured. Mirrors the chat route; lookup failures keep
        // the safe default, and invalid assignments fail visibly downstream
        // when generation re-resolves the target through the shared resolver.
        let runtimeCredentials: RuntimeProviderCredentials = {};
        try {
            runtimeCredentials = await resolveRuntimeProviderCredentials();
        } catch {
            runtimeCredentials = {};
        }
        let chatAssignment: Awaited<ReturnType<typeof resolveModelForRole>> | null = null;
        try {
            chatAssignment = await resolveModelForRole("CHAT", prisma, { defaultTarget: configuredAiTarget() ?? DEFAULT_OPERATIONAL_MODEL });
        } catch {
            chatAssignment = null;
        }
        if (!hasConfiguredAi(runtimeCredentials) && !assignmentHasCredential(chatAssignment, runtimeCredentials)) {
            return NextResponse.json({ error: "AI provider not configured" }, { status: 503 });
        }

        const ctx = await gatherWeekContext({ projectId: id, actor });
        const extras = await gatherPromptExtras(actor.id).catch(() => undefined);
        const lines = await generateExecutiveSummary(ctx, extras);

        return NextResponse.json({ success: true, brief: lines.join("\n") });
    } catch (error) {
        console.error("POST /api/projects/[id]/brief error:", error);
        return NextResponse.json({ error: "Failed to generate brief" }, { status: 500 });
    }
}
