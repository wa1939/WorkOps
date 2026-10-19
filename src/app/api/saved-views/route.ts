import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createSavedView, listSavedViewsForActor, SavedViewCommandError } from "@/lib/saved-views/commands";
import { savedViewSearchSchema } from "@/lib/saved-views/schemas";
const actor = (user: any) => ({ id: user.id, role: user.role, departmentIds: user.departmentIds ?? [] });
function failure(error: unknown, fallback: string) {
  if (error instanceof SavedViewCommandError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL(request.url);
    const input = savedViewSearchSchema.parse({ query: url.searchParams.get("query") ?? "", limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined });
    return NextResponse.json(await listSavedViewsForActor(input, actor(session.user)));
  } catch (error) { return failure(error, "Failed to fetch views"); }
}
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    // The existing create UI predates explicit scope and historically created team views.
    const input = { ...body, scope: body.scope ?? "TEAM" };
    return NextResponse.json(await createSavedView(input, actor(session.user)), { status: 201 });
  } catch (error) { return failure(error, "Failed to create view"); }
}
