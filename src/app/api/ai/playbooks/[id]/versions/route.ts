import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { toSabahActor } from "@/lib/sabah/auth/actor";
import { getLearningDependencies, learningErrorResponse } from "@/lib/sabah/capabilities/modules/learning";
export const dynamic = "force-dynamic";
const projectVersion = (row: Awaited<ReturnType<ReturnType<typeof getLearningDependencies>["playbooks"]["list"]>>[number]) => ({ id: row.id, playbookId: row.playbookId, version: row.version, name: row.name.slice(0, 128), description: row.description.slice(0, 128), scope: row.scope, ownerId: row.ownerId, departmentId: row.departmentId ?? null, requiredContext: row.requiredContext.slice(0, 16).map((value) => value.slice(0, 128)), allowedCapabilities: row.allowedCapabilities.slice(0, 16).map((value) => value.slice(0, 128)), state: row.state, checksum: row.checksum ?? "" });

export async function GET(_request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await auth();if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });try { const deps = getLearningDependencies(); const actor = await toSabahActor(session.user); const rows = await deps.playbooks.list(); const visible = []; for (const row of rows) { if (row.playbookId !== params.id) continue; const allowed = row.scope === "USER" ? row.ownerId === actor.id : row.scope === "DEPARTMENT" ? !!row.departmentId && actor.departmentIds.includes(row.departmentId) : !!deps.playbookOptions.sharedAccessPolicy && (await deps.playbookOptions.sharedAccessPolicy(actor, { id: row.id, scope: row.scope, ownerId: row.ownerId, departmentId: row.departmentId })); if (allowed) visible.push(projectVersion(row)); } return NextResponse.json({ versions: visible.slice(-16) }); } catch (e) { const x = learningErrorResponse(e); return NextResponse.json(x.body, { status: x.status }); }
}
