import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createSupportRequest, listSupportForActor } from "@/lib/support/commands";

function actor(session: any) { return { id: session.user.id, role: session.user.role ?? "MEMBER", departmentIds: session.user.departmentIds ?? [] } as any; }
function errorResponse(error: any, fallback: string) { const status = Number.isInteger(error?.status) ? error.status : 500; return NextResponse.json({ error: error?.message ?? fallback }, { status }); }

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const requests = await listSupportForActor({ query: params.get("query") ?? undefined, projectId: params.get("projectId") ?? undefined, taskId: params.get("taskId") ?? undefined, status: params.get("status") ?? undefined }, actor(session));
    return NextResponse.json(requests);
  } catch (error) { console.error("GET /api/support error:", error); return errorResponse(error, "Failed to fetch support requests"); }
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await createSupportRequest(await request.json(), actor(session));
    return NextResponse.json(result, { status: 201 });
  } catch (error) { console.error("POST /api/support error:", error); return errorResponse(error, "Failed to create support request"); }
}
